/**
 * Pipeline completo de una query: pregunta → SQL → ejecución real → respuesta.
 *
 * Es el corazón del producto y lo comparten la ruta de API y el eval, para que
 * lo que mide el eval sea exactamente lo que corre en producción.
 */

import { runScopedQuery } from '../db/query.js';
import { getCatalog, formatCatalogForPrompt } from '../sql/catalog.js';
import { validateSql } from '../sql/guard.js';
import { generateSql } from './text-to-sql.js';
import { summarizeResult, toApiChart } from './summarize.js';

export const QUERY_ERROR_CODES = {
  UNANSWERABLE: 'UNANSWERABLE',
  SQL_FAILED: 'SQL_FAILED',
  NO_DATA: 'NO_DATA',
  INTERNAL: 'INTERNAL',
};

/**
 * @param {object} params
 * @param {(event: { type: string, [k: string]: any }) => void} [params.onProgress]
 *   Emite las piezas del resultado en cuanto existen —`sql` (~3,3 s), `rows`
 *   (~3,5 s), `answerDelta` (~7 s)— para que la UI no espere al total.
 *   Los eventos son informativos: el payload final sigue siendo la verdad.
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, code: string, detail?: string, meta: object }>}
 */
export async function runQueryPipeline({
  question, store, historySummary, skipSummary = false, onProgress,
}) {
  const startedAt = Date.now();
  const emit = (event) => {
    // Un fallo pintando el progreso nunca puede tumbar la query.
    try { onProgress?.(event); } catch { /* ignorado a propósito */ }
  };

  const catalog = await getCatalog(store.id);
  const { schema, sampleRows } = formatCatalogForPrompt(catalog);

  const generation = await generateSql({
    question,
    dialect: 'postgres',
    schema,
    sampleRows,
    historySummary,
    validate: (sql) => validateSql(sql, { dialect: 'postgres' }),
    execute: async (sql) => {
      // Ya pasó el guard y va a ejecutarse: es SQL real, se puede enseñar. Si
      // falla y hay reintento, llega otro evento `sql` que sustituye a este.
      emit({ type: 'sql', sql });
      const result = await runScopedQuery({ storeId: store.id, sql });
      emit({
        type: 'rows',
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      });
      return result;
    },
  });

  const baseMeta = {
    attempts: generation.attempts,
    tokens: generation.tokens,
    model: generation.modelId,
  };

  if (generation.status === 'unanswerable') {
    return {
      ok: false,
      code: QUERY_ERROR_CODES.UNANSWERABLE,
      detail: generation.reason,
      meta: { ...baseMeta, ms: Date.now() - startedAt },
    };
  }

  if (generation.status === 'failed') {
    return {
      ok: false,
      code: QUERY_ERROR_CODES.SQL_FAILED,
      detail: generation.error,
      meta: { ...baseMeta, ms: Date.now() - startedAt },
    };
  }

  const { sql, result } = generation;

  // El eval de SQL no necesita pagar la segunda llamada al LLM.
  if (skipSummary) {
    return {
      ok: true,
      payload: {
        answer: null,
        sql,
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
        chart: null,
        insights: [],
        meta: { ...baseMeta, ms: Date.now() - startedAt, sqlMs: result.ms },
      },
    };
  }

  let summary;
  let summaryTokens = 0;
  let summaryModelId = null;
  try {
    const summarized = await summarizeResult({
      question,
      sql,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
      store,
      onAnswerDelta: onProgress ? (delta) => emit({ type: 'answerDelta', delta }) : undefined,
    });
    summary = summarized.summary;
    summaryTokens = summarized.tokens;
    summaryModelId = summarized.modelId;
  } catch (error) {
    return {
      ok: false,
      code: QUERY_ERROR_CODES.INTERNAL,
      detail: error.message,
      meta: { ...baseMeta, ms: Date.now() - startedAt },
    };
  }

  return {
    ok: true,
    payload: {
      answer: summary.answer,
      sql,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
      chart: toApiChart(summary, result.rows),
      insights: (summary.insights ?? []).map((i) => ({
        title: i.title,
        description: i.description,
        querySuggestion: i.query_suggestion,
      })),
      meta: {
        model: summaryModelId ?? generation.modelId,
        attempts: generation.attempts,
        tokens: generation.tokens + summaryTokens,
        ms: Date.now() - startedAt,
        sqlMs: result.ms,
      },
    },
  };
}
