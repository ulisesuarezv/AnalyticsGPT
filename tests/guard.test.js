import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSql, GUARD_CODES } from '../src/lib/sql/guard.js';

const pg = (sql) => validateSql(sql, { dialect: 'postgres' });
const duck = (sql) => validateSql(sql, { dialect: 'duckdb' });

function assertRejected(result, code) {
  assert.equal(result.ok, false, `esperaba rechazo, pasó: ${JSON.stringify(result)}`);
  if (code) assert.equal(result.code, code, `código inesperado (${result.reason})`);
}

// -----------------------------------------------------------------------------
// SQL legítimo — el guard no puede ser tan estricto que rompa el producto
// -----------------------------------------------------------------------------

test('acepta un select simple', () => {
  assert.equal(pg('select order_number, total_price from v_orders limit 10').ok, true);
});

test('acepta agregaciones con group by y having', () => {
  const r = pg(`
    select product_ref, sum(line_total) as revenue, sum(quantity) as units
      from v_order_items
     where created_at_platform >= now() - interval '30 days'
     group by product_ref
    having sum(quantity) > 5
     order by revenue desc
     limit 20
  `);
  assert.equal(r.ok, true, r.reason);
});

test('acepta CTEs, incluido un WITH con varias ramas', () => {
  const r = pg(`
    with this_month as (
      select sum(total_price) as revenue from v_orders
       where created_at_platform >= date_trunc('month', now())
    ), last_month as (
      select sum(total_price) as revenue from v_orders
       where created_at_platform >= date_trunc('month', now() - interval '1 month')
         and created_at_platform < date_trunc('month', now())
    )
    select t.revenue as this_month, l.revenue as last_month
      from this_month t, last_month l
  `);
  assert.equal(r.ok, true, r.reason);
});

test('acepta joins entre vistas y subconsultas', () => {
  const r = pg(`
    select c.country, count(*) as orders
      from v_orders o
      join v_customers c on c.customer_ref = o.customer_ref
     where o.financial_status = 'paid'
     group by c.country
  `);
  assert.equal(r.ok, true, r.reason);
});

test('acepta subconsulta en el FROM', () => {
  const r = pg('select x.d, x.n from (select created_at_platform as d, count(*) as n from v_orders group by 1) x');
  assert.equal(r.ok, true, r.reason);
});

test('acepta generate_series para rellenar días sin ventas', () => {
  const r = pg(`
    select d.day, coalesce(sum(o.total_price), 0) as revenue
      from generate_series(now() - interval '30 days', now(), interval '1 day') as d(day)
      left join v_orders o on date_trunc('day', o.created_at_platform) = d.day
     group by d.day
  `);
  assert.equal(r.ok, true, r.reason);
});

test('acepta public.v_orders cualificado', () => {
  assert.equal(pg('select order_number from public.v_orders').ok, true);
});

test('acepta un punto y coma final', () => {
  const r = pg('select order_number from v_orders;');
  assert.equal(r.ok, true);
  assert.equal(r.sql.endsWith(';'), false, 'el punto y coma final se normaliza fuera');
});

test('acepta literales con apóstrofos escapados', () => {
  assert.equal(pg("select title from v_products where vendor = 'O''Neill'").ok, true);
});

// -----------------------------------------------------------------------------
// Estructura del statement
// -----------------------------------------------------------------------------

test('rechaza varios statements', () => {
  assertRejected(pg('select 1 from v_orders; drop table orders'), GUARD_CODES.MULTIPLE_STATEMENTS);
});

test('rechaza un segundo statement escondido tras punto y coma y salto de línea', () => {
  assertRejected(pg('select 1 from v_orders;\n\n  select 2 from v_orders'), GUARD_CODES.MULTIPLE_STATEMENTS);
});

test('un punto y coma dentro de un literal no cuenta como separador', () => {
  assert.equal(pg("select title from v_products where tags = 'a;b'").ok, true);
});

test('rechaza lo que no empieza por select o with', () => {
  assertRejected(pg('drop table orders'), GUARD_CODES.NOT_A_SELECT);
  assertRejected(pg('update v_orders set total_price = 0'), GUARD_CODES.NOT_A_SELECT);
  assertRejected(pg('   \n  delete from v_orders'), GUARD_CODES.NOT_A_SELECT);
});

test('rechaza vacío y no-strings', () => {
  assertRejected(pg(''), GUARD_CODES.EMPTY);
  assertRejected(pg('   '), GUARD_CODES.EMPTY);
  assertRejected(validateSql(null), GUARD_CODES.EMPTY);
  assertRejected(validateSql({ sql: 'select 1' }), GUARD_CODES.EMPTY);
});

test('rechaza SQL desmesurado', () => {
  assertRejected(pg(`select ${'a,'.repeat(5000)}b from v_orders`), GUARD_CODES.TOO_LONG);
});

// -----------------------------------------------------------------------------
// DDL / DML / DCL, incluso dentro de un WITH
// -----------------------------------------------------------------------------

test('rechaza DML escondido dentro de un CTE', () => {
  assertRejected(
    pg('with x as (delete from v_orders returning total_price) select * from x'),
    GUARD_CODES.FORBIDDEN_KEYWORD,
  );
  assertRejected(
    pg("with x as (insert into v_orders values (1) returning 1) select * from x"),
    GUARD_CODES.FORBIDDEN_KEYWORD,
  );
});

test('rechaza SELECT ... INTO, que crea una tabla', () => {
  assertRejected(pg('select order_number into new_table from v_orders'), GUARD_CODES.FORBIDDEN_KEYWORD);
});

test('rechaza SET, COPY, CALL, GRANT, TRUNCATE, ATTACH', () => {
  for (const sql of [
    'select 1 from v_orders where 1 = (set role postgres)',
    'select 1 from v_orders union copy v_orders to stdout',
    'select 1 from v_orders union all call foo()',
    'select 1 from v_orders union grant select on orders to public',
    'select 1 from v_orders union truncate orders',
    'select 1 from v_orders union attach database x',
  ]) {
    assertRejected(pg(sql), GUARD_CODES.FORBIDDEN_KEYWORD);
  }
});

test('offset no se confunde con set', () => {
  assert.equal(pg('select order_number from v_orders limit 10 offset 20').ok, true);
});

// -----------------------------------------------------------------------------
// Comentarios y evasión léxica
// -----------------------------------------------------------------------------

test('rechaza comentarios de línea y de bloque', () => {
  assertRejected(pg('select 1 from v_orders -- ; drop table orders'), GUARD_CODES.COMMENT);
  assertRejected(pg('select /* drop */ 1 from v_orders'), GUARD_CODES.COMMENT);
  assertRejected(pg('select 1 from v_orders /*! union select * from orders */'), GUARD_CODES.COMMENT);
});

test('rechaza dollar quoting', () => {
  assertRejected(pg('select $$anything$$ from v_orders'), GUARD_CODES.DOLLAR_QUOTE);
  assertRejected(pg('select $tag$x$tag$ from v_orders'), GUARD_CODES.DOLLAR_QUOTE);
});

test('rechaza literales sin cerrar', () => {
  assertRejected(pg("select title from v_products where vendor = 'abc"), GUARD_CODES.UNTERMINATED_LITERAL);
});

test('rechaza caracteres de control', () => {
  assertRejected(pg('select 1 \u0000 from v_orders'), GUARD_CODES.BAD_IDENTIFIER);
});

test('rechaza identificadores entrecomillados con contenido raro', () => {
  assertRejected(pg('select "a b; drop table orders" from v_orders'), GUARD_CODES.BAD_IDENTIFIER);
});

test('un identificador entrecomillado normal sí pasa, y se desenmascara para el chequeo de tablas', () => {
  assert.equal(pg('select "total_price" from "v_orders"').ok, true);
  assertRejected(pg('select 1 from "orders"'), GUARD_CODES.UNKNOWN_TABLE);
});

// -----------------------------------------------------------------------------
// Catálogo del sistema
// -----------------------------------------------------------------------------

test('rechaza pg_catalog, pg_* e information_schema', () => {
  assertRejected(pg('select 1 from pg_catalog.pg_tables'), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(pg('select tablename from pg_tables'), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(pg('select table_name from information_schema.tables'), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(pg('select rolname from pg_roles'), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(pg('select pg_sleep(10) from v_orders'), GUARD_CODES.FORBIDDEN_IDENTIFIER);
});

test('rechaza introspección de sesión y del tenant', () => {
  assertRejected(pg("select current_setting('app.store_id') from v_orders"), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(pg("select set_config('app.store_id', 'x', false) from v_orders"), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(pg('select current_user from v_orders'), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(pg('select version() from v_orders'), GUARD_CODES.FORBIDDEN_IDENTIFIER);
});

// -----------------------------------------------------------------------------
// Allowlist de tablas
// -----------------------------------------------------------------------------

test('rechaza las tablas base', () => {
  assertRejected(pg('select * from orders'), GUARD_CODES.UNKNOWN_TABLE);
  assertRejected(pg('select * from stores'), GUARD_CODES.UNKNOWN_TABLE);
  assertRejected(pg('select access_token from stores'), GUARD_CODES.UNKNOWN_TABLE);
  assertRejected(pg('select * from auth.users'), GUARD_CODES.UNKNOWN_TABLE);
});

test('rechaza una tabla base colada como segundo elemento del FROM', () => {
  assertRejected(pg('select o.total_price from v_orders o, orders b'), GUARD_CODES.UNKNOWN_TABLE);
  assertRejected(pg('select 1 from v_orders as a, v_products as b, customers as c'), GUARD_CODES.UNKNOWN_TABLE);
});

test('rechaza una tabla base en un JOIN', () => {
  assertRejected(pg('select 1 from v_orders o join stores s on true'), GUARD_CODES.UNKNOWN_TABLE);
});

test('rechaza una tabla base dentro de una subconsulta', () => {
  assertRejected(pg('select (select count(*) from orders) as n from v_orders'), GUARD_CODES.UNKNOWN_TABLE);
});

test('rechaza schemas distintos de public', () => {
  assertRejected(pg('select 1 from auth.users'), GUARD_CODES.UNKNOWN_TABLE);
  assertRejected(pg('select 1 from storage.objects'), GUARD_CODES.UNKNOWN_TABLE);
});

test('un CTE puede llamarse como quiera y usarse en el FROM', () => {
  const r = pg('with orders_by_day as (select 1 as n from v_orders) select n from orders_by_day');
  assert.equal(r.ok, true, r.reason);
});

test('un CTE no legitima la tabla base del mismo nombre', () => {
  // El CTE se llama `x`; `orders` sigue siendo la tabla base.
  assertRejected(pg('with x as (select 1) select * from orders'), GUARD_CODES.UNKNOWN_TABLE);
});

test('respeta un allowlist explícito', () => {
  assertRejected(validateSql('select 1 from v_orders', { dialect: 'postgres', allowedTables: ['v_products'] }), GUARD_CODES.UNKNOWN_TABLE);
  assert.equal(validateSql('select 1 from v_orders', { dialect: 'postgres', allowedTables: ['v_orders'] }).ok, true);
});

// -----------------------------------------------------------------------------
// Dialecto DuckDB
// -----------------------------------------------------------------------------

test('duckdb: acepta la tabla data', () => {
  assert.equal(duck('select count(*) as n from data').ok, true);
});

test('duckdb: rechaza lectura de ficheros', () => {
  assertRejected(duck("select * from read_csv_auto('/etc/passwd')"), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(duck("select * from read_parquet('s3://x/y')"), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(duck("select * from read_json_auto('x.json')"), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(duck("select * from glob('/**')"), GUARD_CODES.FORBIDDEN_IDENTIFIER);
});

test('duckdb: rechaza ATTACH, INSTALL, LOAD y PRAGMA', () => {
  assertRejected(duck("select 1 from data union attach 'x.db'"), GUARD_CODES.FORBIDDEN_KEYWORD);
  assertRejected(duck('select 1 from data union install httpfs'), GUARD_CODES.FORBIDDEN_KEYWORD);
  assertRejected(duck('select 1 from data union load httpfs'), GUARD_CODES.FORBIDDEN_KEYWORD);
  assertRejected(duck('select 1 from data union pragma database_list'), GUARD_CODES.FORBIDDEN_KEYWORD);
});

test('duckdb: rechaza catálogos internos', () => {
  assertRejected(duck('select * from duckdb_settings()'), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(duck('select * from duckdb_tables()'), GUARD_CODES.FORBIDDEN_IDENTIFIER);
  assertRejected(duck("select getenv('OPENAI_API_KEY') from data"), GUARD_CODES.FORBIDDEN_IDENTIFIER);
});

test('duckdb: rechaza tablas fuera del allowlist', () => {
  assertRejected(duck('select * from v_orders'), GUARD_CODES.UNKNOWN_TABLE);
});

test('postgres y duckdb no comparten allowlist', () => {
  assertRejected(pg('select 1 from data'), GUARD_CODES.UNKNOWN_TABLE);
});

test('rechaza un dialecto desconocido', () => {
  assertRejected(validateSql('select 1 from v_orders', { dialect: 'mysql' }));
});

// -----------------------------------------------------------------------------
// Regresión: el guard devuelve el SQL EJECUTABLE, no el enmascarado
// -----------------------------------------------------------------------------

test('devuelve el SQL original, con los literales intactos', () => {
  const sql = "select sum(total_price) from v_orders where created_at_platform >= now() - interval '30 days' and financial_status = 'paid'";
  const r = pg(sql);
  assert.equal(r.ok, true, r.reason);
  // El enmascarado vacía los literales; ejecutar eso rompe toda consulta con
  // fechas o filtros por texto.
  assert.match(r.sql, /interval '30 days'/, 'el literal de interval se ha perdido');
  assert.match(r.sql, /'paid'/, 'el literal de texto se ha perdido');
  assert.equal(r.sql, sql);
});

test('preserva mayúsculas y apóstrofos escapados del original', () => {
  const r = pg("SELECT title FROM v_products WHERE vendor = 'O''Neill'");
  assert.equal(r.ok, true);
  assert.equal(r.sql, "SELECT title FROM v_products WHERE vendor = 'O''Neill'");
});
