/**
 * POST /api/query — contrato en docs/ARQUITECTURA.md §5.
 *
 * Sin auth todavía (llega en la Fase 3): acepta `source: "demo"` y resuelve al
 * store demo en el servidor.
 */

import { createTranslator } from 'next-intl';

import { resolveStore } from '@/lib/db/stores';
import { runQueryPipeline, QUERY_ERROR_CODES } from '@/lib/llm/pipeline';

import enMessages from '../../../../messages/en.json';
import esMessages from '../../../../messages/es.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESSAGES = { en: enMessages, es: esMessages };
const MAX_QUESTION_LENGTH = 500;

function getErrorMessage(code, locale) {
  const resolved = MESSAGES[locale] ? locale : 'en';
  const t = createTranslator({ locale: resolved, messages: MESSAGES[resolved], namespace: 'Errors' });
  return t.has(code) ? t(code) : t('INTERNAL');
}

function errorResponse(code, locale, status, logDetail) {
  if (logDetail) {
    // El detalle crudo va al log del servidor, nunca a la respuesta.
    console.error(`[api/query] ${code}: ${logDetail}`);
  }
  return Response.json(
    { error: { code, message: getErrorMessage(code, locale) } },
    { status },
  );
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

    locale = body?.locale === 'es' ? 'es' : 'en';

    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return errorResponse('INVALID_REQUEST', locale, 400, 'question vacía');
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return errorResponse('INVALID_REQUEST', locale, 400, `question de ${question.length} chars`);
    }

    const source = body?.source ?? 'demo';
    if (!['demo', 'store', 'csv'].includes(source)) {
      return errorResponse('INVALID_REQUEST', locale, 400, `source ${source}`);
    }
    if (source === 'csv') {
      // El motor DuckDB existe (src/lib/duckdb), pero el upload es la Fase 4.
      return errorResponse('INVALID_REQUEST', locale, 400, 'source csv no disponible hasta la Fase 4');
    }

    // TODO Fase 3 ─────────────────────────────────────────────────────────────
    // El storeId se deriva AQUÍ, en el servidor, y solo aquí. Cuando exista
    // auth, `source: 'store'` debe leer la sesión de Supabase y resolver el
    // store del usuario. Nunca aceptar un storeId del body: sería la fuga de
    // datos de un tenant a otro. Ver ARQUITECTURA.md §3.
    // ─────────────────────────────────────────────────────────────────────────
    const store = await resolveStore({ source });

    const result = await runQueryPipeline({
      question,
      store,
      historySummary: typeof body?.historySummary === 'string' ? body.historySummary : undefined,
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
