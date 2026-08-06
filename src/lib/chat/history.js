/**
 * Composición del `historySummary` que exige el contrato (ARQUITECTURA.md §5).
 *
 * La ruta NO va a buscar el historial: quien llama decide qué contexto manda.
 * En esta fase no hay persistencia, así que el resumen se compone en cliente a
 * partir de la conversación en curso. En la Fase 3, cuando `messages` se
 * persista, esto se recompone en servidor y el contrato no cambia.
 *
 * Es lo que hace que "¿y el mes pasado?" signifique algo. El SQL anterior entra
 * en el resumen a propósito: es el contexto más preciso que existe sobre qué se
 * midió exactamente en el turno anterior.
 */

/** Turnos que se mandan. Más contexto es más tokens y más deriva. */
const MAX_TURNS = 3;
const MAX_ANSWER_CHARS = 240;
const MAX_SQL_CHARS = 400;

function truncate(text, max) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * @param {Array<{ role: string, question?: string, answer?: string, sql?: string }>} messages
 * @returns {string|undefined} `undefined` si no hay nada útil que resumir.
 */
export function buildHistorySummary(messages) {
  const turns = [];

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.question) continue;
    if (!message.answer && !message.sql) continue;
    turns.push(message);
  }

  const recent = turns.slice(-MAX_TURNS);
  if (recent.length === 0) return undefined;

  return recent
    .map((turn, index) => {
      const parts = [`Turn ${index + 1}:`, `Q: ${truncate(turn.question, 200)}`];
      if (turn.sql) parts.push(`SQL: ${truncate(turn.sql, MAX_SQL_CHARS)}`);
      if (turn.answer) parts.push(`A: ${truncate(turn.answer, MAX_ANSWER_CHARS)}`);
      return parts.join('\n');
    })
    .join('\n\n');
}
