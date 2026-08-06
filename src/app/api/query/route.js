/**
 * POST /api/query — contrato en docs/ARQUITECTURA.md §5.
 *
 * Sin auth todavía (llega en la Fase 3): acepta `source: "demo"` y resuelve al
 * store demo en el servidor.
 *
 * Dos modos sobre el MISMO contrato:
 *
 * - JSON (por defecto): la respuesta 200 de §5, tal cual.
 * - SSE (`Accept: text/event-stream`): los mismos campos, emitidos en cuanto
 *   existen. El pipeline tarda ~7 s pero el SQL está a los 3,3 s y las filas a
 *   los 3,5 s; esperar al total para pintar algo tira a la basura la mitad de
 *   la espera. Ver docs/fases/fase-2-chat-demo.md §"Streaming".
 *
 * El evento `done` lleva el payload completo de §5: es la única fuente de
 * verdad, los eventos anteriores son adelantos.
 */

import { createTranslator } from 'next-intl';

import { resolveStore } from '@/lib/db/stores';
import { runQueryPipeline, QUERY_ERROR_CODES } from '@/lib/llm/pipeline';
import { checkRateLimit, getClientIp } from '@/lib/utils/rate-limit';

import enMessages from '../../../../messages/en.json';
import esMessages from '../../../../messages/es.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// El pipeline p95 es de 13,4 s y el máximo medido 17,9 s: el default de Vercel
// sobra, pero dejarlo explícito evita sorpresas si cambia.
export const maxDuration = 60;

const MESSAGES = { en: enMessages, es: esMessages };
const MAX_QUESTION_LENGTH = 500;

function getErrorMessage(code, locale) {
  const resolved = MESSAGES[locale] ? locale : 'en';
  const t = createTranslator({ locale: resolved, messages: MESSAGES[resolved], namespace: 'Errors' });
  return t.has(code) ? t(code) : t('INTERNAL');
}

function logDetailFor(code, detail) {
  if (detail) {
    // El detalle crudo va al log del servidor, nunca a la respuesta.
    console.error(`[api/query] ${code}: ${detail}`);
  }
}

function errorResponse(code, locale, status, logDetail) {
  logDetailFor(code, logDetail);
  return Response.json(
    { error: { code, message: getErrorMessage(code, locale) } },
    { status },
  );
}

/** Valida el body y resuelve todo lo que puede fallar antes de abrir el stream. */
function parseRequestBody(body) {
  const locale = body?.locale === 'es' ? 'es' : 'en';

  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) return { ok: false, locale, detail: 'question vacía' };
  if (question.length > MAX_QUESTION_LENGTH) {
    return { ok: false, locale, detail: `question de ${question.length} chars` };
  }

  const source = body?.source ?? 'demo';
  if (!['demo', 'store', 'csv'].includes(source)) {
    return { ok: false, locale, detail: `source ${source}` };
  }
  if (source === 'csv') {
    // El motor DuckDB existe (src/lib/duckdb), pero el upload es la Fase 4.
    return { ok: false, locale, detail: 'source csv no disponible hasta la Fase 4' };
  }

  return {
    ok: true,
    locale,
    question,
    source,
    historySummary: typeof body?.historySummary === 'string' ? body.historySummary : undefined,
  };
}

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Sin esto, un proxy con buffering anula todo el propósito del streaming.
    'X-Accel-Buffering': 'no',
  };
}

function streamResponse({ question, source, historySummary, locale }) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // El cliente cerró la pestaña a mitad. No es un error del servidor.
          closed = true;
        }
      };

      try {
        // TODO Fase 3 ───────────────────────────────────────────────────────
        // El storeId se deriva AQUÍ, en el servidor, y solo aquí. Ver la nota
        // completa en el modo JSON, más abajo.
        // ───────────────────────────────────────────────────────────────────
        const store = await resolveStore({ source });

        const result = await runQueryPipeline({
          question,
          store,
          historySummary,
          onProgress: (event) => {
            if (event.type === 'sql') send('sql', { sql: event.sql });
            else if (event.type === 'rows') {
              send('rows', {
                rows: event.rows,
                rowCount: event.rowCount,
                truncated: event.truncated,
              });
            } else if (event.type === 'answerDelta') send('answerDelta', { delta: event.delta });
          },
        });

        if (!result.ok) {
          logDetailFor(result.code, result.detail);
          send('error', { error: { code: result.code, message: getErrorMessage(result.code, locale) } });
        } else {
          const payload = result.payload.rowCount === 0
            ? { ...result.payload, chart: null }
            : result.payload;
          send('done', payload);
        }
      } catch (error) {
        logDetailFor('INTERNAL', error?.stack ?? String(error));
        send('error', { error: { code: 'INTERNAL', message: getErrorMessage('INTERNAL', locale) } });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* ya cerrado por el cliente */ }
      }
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders() });
}

export async function POST(request) {
  let locale = 'en';

  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse('INVALID_REQUEST', locale, 400, 'body no es JSON');
    }

    const parsed = parseRequestBody(body);
    locale = parsed.locale;

    if (!parsed.ok) {
      return errorResponse('INVALID_REQUEST', locale, 400, parsed.detail);
    }

    // La demo es pública y cada pregunta son dos llamadas al LLM que pagamos.
    const limit = checkRateLimit(getClientIp(request));
    if (!limit.allowed) {
      logDetailFor('RATE_LIMITED', `ip ${getClientIp(request)}`);
      return Response.json(
        { error: { code: 'RATE_LIMITED', message: getErrorMessage('RATE_LIMITED', locale) } },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const wantsStream = request.headers.get('accept')?.includes('text/event-stream');
    if (wantsStream) {
      return streamResponse(parsed);
    }

    // TODO Fase 3 ─────────────────────────────────────────────────────────────
    // El storeId se deriva AQUÍ, en el servidor, y solo aquí. Cuando exista
    // auth, `source: 'store'` debe leer la sesión de Supabase y resolver el
    // store del usuario. Nunca aceptar un storeId del body: sería la fuga de
    // datos de un tenant a otro. Ver ARQUITECTURA.md §3.
    // ─────────────────────────────────────────────────────────────────────────
    const store = await resolveStore({ source: parsed.source });

    const result = await runQueryPipeline({
      question: parsed.question,
      store,
      historySummary: parsed.historySummary,
    });

    if (!result.ok) {
      const status = result.code === QUERY_ERROR_CODES.UNANSWERABLE ? 422 : 502;
      return errorResponse(result.code, locale, status, result.detail);
    }

    if (result.payload.rowCount === 0) {
      // Hay respuesta del modelo, pero sin filas no hay número que enseñar.
      return Response.json({ ...result.payload, chart: null }, { status: 200 });
    }

    return Response.json(result.payload, { status: 200 });
  } catch (error) {
    return errorResponse('INTERNAL', locale, 500, error?.stack ?? String(error));
  }
}
