/**
 * LLM #2 — resultado real → respuesta natural + chart + insights.
 *
 * Prompt base: docs/PRODUCTO.md §9. Salida estructurada con `Output.object` y
 * schema Zod: nada de parsear JSON a mano.
 *
 * Los números salen SIEMPRE del resultado de la query. Este modelo redacta, no
 * calcula (docs/ARQUITECTURA.md §1).
 */

import { generateText, Output } from 'ai';
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
6. Keep the main answer to 2-4 sentences. Insights are separate.`;

/**
 * @returns {Promise<{ summary: object, tokens: number, modelId: string }>}
 */
export async function summarizeResult({ question, sql, rows, rowCount, truncated, store }) {
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
    try {
      const result = await generateText({
        model,
        instructions: SYSTEM,
        prompt,
        temperature: 0.2,
        maxOutputTokens: 1200,
        output: Output.object({ schema: summarySchema }),
      });
      tokens += result.usage?.totalTokens ?? 0;
      return { summary: result.output, tokens, modelId };
    } catch (error) {
      lastError = error;
      tokens += error?.usage?.totalTokens ?? 0;
    }
  }

  throw lastError ?? new Error('summarize falló sin error');
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

  if (type !== 'table') {
    if (!columns.has(xField) || !columns.has(yField)) return { type: 'table', xField: null, yField: null, title: title ?? '' };
  }

  return {
    type,
    xField: columns.has(xField) ? xField : null,
    yField: columns.has(yField) ? yField : null,
    title: title ?? '',
  };
}
