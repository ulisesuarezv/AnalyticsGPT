/**
 * Motor DuckDB in-memory para el flujo CSV/XLSX.
 *
 * Una instancia por request, se carga la tabla desde filas ya parseadas, se
 * ejecuta y se cierra. Nada persiste entre peticiones.
 *
 * No hay multi-tenancy que romper aquí: cada instancia contiene un único
 * fichero, de un único usuario, y muere con el request. El guard se aplica
 * igual, para evitar ATTACH, lectura de ficheros locales y funciones de sistema
 * (docs/ARQUITECTURA.md §3).
 *
 * DuckDB NO se hidrata nunca con datos de tienda: se descartó deliberadamente.
 */

import { DuckDBInstance } from '@duckdb/node-api';

/** Nombre único de la tabla del flujo CSV. Coincide con el allowlist del guard. */
export const CSV_TABLE = 'data';

const MAX_ROWS = 1000;

/** Infiere el tipo DuckDB de una columna a partir de sus valores. */
function inferType(values) {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (present.length === 0) return 'VARCHAR';

  const allNumbers = present.every((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))));
  if (allNumbers) {
    const allInts = present.every((v) => Number.isInteger(Number(v)));
    if (allInts) return 'BIGINT';

    // Los decimales cortos son casi siempre importes. Con DOUBLE, sumar una
    // columna de precios devuelve 40935.32999999963 en vez de 40935.33, y el
    // producto se vende con que los números son exactos. DECIMAL sí lo es.
    const decimals = present.map((v) => (String(v).split('.')[1] ?? '').length);
    const maxDecimals = Math.max(...decimals);
    const maxDigits = Math.max(...present.map((v) => String(v).replace(/[-.]/g, '').length));
    if (maxDecimals <= 6 && maxDigits <= 18) return `DECIMAL(18,${Math.max(maxDecimals, 2)})`;
    return 'DOUBLE';
  }

  const allDates = present.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(v) && !Number.isNaN(Date.parse(v)));
  if (allDates) return 'TIMESTAMP';

  const allBools = present.every((v) => typeof v === 'boolean' || ['true', 'false'].includes(String(v).toLowerCase()));
  if (allBools) return 'BOOLEAN';

  return 'VARCHAR';
}

/** Escapa un identificador para usarlo como nombre de columna. */
function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Deriva el schema de un conjunto de filas parseadas.
 * @param {object[]} rows
 */
export function inferSchema(rows) {
  if (rows.length === 0) return [];
  const names = Object.keys(rows[0]);
  return names.map((name) => ({
    name,
    type: inferType(rows.map((r) => r[name])),
  }));
}

/** Convierte un valor JS al literal que espera DuckDB, o null. */
function toBoundValue(value, type) {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'BIGINT') {
    const n = Number(value);
    return Number.isFinite(n) ? BigInt(Math.trunc(n)) : null;
  }
  if (type === 'DOUBLE' || type.startsWith('DECIMAL')) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'BOOLEAN') {
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
  }
  if (type === 'TIMESTAMP') return String(value);
  return String(value);
}

/**
 * Crea una instancia in-memory con las filas cargadas en la tabla `data`.
 * Devuelve un handle con `execute` y `close`. **Siempre** cerrar en un finally.
 */
export async function createCsvEngine(rows) {
  const schema = inferSchema(rows);
  if (schema.length === 0) throw new Error('El fichero no tiene columnas');

  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();

  const columnDefs = schema.map((c) => `${quoteIdentifier(c.name)} ${c.type}`).join(', ');
  await connection.run(`create table ${CSV_TABLE} (${columnDefs})`);

  // Inserción por lotes con parámetros: nada del contenido del fichero se
  // concatena al SQL.
  const CHUNK = 500;
  const placeholders = `(${schema.map(() => '?').join(', ')})`;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const sql = `insert into ${CSV_TABLE} values ${chunk.map(() => placeholders).join(', ')}`;
    const params = [];
    for (const row of chunk) {
      for (const col of schema) params.push(toBoundValue(row[col.name], col.type));
    }
    await connection.run(sql, params);
  }

  return {
    schema,
    rowCount: rows.length,

    /** Ejecuta SQL ya validado por el guard con `dialect: 'duckdb'`. */
    async execute(sql) {
      const startedAt = Date.now();
      const reader = await connection.runAndReadAll(sql);
      const all = reader.getRowObjectsJS();
      const truncated = all.length > MAX_ROWS;
      const result = truncated ? all.slice(0, MAX_ROWS) : all;
      return {
        rows: result.map(normalizeRow),
        rowCount: result.length,
        truncated,
        ms: Date.now() - startedAt,
      };
    },

    async close() {
      connection.closeSync();
      instance.closeSync();
    },
  };
}

/** DuckDB devuelve BigInt y objetos de fecha; el contrato de la API es JSON. */
function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = Number(value);
    else if (value instanceof Date) out[key] = value.toISOString();
    else out[key] = value;
  }
  return out;
}
