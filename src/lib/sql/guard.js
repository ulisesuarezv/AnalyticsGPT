/**
 * Validador de SQL generado por el LLM — capa 1 de aislamiento.
 * Especificación: docs/ARQUITECTURA.md §3.
 *
 * Principio: RECHAZA, NO SANEA. Sanear invita a bypasses; rechazar es auditable.
 * Ninguna transformación del SQL sale de aquí: si algo huele mal, se descarta la
 * consulta entera y se le pide otra al modelo.
 *
 * Este validador es la primera de tres capas. Las otras dos (rol `query_runner`
 * sin privilegios sobre tablas base, y vistas scoped por tenant) siguen ahí si
 * esta falla. Aun así, trátalo como si fuera la única.
 */

export const GUARD_CODES = {
  EMPTY: 'EMPTY',
  TOO_LONG: 'TOO_LONG',
  UNTERMINATED_LITERAL: 'UNTERMINATED_LITERAL',
  COMMENT: 'COMMENT',
  DOLLAR_QUOTE: 'DOLLAR_QUOTE',
  BAD_IDENTIFIER: 'BAD_IDENTIFIER',
  MULTIPLE_STATEMENTS: 'MULTIPLE_STATEMENTS',
  NOT_A_SELECT: 'NOT_A_SELECT',
  FORBIDDEN_KEYWORD: 'FORBIDDEN_KEYWORD',
  FORBIDDEN_IDENTIFIER: 'FORBIDDEN_IDENTIFIER',
  UNKNOWN_TABLE: 'UNKNOWN_TABLE',
};

const MAX_LENGTH = 8000;

/** Vistas scoped que el LLM puede tocar en el flujo de datos de tienda. */
export const POSTGRES_ALLOWED_TABLES = [
  'v_orders',
  'v_order_items',
  'v_products',
  'v_customers',
  'v_inventory',
];

/** En el flujo CSV solo existe la tabla efímera cargada desde el fichero. */
export const DUCKDB_ALLOWED_TABLES = ['data'];

/**
 * Funciones-tabla permitidas tras FROM/JOIN. No acceden a datos: solo generan
 * filas. `generate_series` es necesaria para rellenar días sin ventas, que de
 * otro modo desaparecen de las series temporales.
 */
const TABLE_FUNCTIONS = {
  postgres: ['generate_series', 'unnest'],
  duckdb: ['generate_series', 'range', 'unnest'],
};

/**
 * Palabras que no pueden aparecer NUNCA como token suelto. Incluye DDL, DML,
 * DCL y control de transacción. `into` está aquí porque `SELECT ... INTO` crea
 * una tabla en Postgres.
 */
const FORBIDDEN_KEYWORDS_BASE = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'grant', 'revoke', 'copy', 'call', 'set', 'reset', 'attach', 'detach',
  'merge', 'upsert', 'replace', 'into', 'returning', 'vacuum', 'analyze',
  'explain', 'prepare', 'execute', 'deallocate', 'declare', 'fetch', 'move',
  'do', 'begin', 'commit', 'rollback', 'savepoint', 'release', 'start',
  'listen', 'notify', 'unlisten', 'lock', 'refresh', 'reindex', 'cluster',
  'comment', 'security', 'import', 'export', 'pragma', 'load', 'install',
  'checkpoint', 'discard', 'setof', 'temporary', 'temp', 'unsafe',
];

const FORBIDDEN_KEYWORDS_DUCKDB = [
  'from_csv', 'summarize', 'describe', 'sniff_csv', 'force',
];

/**
 * Identificadores prohibidos por prefijo o nombre exacto: catálogos del sistema,
 * introspección, lectura de ficheros y todo lo que permita salir del sandbox.
 */
const FORBIDDEN_IDENTIFIER_PATTERNS = [
  /\bpg_[a-z0-9_]*/i,
  /\binformation_schema\b/i,
  /\bcurrent_setting\b/i,
  /\bset_config\b/i,
  /\bcurrent_user\b/i,
  /\bsession_user\b/i,
  /\bcurrent_database\b/i,
  /\bcurrent_schema[a-z0-9_]*/i,
  /\bcurrent_catalog\b/i,
  /\bcurrent_role\b/i,
  /\bhas_[a-z0-9_]*_privilege\b/i,
  /\bdblink[a-z0-9_]*/i,
  /\blo_(import|export)\b/i,
  /\bquery_to_xml\b/i,
  /\bversion\s*\(/i,
  /\bxmlelement\b/i,
];

const FORBIDDEN_IDENTIFIER_PATTERNS_DUCKDB = [
  /\bread_[a-z0-9_]+/i,
  /\bduckdb_[a-z0-9_]*/i,
  /\bparquet_[a-z0-9_]*/i,
  /\bcsv_[a-z0-9_]*/i,
  /\bicu_[a-z0-9_]*/i,
  /\bsqlite_[a-z0-9_]*/i,
  /\bpostgres_[a-z0-9_]*/i,
  /\bglob\s*\(/i,
  /\bgetenv\b/i,
  /\bsystem\b/i,
  /\bshell\b/i,
  /\bwhich_secret\b/i,
  /\bsniff\b/i,
];

function fail(code, reason) {
  return { ok: false, code, reason };
}

/**
 * Recorre el SQL carácter a carácter y devuelve una versión "enmascarada" donde
 * los literales de cadena son inertes (`''`) — así ningún chequeo posterior se
 * dispara por contenido dentro de comillas, ni un atacante esconde una palabra
 * prohibida dentro de un literal para que la regex la ignore.
 *
 * Rechaza por el camino comentarios, dollar-quoting y literales sin cerrar.
 */
function mask(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === '-' && next === '-') return fail(GUARD_CODES.COMMENT, 'line comment');
    if (c === '/' && next === '*') return fail(GUARD_CODES.COMMENT, 'block comment');
    if (c === '*' && next === '/') return fail(GUARD_CODES.COMMENT, 'stray block comment terminator');

    // Dollar quoting ($$ ... $$ / $tag$ ... $tag$): sin uso legítimo en un SELECT.
    if (c === '$' && /[$a-zA-Z_]/.test(next ?? '')) {
      return fail(GUARD_CODES.DOLLAR_QUOTE, 'dollar-quoted string');
    }

    if (c === "'") {
      i += 1;
      let closed = false;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; } // '' escapado
          closed = true;
          i += 1;
          break;
        }
        if (sql[i] === '\\') return fail(GUARD_CODES.BAD_IDENTIFIER, 'backslash escape in literal');
        i += 1;
      }
      if (!closed) return fail(GUARD_CODES.UNTERMINATED_LITERAL, 'unterminated string literal');
      out += "''";
      continue;
    }

    if (c === '"') {
      i += 1;
      let ident = '';
      let closed = false;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { ident += '"'; i += 2; continue; }
          closed = true;
          i += 1;
          break;
        }
        ident += sql[i];
        i += 1;
      }
      if (!closed) return fail(GUARD_CODES.UNTERMINATED_LITERAL, 'unterminated quoted identifier');
      // Un identificador entrecomillado solo puede ser un nombre normal. Si trae
      // espacios, puntuación o comillas dentro, es un intento de evasión.
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
        return fail(GUARD_CODES.BAD_IDENTIFIER, `quoted identifier "${ident}"`);
      }
      out += ident.toLowerCase();
      continue;
    }

    out += c;
    i += 1;
  }

  return { ok: true, masked: out };
}

/** Nombres de los CTE declarados en el WITH, que sí pueden usarse tras FROM/JOIN. */
function collectCteNames(masked) {
  const names = new Set();
  const re = /(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_][a-z0-9_]*)\s*(?:\([^)]*\)\s*)?as\s*(?:materialized\s+|not\s+materialized\s+)?\(/gi;
  let m;
  while ((m = re.exec(masked)) !== null) names.add(m[1].toLowerCase());
  return names;
}

/** Palabras que cierran la lista de tablas de un FROM. */
const CLAUSE_BOUNDARY = new Set([
  'where', 'group', 'order', 'limit', 'offset', 'having', 'window', 'union',
  'intersect', 'except', 'join', 'on', 'using', 'left', 'right', 'inner',
  'outer', 'full', 'cross', 'natural', 'lateral', 'when', 'then', 'else',
  'end', 'and', 'or', 'not', 'as', 'qualify', 'for', 'with', 'select',
  'distinct', 'tablesample', 'asof', 'positional', 'anti', 'semi',
]);

function tokenize(masked) {
  return masked.match(/[a-z_][a-z0-9_]*|''|[(),.]|\S/gi) ?? [];
}

/**
 * Identificadores en posición de tabla. No basta con una regex sobre `from|join`:
 * un `FROM v_orders, orders` deja la segunda tabla fuera del radar. Se recorre la
 * lista completa del FROM, saltando subconsultas y alias.
 */
function collectTableRefs(masked) {
  const tokens = tokenize(masked).map((t) => t.toLowerCase());
  const refs = [];

  const skipParens = (start) => {
    let depth = 0;
    let i = start;
    while (i < tokens.length) {
      if (tokens[i] === '(') depth += 1;
      else if (tokens[i] === ')') {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
    return tokens.length;
  };

  const isIdent = (t) => t !== undefined && /^[a-z_][a-z0-9_]*$/.test(t);

  for (let idx = 0; idx < tokens.length; idx += 1) {
    const t = tokens[idx];
    if (t !== 'from' && t !== 'join') continue;

    let i = idx + 1;
     
    while (true) {
      while (tokens[i] === 'lateral' || tokens[i] === 'only') i += 1;

      if (tokens[i] === '(') {
        i = skipParens(i);
      } else if (isIdent(tokens[i])) {
        let name = tokens[i];
        i += 1;
        if (tokens[i] === '.' && isIdent(tokens[i + 1])) {
          const schema = name;
          name = tokens[i + 1];
          i += 2;
          if (schema !== 'public') {
            refs.push({ name: `${schema}.${name}`, qualified: true });
            name = null;
          }
        }
        if (name !== null) refs.push({ name, qualified: false });
        // Argumentos de una función-tabla: `from generate_series(a, b, c)`.
        if (tokens[i] === '(') i = skipParens(i);
      } else {
        break;
      }

      // Alias, con o sin AS.
      if (tokens[i] === 'as') i += 2;
      else if (isIdent(tokens[i]) && !CLAUSE_BOUNDARY.has(tokens[i])) i += 1;
      if (tokens[i] === '(') i = skipParens(i); // lista de columnas del alias

      if (t === 'from' && tokens[i] === ',') { i += 1; continue; }
      break;
    }
  }

  return refs;
}

/**
 * Valida SQL generado por el LLM.
 *
 * @param {string} sql
 * @param {{ dialect?: 'postgres'|'duckdb', allowedTables?: string[] }} options
 * @returns {{ ok: true, sql: string } | { ok: false, code: string, reason: string }}
 */
export function validateSql(sql, options = {}) {
  const dialect = options.dialect ?? 'postgres';
  if (dialect !== 'postgres' && dialect !== 'duckdb') {
    return fail(GUARD_CODES.NOT_A_SELECT, `unknown dialect ${dialect}`);
  }

  if (typeof sql !== 'string') return fail(GUARD_CODES.EMPTY, 'sql is not a string');

  const trimmed = sql.trim();
  if (!trimmed) return fail(GUARD_CODES.EMPTY, 'empty sql');
  if (trimmed.length > MAX_LENGTH) return fail(GUARD_CODES.TOO_LONG, `${trimmed.length} chars`);

  // Caracteres de control (incluido \0) usados para partir el parseo del servidor.
   
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
    return fail(GUARD_CODES.BAD_IDENTIFIER, 'control character');
  }

  const masking = mask(trimmed);
  if (!masking.ok) return masking;

  const masked = masking.masked;

  // --- un solo statement ----------------------------------------------------
  const withoutTrailing = masked.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return fail(GUARD_CODES.MULTIPLE_STATEMENTS, 'more than one statement');
  }

  const normalized = withoutTrailing.trim();
  const lower = normalized.toLowerCase();

  // Lo que se DEVUELVE es el SQL original, no el enmascarado: el enmascarado
  // tiene los literales vaciados (`interval '30 days'` → `interval ''`) y solo
  // sirve para inspeccionar. Ejecutarlo rompería toda consulta con literales.
  const executable = trimmed.replace(/;\s*$/, '').trim();

  // --- empieza por SELECT, o por un WITH cuyo cuerpo sea SELECT -------------
  if (!/^(select|with)\b/.test(lower)) {
    return fail(GUARD_CODES.NOT_A_SELECT, `starts with ${lower.split(/\s+/)[0]}`);
  }
  if (!/\bselect\b/.test(lower)) {
    return fail(GUARD_CODES.NOT_A_SELECT, 'no select found');
  }

  // --- palabras prohibidas --------------------------------------------------
  const keywords = dialect === 'duckdb'
    ? [...FORBIDDEN_KEYWORDS_BASE, ...FORBIDDEN_KEYWORDS_DUCKDB]
    : FORBIDDEN_KEYWORDS_BASE;

  for (const kw of keywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(lower)) {
      return fail(GUARD_CODES.FORBIDDEN_KEYWORD, kw);
    }
  }

  // --- identificadores prohibidos ------------------------------------------
  const patterns = dialect === 'duckdb'
    ? [...FORBIDDEN_IDENTIFIER_PATTERNS, ...FORBIDDEN_IDENTIFIER_PATTERNS_DUCKDB]
    : FORBIDDEN_IDENTIFIER_PATTERNS;

  for (const re of patterns) {
    const m = lower.match(re);
    if (m) return fail(GUARD_CODES.FORBIDDEN_IDENTIFIER, m[0].trim());
  }

  // --- solo tablas del catálogo expuesto ------------------------------------
  const allowed = new Set(
    (options.allowedTables ?? (dialect === 'duckdb' ? DUCKDB_ALLOWED_TABLES : POSTGRES_ALLOWED_TABLES))
      .map((t) => t.toLowerCase()),
  );
  const ctes = collectCteNames(lower);
  const tableFns = new Set(TABLE_FUNCTIONS[dialect]);

  for (const ref of collectTableRefs(lower)) {
    if (ref.qualified) return fail(GUARD_CODES.UNKNOWN_TABLE, ref.name);
    if (allowed.has(ref.name)) continue;
    if (ctes.has(ref.name)) continue;
    if (tableFns.has(ref.name)) continue;
    if (ref.name === 'lateral') continue; // `from lateral (…)`
    return fail(GUARD_CODES.UNKNOWN_TABLE, ref.name);
  }

  return { ok: true, sql: executable };
}
