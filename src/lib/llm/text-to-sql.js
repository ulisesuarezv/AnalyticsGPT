/**
 * LLM #1 — pregunta en lenguaje natural → SQL.
 *
 * Prompt base: docs/PRODUCTO.md §9, adaptado al pipeline real de
 * docs/ARQUITECTURA.md: el dialecto es un parámetro (Postgres para datos de
 * tienda, DuckDB para CSV) y el schema son las vistas scoped, nunca las tablas.
 *
 * Devuelve SQL o `UNANSWERABLE: <motivo>`.
 */

import { generateText } from 'ai';

import { getPrimaryModel, getFallbackModel } from './models.js';

const MAX_RETRIES = 2;

const DIALECT_NOTES = {
  postgres: `- Generate ONLY valid PostgreSQL. No explanations, no markdown.
- For dates use PostgreSQL functions: date_trunc, now(), interval, to_char, date_part.
- NEVER write EXTRACT(field FROM column). Use date_part('field', column) instead — it is
  equivalent. (The SQL guard reads the FROM inside EXTRACT as a table reference and rejects the
  query; see docs/ESTADO.md.)
- The current date is the real clock date; the data may end earlier than today.
- To fill gaps in a time series use generate_series.`,
  duckdb: `- Generate ONLY valid DuckDB SQL. No explanations, no markdown.
- For dates use DuckDB functions: strftime, date_part, date_trunc, current_date, interval.
- There is exactly ONE table, called data. Never reference any other table.`,
};

/**
 * Few-shot de consultas compuestas.
 *
 * La Fase 1 midió el eval en 95%: los 2 fallos eran preguntas que cruzan dos
 * conceptos (ventas × inventario, geografía × crecimiento entre periodos) y el
 * modelo respondía UNANSWERABLE en vez de componer un CTE. Estos dos ejemplos
 * enseñan el patrón —CTE por concepto y join/comparación entre ellos— sin
 * describir ninguna pregunta concreta del eval.
 *
 * Solo para Postgres: el flujo CSV tiene una única tabla y no cruza nada.
 */
const POSTGRES_FEWSHOT = `EXAMPLES OF COMPOSED QUERIES:
When a question needs two different concepts, build one CTE per concept and
combine them. Do NOT answer UNANSWERABLE just because no single view has it all.

Q: Which products sell the most but have the least stock left?
with sold as (
  select oi.product_ref, oi.title, sum(oi.quantity) as units_sold
    from v_order_items oi
   where oi.created_at_platform >= now() - interval '30 days'
     and oi.financial_status <> 'refunded'
   group by oi.product_ref, oi.title
), stock as (
  select i.product_ref, sum(i.quantity) as units_in_stock
    from v_inventory i
   group by i.product_ref
)
select s.title, s.units_sold, coalesce(k.units_in_stock, 0) as units_in_stock
  from sold s
  left join stock k on k.product_ref = s.product_ref
 order by s.units_sold desc
 limit 20

Q: Which country grew the most between the last two months?
with per_month as (
  select c.country,
         date_trunc('month', o.created_at_platform) as month,
         sum(o.total_price) as revenue
    from v_orders o
    join v_customers c on c.customer_ref = o.customer_ref
   where o.created_at_platform >= date_trunc('month', now()) - interval '2 months'
     and o.financial_status <> 'refunded'
   group by c.country, date_trunc('month', o.created_at_platform)
)
select country,
       coalesce(sum(revenue) filter (where month = date_trunc('month', now())), 0) as current_revenue,
       coalesce(sum(revenue) filter (where month = date_trunc('month', now()) - interval '1 month'), 0) as previous_revenue
  from per_month
 group by country
 order by current_revenue - previous_revenue desc
 limit 20

Adapt the shape, never the column names: use only the schema below.`;

function buildSystemPrompt({ dialect, schema, sampleRows }) {
  return `You are a SQL query generator for an ecommerce analytics tool. Convert natural language questions about store data into SQL.

RULES:
${DIALECT_NOTES[dialect]}
- Use exact view and column names from the schema below. Never invent columns.
- Only reference the views listed in the schema. The underlying tables are not accessible.
- For aggregations, always include meaningful aliases.
- If ambiguous, make reasonable assumptions for ecommerce context.
- If the question cannot be answered from available data, respond exactly: UNANSWERABLE: [reason]
- NEVER use SELECT * — always specify columns.
- Limit results to 1000 rows unless the user asks for all.
- Default time range: last 30 days if not specified.
- Currency: use the store's currency, don't convert.
- When comparing periods, use same-length windows (this month vs last month, this week vs last week).
- Never use SQL comments, semicolons beyond the single statement, or multiple statements.
- Return the raw SQL only, with no code fences.

ANSWERABILITY:
The views below are the only data available, but they are rich. Orders carry their amounts
and statuses, line items carry quantities and per-line revenue, customers carry location and
lifetime totals, and inventory carries current stock. Revenue, units sold, order counts,
average order value, discounts, refunds, repeat customers, geography, sales channel and
stock levels are ALL answerable from these columns — a metric does not need to exist as a
literal column to be computable.

Answer UNANSWERABLE only when the question needs a concept with no column at all:
product cost, margin or profit; ad spend, ROAS or attribution; sessions, traffic or
conversion rate; supplier or shipping cost; competitor data.
For those, do not approximate with revenue or invent a proxy metric.

SCHEMA:
${schema}

SAMPLE DATA (${3} rows per view):
${sampleRows}${dialect === 'postgres' ? `\n\n${POSTGRES_FEWSHOT}` : ''}`;
}

function buildUserPrompt({ question, historySummary }) {
  const parts = [`USER QUESTION:\n${question}`];
  if (historySummary) parts.push(`PREVIOUS CONTEXT:\n${historySummary}`);
  return parts.join('\n\n');
}

/** Quita las vallas de código si el modelo las mete pese a las instrucciones. */
function stripFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:sql)?\s*\n?([\s\S]*?)\n?```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * Genera SQL para una pregunta, reintentando con el error de la ejecución.
 *
 * `validate` recibe el SQL y devuelve `{ ok }` del guard; `execute` lo ejecuta.
 * Ambos se inyectan para que esta función no dependa del motor concreto.
 *
 * Estrategia (ARQUITECTURA.md §4): 2 reintentos con el modelo primario metiendo
 * el error en el prompt → 1 intento con el fallback → error honesto.
 *
 * @returns {Promise<{ status: 'ok', sql, result, attempts, tokens, modelId }
 *                  | { status: 'unanswerable', reason, attempts, tokens, modelId }
 *                  | { status: 'failed', error, attempts, tokens, modelId }>}
 */
export async function generateSql({
  question,
  dialect,
  schema,
  sampleRows,
  historySummary,
  validate,
  execute,
}) {
  const system = buildSystemPrompt({ dialect, schema, sampleRows });
  const basePrompt = buildUserPrompt({ question, historySummary });

  let tokens = 0;
  let attempts = 0;
  let lastError = null;
  let lastSql = null;

  const candidates = [
    ...Array.from({ length: MAX_RETRIES + 1 }, () => getPrimaryModel()),
    getFallbackModel(),
  ];

  for (const { model, id: modelId } of candidates) {
    attempts += 1;

    const prompt = lastError
      ? `${basePrompt}\n\nYour previous attempt failed.\n\nPREVIOUS SQL:\n${lastSql}\n\nERROR:\n${lastError}\n\nFix the query. Return only the corrected SQL.`
      : basePrompt;

    let text;
    try {
      const result = await generateText({
        model,
        instructions: system,
        prompt,
        temperature: 0,
        maxOutputTokens: 900,
      });
      text = result.text;
      tokens += result.usage?.totalTokens ?? 0;
    } catch (error) {
      lastError = `LLM call failed: ${error.message}`;
      continue;
    }

    const candidate = stripFences(text);

    if (/^UNANSWERABLE\s*:/i.test(candidate)) {
      return {
        status: 'unanswerable',
        reason: candidate.replace(/^UNANSWERABLE\s*:\s*/i, '').trim(),
        attempts,
        tokens,
        modelId,
      };
    }

    lastSql = candidate;

    const verdict = validate(candidate);
    if (!verdict.ok) {
      // El motivo del rechazo vuelve al prompt: el modelo suele corregirlo a la
      // primera cuando sabe qué regla rompió.
      lastError = `Query rejected by the SQL guard (${verdict.code}: ${verdict.reason}). Only SELECT statements over the listed views are allowed.`;
      continue;
    }

    try {
      const result = await execute(verdict.sql);
      return { status: 'ok', sql: verdict.sql, result, attempts, tokens, modelId };
    } catch (error) {
      lastError = error.promptHint ?? error.message;
    }
  }

  return { status: 'failed', error: lastError, attempts, tokens, modelId: null };
}
