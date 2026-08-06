/**
 * Verificación manual del criterio 4 de la Fase 1.
 *
 *   node --env-file=.env.local scripts/verify-manual.js
 *
 * Un pipeline que devuelve SQL ejecutable pero con la agregación equivocada pasa
 * el eval y falla el producto. Aquí se cogen 5 preguntas, se deja que el
 * pipeline genere su SQL, y el número que devuelve se contrasta contra una
 * consulta de control escrita a mano contra las TABLAS BASE — otra ruta, otro
 * SQL, mismo número esperado.
 *
 * Si las dos cifras no coinciden, el pipeline está agregando mal aunque el eval
 * diga que va bien.
 */

import postgres from 'postgres';

import { getDemoStore } from '../src/lib/db/stores.js';
import { runQueryPipeline } from '../src/lib/llm/pipeline.js';

const sql = postgres(process.env.DATABASE_URL_ADMIN, { max: 1, prepare: false, onnotice: () => {} });

/**
 * Cada caso trae su consulta de control contra las tablas base y una función que
 * extrae la cifra comparable del resultado del pipeline.
 */
const CASES = [
  {
    id: 'v1',
    question: '¿Cuántos pedidos tengo en total?',
    control: async (storeId) => {
      const [r] = await sql`select count(*)::int as n from orders where store_id = ${storeId}`;
      return r.n;
    },
    extract: (rows) => firstNumber(rows),
    label: 'total de pedidos',
  },
  {
    id: 'v2',
    question: 'What is my total revenue across all time?',
    control: async (storeId) => {
      // Misma convención que el COMMENT de v_orders.financial_status: los
      // pedidos devueltos por completo no cuentan; los parcialmente devueltos
      // sí, porque el schema no guarda el importe reembolsado.
      const [r] = await sql`
        select round(sum(total_price), 2)::float8 as v
          from orders
         where store_id = ${storeId} and financial_status <> 'refunded'`;
      return r.v;
    },
    extract: (rows) => firstNumber(rows),
    label: 'facturación total (excluye pedidos devueltos por completo)',
    tolerance: 0.02,
  },
  {
    id: 'v3',
    question: '¿Cuál es mi ticket medio considerando todo el histórico de la tienda?',
    control: async (storeId) => {
      const [r] = await sql`
        select round(avg(total_price), 2)::float8 as v
          from orders
         where store_id = ${storeId} and financial_status <> 'refunded'`;
      return r.v;
    },
    extract: (rows) => firstNumber(rows),
    label: 'AOV (excluye pedidos devueltos por completo)',
    tolerance: 0.02,
  },
  {
    id: 'v4',
    question: 'Which product sold the most units of all time?',
    control: async (storeId) => {
      const [r] = await sql`
        select p.title, sum(oi.quantity)::int as units
          from order_items oi
          join products p on p.id = oi.product_id
         where oi.store_id = ${storeId}
         group by p.title
         order by units desc
         limit 1`;
      return { title: r.title, units: r.units };
    },
    extract: (rows) => {
      if (rows.length === 0) return null;
      const row = rows[0];
      // El modelo suele seleccionar product_ref y title juntos: se guardan
      // todos los textos de la fila y basta con que el título esperado sea uno
      // de ellos. Quedarse con el primer string compararía contra 'prod_0052'.
      const texts = Object.values(row).filter((v) => typeof v === 'string');
      const units = Object.values(row).find((v) => typeof v === 'number');
      return { texts, units };
    },
    compare: (got, want) => got && got.units === want.units && got.texts.includes(want.title),
    format: (v) => (v ? `${v.texts ? v.texts.join(' / ') : v.title} (${v.units} uds)` : 'null'),
    label: 'producto más vendido por unidades',
  },
  {
    id: 'v5',
    question: '¿Cuántos clientes han comprado más de una vez?',
    control: async (storeId) => {
      const [r] = await sql`
        select count(*)::int as n from customers
         where store_id = ${storeId} and orders_count >= 2`;
      return r.n;
    },
    extract: (rows) => firstNumber(rows),
    label: 'clientes recurrentes',
  },
];

function firstNumber(rows) {
  if (rows.length === 0) return null;
  const value = Object.values(rows[0]).find((v) => typeof v === 'number');
  return value ?? null;
}

async function main() {
  const store = await getDemoStore();
  console.log(`Store: ${store.shop_name} (${store.id})\n`);
  console.log('Cada caso compara el número del pipeline contra una consulta de control');
  console.log('escrita a mano contra las tablas base.\n');

  let passed = 0;

  for (const testCase of CASES) {
    const expected = await testCase.control(store.id);
    const result = await runQueryPipeline({ question: testCase.question, store, skipSummary: true });

    console.log('─'.repeat(78));
    console.log(`[${testCase.id}] ${testCase.question}`);
    console.log(`      métrica: ${testCase.label}`);

    if (!result.ok) {
      console.log(`      ✗ el pipeline falló: ${result.code} — ${result.detail ?? ''}`);
      continue;
    }

    const got = testCase.extract(result.payload.rows);
    const format = testCase.format ?? ((v) => String(v));

    const ok = testCase.compare
      ? testCase.compare(got, expected)
      : got !== null && Math.abs(Number(got) - Number(expected)) <= (testCase.tolerance ?? 0);

    console.log(`      SQL del LLM: ${result.payload.sql.replace(/\s+/g, ' ').slice(0, 120)}`);
    console.log(`      control (tablas base): ${format(expected)}`);
    console.log(`      pipeline (vistas):     ${format(got)}`);
    console.log(`      ${ok ? '✓ COINCIDE' : '✗ NO COINCIDE'}`);

    if (ok) passed += 1;
  }

  console.log('─'.repeat(78));
  console.log(`\nVerificación manual: ${passed}/${CASES.length} coinciden con el control.`);

  await sql.end();
  process.exitCode = passed === CASES.length ? 0 : 1;
  process.exit(process.exitCode);
}

await main();
