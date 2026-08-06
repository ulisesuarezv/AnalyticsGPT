/**
 * Genera el dataset demo y lo carga en Supabase con la conexión admin.
 *
 *   node --env-file=.env.local scripts/seed-demo.js
 *
 * DETERMINISTA: misma seed, mismos datos. Los números verificados a mano en
 * docs/eval/dataset.md dependen de ello — no metas Math.random() aquí.
 *
 * El "hoy" del dataset también es fijo (DATASET_END): si la ventana de 12 meses
 * se moviera con el reloj, las respuestas esperadas del eval caducarían solas.
 *
 * Los dos patrones plantados a propósito (brief §2) están documentados en
 * docs/eval/dataset.md. Sin ellos los insights de la Fase 2 no tienen nada real
 * que encontrar.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SEED = 20260804;
const DATASET_END = new Date('2026-08-01T00:00:00Z'); // exclusivo
const MONTHS = 12;
const TARGET_ORDERS = 3000;
const N_PRODUCTS = 60;
const N_CUSTOMERS = 1200;

const STORE = {
  platform: 'csv',
  shop_domain: 'demo-store.myshopify.com',
  shop_name: 'Aurora Home & Living',
  currency: 'EUR',
  sync_status: 'complete',
};

// -----------------------------------------------------------------------------
// PRNG determinista (mulberry32)
// -----------------------------------------------------------------------------

function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);
const rand = () => rng();
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round2 = (n) => Math.round(n * 100) / 100;

/** Elige un índice según pesos relativos. */
function weightedIndex(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// -----------------------------------------------------------------------------
// Catálogo
// -----------------------------------------------------------------------------

// Precios calibrados para que el AOV caiga en la banda 40-120 € que pide el
// brief: con ~1,6 líneas y ~1,3 unidades por línea, y el 21% de IVA encima.
const CATEGORIES = [
  { type: 'Kitchen', vendor: 'Aurora Kitchen', priceRange: [11, 48], weight: 26 },
  { type: 'Bedding', vendor: 'Nordic Sleep', priceRange: [19, 72], weight: 22 },
  { type: 'Lighting', vendor: 'Lumen Co', priceRange: [13, 60], weight: 16 },
  { type: 'Decor', vendor: 'Casa Bonita', priceRange: [7, 38], weight: 18 },
  { type: 'Bath', vendor: 'Pure Bath', priceRange: [8, 34], weight: 12 },
  { type: 'Outdoor', vendor: 'Terra Garden', priceRange: [16, 78], weight: 6 },
];

const NOUNS = {
  Kitchen: ['Chef Knife', 'Cutting Board', 'Ceramic Bowl Set', 'Cast Iron Pan', 'Espresso Mug', 'Storage Jar', 'Utensil Holder', 'Mixing Bowl', 'Tea Kettle', 'Serving Platter'],
  Bedding: ['Linen Duvet', 'Cotton Sheet Set', 'Wool Throw', 'Pillow Case Pair', 'Quilted Bedspread', 'Mattress Topper', 'Weighted Blanket', 'Bed Runner'],
  Lighting: ['Table Lamp', 'Pendant Light', 'Floor Lamp', 'Wall Sconce', 'Candle Holder', 'String Lights', 'Reading Light'],
  Decor: ['Wall Mirror', 'Ceramic Vase', 'Picture Frame', 'Woven Basket', 'Wall Art Print', 'Scented Candle', 'Table Runner', 'Bookend Pair'],
  Bath: ['Bath Towel Set', 'Bath Mat', 'Soap Dispenser', 'Shower Curtain', 'Robe', 'Vanity Tray'],
  Outdoor: ['Planter Pot', 'Garden Lantern', 'Outdoor Cushion', 'Picnic Blanket'],
};

const MATERIALS = ['Oak', 'Linen', 'Ceramic', 'Brass', 'Marble', 'Bamboo', 'Stone', 'Copper', 'Walnut', 'Terracotta'];

const COUNTRIES = [
  { country: 'Spain', weight: 42, regions: [['Madrid', ['Madrid', 'Alcalá de Henares']], ['Cataluña', ['Barcelona', 'Girona']], ['Andalucía', ['Sevilla', 'Málaga']], ['Valencia', ['Valencia', 'Alicante']], ['País Vasco', ['Bilbao', 'San Sebastián']], ['Galicia', ['A Coruña', 'Vigo']]] },
  { country: 'France', weight: 18, regions: [['Île-de-France', ['Paris', 'Versailles']], ['Occitanie', ['Toulouse', 'Montpellier']], ['Provence', ['Marseille', 'Nice']]] },
  { country: 'Germany', weight: 14, regions: [['Bayern', ['München', 'Nürnberg']], ['Berlin', ['Berlin']], ['Hamburg', ['Hamburg']]] },
  { country: 'Portugal', weight: 10, regions: [['Lisboa', ['Lisboa', 'Cascais']], ['Porto', ['Porto', 'Braga']]] },
  { country: 'Italy', weight: 9, regions: [['Lombardia', ['Milano', 'Bergamo']], ['Lazio', ['Roma']]] },
  { country: 'Netherlands', weight: 7, regions: [['Noord-Holland', ['Amsterdam', 'Haarlem']], ['Zuid-Holland', ['Rotterdam', 'Den Haag']]] },
];

// -----------------------------------------------------------------------------
// Patrones plantados (ver docs/eval/dataset.md)
// -----------------------------------------------------------------------------

/** P1: un producto concreto se hunde ~40% en los 2 últimos meses. */
const SINKING_PRODUCT_INDEX = 3;
/** P2: una región crece el triple que la media en el último trimestre. */
const SURGING_PROVINCE = 'País Vasco';

const monthStart = (offsetFromEnd) => {
  const d = new Date(DATASET_END);
  d.setUTCMonth(d.getUTCMonth() - offsetFromEnd);
  return d;
};

const DATASET_START = monthStart(MONTHS);

// -----------------------------------------------------------------------------
// Generación
// -----------------------------------------------------------------------------

function buildProducts() {
  const products = [];
  const perCategory = CATEGORIES.map((c) => Math.max(4, Math.round((c.weight / 100) * N_PRODUCTS)));
  let idx = 0;

  CATEGORIES.forEach((cat, ci) => {
    for (let i = 0; i < perCategory[ci] && products.length < N_PRODUCTS; i += 1) {
      const noun = NOUNS[cat.type][i % NOUNS[cat.type].length];
      const material = MATERIALS[(idx * 3 + i) % MATERIALS.length];
      const [lo, hi] = cat.priceRange;
      const price = round2(lo + rand() * (hi - lo));
      products.push({
        platform_product_id: `prod_${String(idx + 1).padStart(4, '0')}`,
        title: `${material} ${noun}`,
        product_type: cat.type,
        vendor: cat.vendor,
        tags: [cat.type.toLowerCase(), rand() < 0.3 ? 'bestseller' : 'core'].join(','),
        status: rand() < 0.94 ? 'active' : 'archived',
        created_at_platform: new Date(DATASET_START.getTime() - randInt(30, 400) * 86400000),
        price,
        // Popularidad heterogénea: unos pocos productos concentran las ventas.
        popularity: rand() < 0.18 ? 4 + rand() * 6 : 0.4 + rand() * 2.2,
      });
      idx += 1;
    }
  });

  // El producto que se hunde es uno de los populares, si no el patrón no se ve.
  products[SINKING_PRODUCT_INDEX].popularity = Math.max(products[SINKING_PRODUCT_INDEX].popularity, 7);
  return products;
}

function buildCustomers() {
  const customers = [];
  for (let i = 0; i < N_CUSTOMERS; i += 1) {
    const c = COUNTRIES[weightedIndex(COUNTRIES.map((x) => x.weight))];
    const [province, cities] = pick(c.regions);
    customers.push({
      platform_customer_id: `cust_${String(i + 1).padStart(5, '0')}`,
      country: c.country,
      province,
      city: pick(cities),
      tags: rand() < 0.12 ? 'vip' : '',
      orders_count: 0,
      total_spent: 0,
      first_order_at: null,
      last_order_at: null,
    });
  }
  return customers;
}

/** Multiplicador de estacionalidad: pico claro en Q4. */
function seasonality(date) {
  const m = date.getUTCMonth(); // 0 = enero
  const byMonth = [0.82, 0.78, 0.9, 0.95, 1.0, 0.95, 0.88, 0.85, 1.0, 1.15, 1.55, 1.75];
  return byMonth[m];
}

function buildOrders(products, customers) {
  const orders = [];
  const items = [];

  const spanMs = DATASET_END.getTime() - DATASET_START.getTime();

  // Reparto de clientes por repetición: mayoría con 1 pedido, cola larga.
  // La media (~2,7) va holgada por encima de TARGET_ORDERS/N_CUSTOMERS = 2,5:
  // parte del pool se pierde en los rechazos que modelan el patrón P2.
  const repeatWeights = customers.map(() => {
    const r = rand();
    if (r < 0.55) return 1;
    if (r < 0.75) return 2;
    if (r < 0.87) return 3;
    if (r < 0.95) return 6;
    return 15;
  });
  const customerPool = [];
  customers.forEach((c, i) => {
    for (let k = 0; k < repeatWeights[i]; k += 1) customerPool.push(i);
  });

  let orderSeq = 0;
  let poolCursor = 0;
  // Baraja determinista del pool para que los pedidos repetidos se dispersen.
  for (let i = customerPool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [customerPool[i], customerPool[j]] = [customerPool[j], customerPool[i]];
  }

  const lastTwoMonthsStart = monthStart(2);
  const lastQuarterStart = monthStart(3);

  while (orders.length < TARGET_ORDERS && poolCursor < customerPool.length) {
    const created = new Date(DATASET_START.getTime() + rand() * spanMs);

    // La estacionalidad se aplica rechazando pedidos fuera de pico.
    if (rand() > seasonality(created) / 1.75) continue;

    const customerIdx = customerPool[poolCursor];
    poolCursor += 1;
    const customer = customers[customerIdx];

    // P2: la región que despega concentra más pedidos en el último trimestre.
    if (created >= lastQuarterStart && customer.province !== SURGING_PROVINCE && rand() < 0.08) continue;
    if (created < lastQuarterStart && customer.province === SURGING_PROVINCE && rand() < 0.55) continue;

    orderSeq += 1;
    const orderNumber = `#${1000 + orderSeq}`;

    // 1-4 líneas por pedido, sesgado a 1-2.
    const nLines = weightedIndex([55, 30, 11, 4]) + 1;
    const chosen = new Set();
    const lines = [];

    for (let l = 0; l < nLines; l += 1) {
      let pIdx = weightedIndex(products.map((p) => p.popularity));
      let guard = 0;
      while (chosen.has(pIdx) && guard < 10) {
        pIdx = weightedIndex(products.map((p) => p.popularity));
        guard += 1;
      }
      if (chosen.has(pIdx)) continue;

      // P1: el producto que se hunde pierde ~1 de cada 3 líneas en los dos
      // últimos meses. Se descarta la línea directamente en vez de tocar su
      // peso relativo: entre 60 productos, bajar un peso apenas mueve la aguja
      // y el patrón queda por debajo del ruido.
      if (pIdx === SINKING_PRODUCT_INDEX && created >= lastTwoMonthsStart && rand() < 0.35) continue;

      chosen.add(pIdx);

      const product = products[pIdx];
      const quantity = weightedIndex([75, 18, 5, 2]) + 1;
      const price = product.price;
      const lineDiscount = rand() < 0.22 ? round2(price * quantity * (0.05 + rand() * 0.15)) : 0;

      lines.push({
        productIdx: pIdx,
        title: product.title,
        variant_title: rand() < 0.35 ? pick(['Small', 'Medium', 'Large', 'Natural', 'Charcoal']) : null,
        sku: `SKU-${product.platform_product_id.slice(5)}-${String(l + 1).padStart(2, '0')}`,
        quantity,
        price,
        total_discount: lineDiscount,
      });
    }

    if (lines.length === 0) continue;

    const subtotal = round2(lines.reduce((s, l) => s + l.price * l.quantity - l.total_discount, 0));
    const discounts = round2(lines.reduce((s, l) => s + l.total_discount, 0));
    const tax = round2(subtotal * 0.21);
    const total = round2(subtotal + tax);

    // Devoluciones en una fracción de los pedidos.
    const r = rand();
    const financial = r < 0.045 ? 'refunded' : r < 0.075 ? 'partially_refunded' : 'paid';
    const fulfillment = created >= monthStart(0.2) && rand() < 0.4
      ? pick(['unfulfilled', 'partial'])
      : 'fulfilled';

    orders.push({
      platform_order_id: `ord_${String(orderSeq).padStart(6, '0')}`,
      order_number: orderNumber,
      created_at_platform: created,
      financial_status: financial,
      fulfillment_status: fulfillment,
      total_price: total,
      subtotal_price: subtotal,
      total_tax: tax,
      total_discounts: discounts,
      currency: STORE.currency,
      customerIdx,
      source_name: rand() < 0.86 ? 'web' : rand() < 0.6 ? 'mobile' : 'pos',
      tags: rand() < 0.15 ? 'promo' : '',
    });

    lines.forEach((l) => items.push({ ...l, orderIndex: orders.length - 1 }));

    // Agregados del cliente: se calculan aquí para que cuadren con los pedidos.
    customer.orders_count += 1;
    customer.total_spent = round2(customer.total_spent + total);
    if (!customer.first_order_at || created < customer.first_order_at) customer.first_order_at = created;
    if (!customer.last_order_at || created > customer.last_order_at) customer.last_order_at = created;
  }

  // Los pedidos se generan en desorden temporal, pero los números de pedido
  // deben crecer con la fecha. Ordenar el array a secas rompería `orderIndex`
  // de cada línea —y con él la correspondencia entre el total del pedido y sus
  // propias líneas—, así que se reordena con remapeo explícito de índices.
  const order = orders.map((_, i) => i).sort(
    (a, b) => orders[a].created_at_platform - orders[b].created_at_platform,
  );
  const newIndexByOld = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  const sorted = order.map((oldIdx) => orders[oldIdx]);

  sorted.forEach((o, i) => {
    o.platform_order_id = `ord_${String(i + 1).padStart(6, '0')}`;
    o.order_number = `#${1000 + i + 1}`;
  });
  items.forEach((it) => { it.orderIndex = newIndexByOld.get(it.orderIndex); });

  return { orders: sorted, items };
}

function buildInventory(products) {
  const inventory = [];
  products.forEach((p, i) => {
    const locations = i % 7 === 0 ? ['Madrid Warehouse', 'Barcelona Store'] : ['Madrid Warehouse'];
    locations.forEach((location, li) => {
      inventory.push({
        productIdx: i,
        sku: `SKU-${p.platform_product_id.slice(5)}-${String(li + 1).padStart(2, '0')}`,
        // Algunos productos en rotura de stock, a propósito.
        quantity: rand() < 0.08 ? 0 : randInt(3, 240),
        location,
      });
    });
  });
  return inventory;
}

// -----------------------------------------------------------------------------
// Carga
// -----------------------------------------------------------------------------

async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) {
    console.error('Falta DATABASE_URL_ADMIN. Ejecuta con: node --env-file=.env.local scripts/seed-demo.js');
    process.exit(1);
  }

  console.log('Generando dataset determinista…');
  const products = buildProducts();
  const customers = buildCustomers();
  const { orders, items } = buildOrders(products, customers);
  const inventory = buildInventory(products);

  const activeCustomers = customers.filter((c) => c.orders_count > 0);
  console.log(`  ${products.length} productos · ${activeCustomers.length} clientes con pedidos · ${orders.length} pedidos · ${items.length} líneas`);

  const sql = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });

  try {
    await sql.begin(async (tx) => {
      // Idempotente: el store demo se identifica por shop_domain y se recrea.
      const existing = await tx`select id from stores where shop_domain = ${STORE.shop_domain}`;
      if (existing.length > 0) {
        console.log('· Borrando el store demo anterior…');
        await tx`delete from stores where shop_domain = ${STORE.shop_domain}`;
      }

      const [store] = await tx`
        insert into stores ${tx(STORE)} returning id
      `;
      const storeId = store.id;
      console.log(`· Store demo: ${storeId}`);

      const customerRows = await tx`
        insert into customers ${tx(activeCustomers.map((c) => ({
          store_id: storeId,
          platform_customer_id: c.platform_customer_id,
          orders_count: c.orders_count,
          total_spent: c.total_spent,
          first_order_at: c.first_order_at,
          last_order_at: c.last_order_at,
          city: c.city,
          province: c.province,
          country: c.country,
          tags: c.tags,
        })))}
        returning id, platform_customer_id
      `;
      const customerIdByRef = new Map(customerRows.map((r) => [r.platform_customer_id, r.id]));
      console.log(`· ${customerRows.length} clientes`);

      const productRows = await tx`
        insert into products ${tx(products.map((p) => ({
          store_id: storeId,
          platform_product_id: p.platform_product_id,
          title: p.title,
          product_type: p.product_type,
          vendor: p.vendor,
          tags: p.tags,
          status: p.status,
          created_at_platform: p.created_at_platform,
        })))}
        returning id, platform_product_id
      `;
      const productIdByRef = new Map(productRows.map((r) => [r.platform_product_id, r.id]));
      console.log(`· ${productRows.length} productos`);

      const orderRows = [];
      const CHUNK = 500;
      for (let i = 0; i < orders.length; i += CHUNK) {
        const chunk = orders.slice(i, i + CHUNK).map((o) => ({
          store_id: storeId,
          platform_order_id: o.platform_order_id,
          order_number: o.order_number,
          created_at_platform: o.created_at_platform,
          financial_status: o.financial_status,
          fulfillment_status: o.fulfillment_status,
          total_price: o.total_price,
          subtotal_price: o.subtotal_price,
          total_tax: o.total_tax,
          total_discounts: o.total_discounts,
          currency: o.currency,
          customer_id: customerIdByRef.get(customers[o.customerIdx].platform_customer_id),
          source_name: o.source_name,
          tags: o.tags,
        }));
        const rows = await tx`insert into orders ${tx(chunk)} returning id, platform_order_id`;
        orderRows.push(...rows);
      }
      const orderIdByRef = new Map(orderRows.map((r) => [r.platform_order_id, r.id]));
      console.log(`· ${orderRows.length} pedidos`);

      const itemPayload = items.map((it) => ({
        order_id: orderIdByRef.get(orders[it.orderIndex].platform_order_id),
        store_id: storeId,
        product_id: productIdByRef.get(products[it.productIdx].platform_product_id),
        variant_title: it.variant_title,
        title: it.title,
        quantity: it.quantity,
        price: it.price,
        total_discount: it.total_discount,
        sku: it.sku,
      }));
      for (let i = 0; i < itemPayload.length; i += CHUNK) {
        await tx`insert into order_items ${tx(itemPayload.slice(i, i + CHUNK))}`;
      }
      console.log(`· ${itemPayload.length} líneas de pedido`);

      await tx`
        insert into inventory ${tx(inventory.map((inv) => ({
          store_id: storeId,
          product_id: productIdByRef.get(products[inv.productIdx].platform_product_id),
          sku: inv.sku,
          quantity: inv.quantity,
          location: inv.location,
        })))}
      `;
      console.log(`· ${inventory.length} registros de inventario`);
    });

    await exportCsv(orders, items, customers, products);
    console.log('\nSeed completo.');
  } finally {
    await sql.end();
  }
}

/**
 * Exporta el dataset como CSV plano (una fila por línea de pedido) para el flujo
 * CSV/DuckDB. Es la misma realidad, desnormalizada.
 */
async function exportCsv(orders, items, customers, products) {
  const headers = [
    'order_number', 'order_date', 'financial_status', 'fulfillment_status',
    'country', 'province', 'city', 'customer_ref',
    'product_title', 'product_type', 'vendor', 'sku', 'variant_title',
    'quantity', 'unit_price', 'line_discount', 'line_total',
    'order_total', 'currency', 'source_name',
  ];

  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [headers.join(',')];
  for (const it of items) {
    const o = orders[it.orderIndex];
    const c = customers[o.customerIdx];
    const p = products[it.productIdx];
    lines.push([
      o.order_number,
      o.created_at_platform.toISOString().slice(0, 10),
      o.financial_status,
      o.fulfillment_status,
      c.country, c.province, c.city, c.platform_customer_id,
      p.title, p.product_type, p.vendor, it.sku, it.variant_title,
      it.quantity, it.price, it.total_discount,
      round2(it.quantity * it.price - it.total_discount),
      o.total_price, o.currency, o.source_name,
    ].map(escape).join(','));
  }

  const dir = join(ROOT, 'public', 'demo-data');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'sample-ecommerce.csv');
  writeFileSync(path, `${lines.join('\n')}\n`);
  console.log(`· CSV exportado: public/demo-data/sample-ecommerce.csv (${lines.length - 1} filas)`);
}

await main();
