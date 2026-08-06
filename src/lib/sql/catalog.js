/**
 * Catálogo del schema que ve el LLM.
 *
 * Se GENERA DESDE LA BASE (`pg_catalog` vía la conexión admin, más los
 * `COMMENT ON` de la migración). No se escribe a mano: si cambia el schema, el
 * catálogo cambia con él y no puede desincronizarse.
 *
 * Solo describe las vistas `v_*`. Las tablas base no aparecen nunca, así que el
 * modelo ni siquiera intenta usarlas (docs/ARQUITECTURA.md §3).
 */

import postgres from 'postgres';

import { runScopedQuery } from '../db/query.js';
import { POSTGRES_ALLOWED_TABLES } from './guard.js';

const SAMPLE_ROWS = 3;
const globalForCatalog = globalThis;

function getAdminClient() {
  if (!globalForCatalog.__catalogPool) {
    const url = process.env.DATABASE_URL_ADMIN;
    if (!url) throw new Error('DATABASE_URL_ADMIN no está configurada');
    globalForCatalog.__catalogPool = postgres(url, {
      max: 1, idle_timeout: 20, prepare: false, onnotice: () => {},
    });
  }
  return globalForCatalog.__catalogPool;
}

/** Estructura de las vistas: columnas, tipos y descripción de cada una. */
async function loadSchema() {
  const sql = getAdminClient();

  const rows = await sql`
    select c.relname                                as view_name,
           obj_description(c.oid, 'pg_class')       as view_description,
           a.attname                                as column_name,
           format_type(a.atttypid, a.atttypmod)     as data_type,
           col_description(c.oid, a.attnum)         as column_description,
           a.attnum                                 as position
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'v'
       and c.relname = any(${POSTGRES_ALLOWED_TABLES})
       and a.attnum > 0
       and not a.attisdropped
     order by c.relname, a.attnum
  `;

  const views = new Map();
  for (const row of rows) {
    if (!views.has(row.view_name)) {
      views.set(row.view_name, {
        name: row.view_name,
        description: row.view_description ?? '',
        columns: [],
      });
    }
    views.get(row.view_name).columns.push({
      name: row.column_name,
      type: simplifyType(row.data_type),
      description: row.column_description ?? '',
    });
  }

  return [...views.values()];
}

/** Los tipos internos de Postgres no aportan nada al modelo; se simplifican. */
function simplifyType(pgType) {
  if (pgType.startsWith('timestamp')) return 'timestamp';
  if (pgType.startsWith('numeric')) return 'number';
  if (pgType === 'integer' || pgType === 'bigint' || pgType === 'smallint') return 'integer';
  if (pgType === 'text' || pgType.startsWith('character')) return 'text';
  if (pgType === 'boolean') return 'boolean';
  if (pgType === 'date') return 'date';
  if (pgType === 'uuid') return 'uuid';
  return pgType;
}

/**
 * Filas de muestra reales, leídas por el canal scoped del tenant: el modelo ve
 * datos del store activo, no de otro.
 */
async function loadSampleRows(storeId, views) {
  const samples = {};
  for (const view of views) {
    const columns = view.columns.map((c) => c.name).join(', ');
    try {
      const { rows } = await runScopedQuery({
        storeId,
        sql: `select ${columns} from ${view.name} limit ${SAMPLE_ROWS}`,
        timeoutMs: 3000,
      });
      samples[view.name] = rows;
    } catch {
      // Una vista sin datos no debe tumbar la generación del prompt.
      samples[view.name] = [];
    }
  }
  return samples;
}

/**
 * Devuelve el catálogo completo para un tenant.
 * La estructura se cachea en el proceso (es igual para todos los tenants); las
 * filas de muestra no, porque son datos del store.
 */
export async function getCatalog(storeId) {
  if (!globalForCatalog.__catalogSchema) {
    globalForCatalog.__catalogSchema = await loadSchema();
  }
  const views = globalForCatalog.__catalogSchema;
  const samples = await loadSampleRows(storeId, views);
  return { views, samples };
}

/** Serializa el catálogo al bloque de texto que se inyecta en el prompt. */
export function formatCatalogForPrompt({ views, samples }) {
  const blocks = views.map((view) => {
    const header = `VIEW ${view.name}${view.description ? ` — ${view.description}` : ''}`;
    const columns = view.columns
      .map((c) => `  ${c.name} (${c.type})${c.description ? ` — ${c.description}` : ''}`)
      .join('\n');
    return `${header}\n${columns}`;
  });

  const sampleBlocks = views.map((view) => {
    const rows = samples[view.name] ?? [];
    if (rows.length === 0) return `${view.name}: (sin filas)`;
    return `${view.name}:\n${rows.map((r) => JSON.stringify(r)).join('\n')}`;
  });

  return {
    schema: blocks.join('\n\n'),
    sampleRows: sampleBlocks.join('\n\n'),
  };
}

/** Catálogo del flujo CSV: se deriva del fichero, no de la base. */
export function formatCsvCatalogForPrompt({ columns, sampleRows, rowCount }) {
  const schema = [
    `VIEW data — tabla única cargada desde el fichero del usuario (${rowCount} filas)`,
    ...columns.map((c) => `  ${c.name} (${c.type})`),
  ].join('\n');

  const samples = sampleRows.slice(0, SAMPLE_ROWS).map((r) => JSON.stringify(r)).join('\n');
  return { schema, sampleRows: `data:\n${samples}` };
}
