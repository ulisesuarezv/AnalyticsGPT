/**
 * LLM #2 — resultado real → respuesta natural + chart + insights.
 *
 * Prompt base: docs/PRODUCTO.md §9. Salida estructurada con `Output.object` y
 * schema Zod: nada de parsear JSON a mano.
 *
 * Los números salen SIEMPRE del resultado de la query. Este modelo redacta, no
 * calcula (docs/ARQUITECTURA.md §1).
 */

import { streamText, Output } from 'ai';
import { z } from 'zod';

import { getPrimaryModel, getFallbackModel } from './models.js';

/** Cuántas filas se le enseñan al modelo. Con más, el prompt se dispara. */
const MAX_ROWS_IN_PROMPT = 50;

const summarySchema = z.object({
  answer: z.string().describe('Natural language answer with exact numbers from the results'),
  chart_suggestion: z.enum(['bar', 'line', 'pie', 'scatter', 'table', 'none']),
  chart_config: z.object({
    x_field: z.string().describe('Column name for the X axis, or empty string'),
    y_field: z.string().describe('Column name for the Y axis, or empty string'),
    title: z.string(),
  }),
  insights: z.array(z.object({
    title: z.string(),
    description: z.string(),
    query_suggestion: z.string(),
  })).max(3),
});

const SYSTEM = `You are an ecommerce analytics assistant. The user asked about their store data.
A SQL query was executed and returned exact results. Your job:

1. Answer the question naturally IN THE SAME LANGUAGE AS THE QUESTION. If the question is in
   Spanish, answer in Spanish. If in English, answer in English. This is independent of the
   interface language.
2. Reference specific numbers from the results — never round unless asked, and never state a
   number that is not present in the results. If the results are empty, say so plainly.
3. If the results suggest a visualization, choose bar, line, pie or scatter. Use "table" for
   detailed multi-column listings and "none" for single scalar answers.
4. chart_config.x_field and y_field MUST be exact column names present in the results.
5. After answering, give 2-3 PROACTIVE INSIGHTS the user did not ask about:
   - Trends (up/down vs previous period)
   - Anomalies (unusual spikes or drops)
   - Opportunities (underperforming products, growing segments)
   Each insight must be specific and actionable, with numbers taken from the results.
   If the results do not support an insight, return fewer insights rather than inventing one.
   query_suggestion must be a follow-up question phrased in the same language as the answer.
6. Keep the main answer to 2-4 sentences. Insights are separate.
7. Write plain prose. Never format the answer as a markdown table, a bullet list or a code
   block: the full results are already rendered as a real table next to your answer, and
   markdown syntax shows up there as raw pipes and asterisks.`;

/**
 * @param {object} params
 * @param {(delta: string) => void} [params.onAnswerDelta] Recibe el texto de
 *   `answer` según se redacta. Es lo que permite que la Fase 2 pinte la prosa
 *   mientras llega, con la tabla ya en pantalla desde los ~3,5 s.
 * @returns {Promise<{ summary: object, tokens: number, modelId: string }>}
 */
export async function summarizeResult({
  question, sql, rows, rowCount, truncated, store, onAnswerDelta,
}) {
  const shown = rows.slice(0, MAX_ROWS_IN_PROMPT);

  const prompt = `QUESTION:
${question}

QUERY EXECUTED:
${sql}

RESULTS (${rowCount} row${rowCount === 1 ? '' : 's'}${truncated ? ', truncated' : ''}${
    rows.length > shown.length ? `, showing first ${shown.length}` : ''
  }):
${JSON.stringify(shown, null, 1)}

STORE CONTEXT:
- Platform: ${store.platform}
- Currency: ${store.currency}
- Store name: ${store.shop_name}`;

  const candidates = [getPrimaryModel(), getFallbackModel()];
  let tokens = 0;
  let lastError = null;

  for (const { model, id: modelId } of candidates) {
    // Con un reintento, lo ya emitido se descarta: el cliente reemplaza la
    // respuesta con el `answer` final, nunca la concatena.
    let emitted = '';
    try {
      const result = streamText({
        model,
        instructions: SYSTEM,
        prompt,
        temperature: 0.2,
        maxOutputTokens: 1200,
        output: Output.object({ schema: summarySchema }),
      });

      if (!onAnswerDelta) {
        // Sin consumir el stream, las promesas de `output`/`usage` no resuelven.
        await result.consumeStream();
      } else {
        for await (const partial of result.partialOutputStream) {
          const answer = typeof partial?.answer === 'string' ? partial.answer : '';
          if (answer.startsWith(emitted) && answer.length > emitted.length) {
            onAnswerDelta(answer.slice(emitted.length));
            emitted = answer;
          }
        }
      }

      const summary = await result.output;
      tokens += (await result.usage)?.totalTokens ?? 0;
      return { summary, tokens, modelId };
    } catch (error) {
      lastError = error;
      tokens += error?.usage?.totalTokens ?? 0;
    }
  }

  throw lastError ?? new Error('summarize falló sin error');
}

/** Cuántas filas siguen leyéndose bien como barras. Por encima, tabla. */
const MAX_ROWS_FOR_FORCED_BAR = 20;

const isNumeric = (value) => typeof value === 'number'
  || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));

/**
 * Detecta el caso "una dimensión y una métrica": exactamente una columna no
 * numérica y al menos una numérica. Es el top-N que el modelo etiqueta como
 * `table` y se lee mucho mejor en barras (hallazgo de la Fase 1).
 */
function findBarFields(rows, preferredY) {
  if (rows.length < 2 || rows.length > MAX_ROWS_FOR_FORCED_BAR) return null;

  const columns = Object.keys(rows[0]);
  const sample = rows.slice(0, 5);
  const numeric = columns.filter((c) => sample.every((r) => r[c] != null && isNumeric(r[c])));
  const dimensions = columns.filter((c) => !numeric.includes(c));

  if (dimensions.length !== 1 || numeric.length === 0) return null;

  return {
    xField: dimensions[0],
    yField: numeric.includes(preferredY) ? preferredY : numeric[0],
  };
}

/**
 * Traduce la salida del modelo al contrato de la API (ARQUITECTURA.md §5).
 * Descarta la sugerencia de chart si los campos no existen en las filas: un
 * chart que apunta a una columna inventada rompe la UI de la Fase 2.
 */
export function toApiChart(summary, rows) {
  const type = summary.chart_suggestion;
  if (!type || type === 'none') return null;

  const columns = new Set(rows.length > 0 ? Object.keys(rows[0]) : []);
  const { x_field: xField, y_field: yField, title } = summary.chart_config ?? {};

  const asTable = { type: 'table', xField: null, yField: null, title: title ?? '' };

  if (type === 'table' || !columns.has(xField) || !columns.has(yField)) {
    // La tabla siempre se pinta aparte, así que ascender a barras no esconde
    // ningún dato: solo añade una lectura visual donde la hay.
    const bar = findBarFields(rows, yField);
    return bar ? { type: 'bar', ...bar, title: title ?? '' } : asTable;
  }

  return { type, xField, yField, title: title ?? '' };
}
