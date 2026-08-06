/**
 * Ejecución de SQL generado por el LLM, scoped al tenant.
 * Especificación: docs/ARQUITECTURA.md §3.
 *
 * El `storeId` viene SIEMPRE de la sesión del servidor — nunca del cliente y
 * nunca del LLM — y se pasa como parámetro bindeado, jamás interpolado.
 */

import { getReadonlyClient } from './client.js';
import { QueryError, DB_ERROR_CODES, toQueryError } from './errors.js';

/** Tope de filas devueltas al cliente. Por encima se trunca y se avisa. */
export const MAX_ROWS = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ejecuta SQL ya validado por el guard contra las vistas scoped del tenant.
 *
 * @param {{ storeId: string, sql: string, timeoutMs?: number }} params
 * @returns {Promise<{ rows: object[], rowCount: number, truncated: boolean, ms: number }>}
 */
export async function runScopedQuery({ storeId, sql: generatedSql, timeoutMs = 5000 }) {
  if (!UUID_RE.test(storeId ?? '')) {
    // Defensa en profundidad: si esto salta, alguien está construyendo el
    // storeId en un sitio donde no debería.
    throw new QueryError(DB_ERROR_CODES.INVALID_INPUT, 'storeId inválido');
  }

  const sql = getReadonlyClient();
  const startedAt = Date.now();

  try {
    const rows = await sql.begin('read only', async (tx) => {
      await tx.unsafe(`set local statement_timeout = ${Number(timeoutMs)}`);
      // set_config con parámetro bindeado. `SET LOCAL app.store_id = $1` no
      // admite parámetros en Postgres, por eso se usa la función.
      await tx`select set_config('app.store_id', ${storeId}, true)`;

      // MAX_ROWS + 1 para poder distinguir "justo el tope" de "había más".
      return tx.unsafe(generatedSql).execute().then((r) => r.slice(0, MAX_ROWS + 1));
    });

    const truncated = rows.length > MAX_ROWS;
    const finalRows = truncated ? rows.slice(0, MAX_ROWS) : rows;

    return {
      rows: finalRows.map(normalizeRow),
      rowCount: finalRows.length,
      truncated,
      ms: Date.now() - startedAt,
    };
  } catch (error) {
    throw toQueryError(error);
  }
}

/**
 * Deja las filas listas para JSON: las fechas a ISO y los BigInt (los `count(*)`
 * de Postgres son int8) a number. Sin esto, `JSON.stringify` revienta con
 * BigInt y el LLM recibe fechas como objetos vacíos.
 */
function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) out[key] = value.toISOString();
    else if (typeof value === 'bigint') out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}
