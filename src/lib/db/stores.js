/**
 * Resolución del store activo.
 *
 * REGLA DURA (docs/ARQUITECTURA.md §3): el `store_id` se deriva SIEMPRE en el
 * servidor. Nunca lo elige el LLM ni llega del cliente.
 */

import postgres from 'postgres';

const DEMO_SHOP_DOMAIN = 'demo-store.myshopify.com';

const globalForStores = globalThis;

/**
 * El store demo se resuelve con la conexión admin porque `stores` no está
 * expuesta en ninguna vista scoped —y no debe estarlo: contiene access_token.
 */
function getAdminClient() {
  if (!globalForStores.__adminPool) {
    const url = process.env.DATABASE_URL_ADMIN;
    if (!url) throw new Error('DATABASE_URL_ADMIN no está configurada');
    globalForStores.__adminPool = postgres(url, {
      max: 2,
      idle_timeout: 20,
      prepare: false,
      onnotice: () => {},
    });
  }
  return globalForStores.__adminPool;
}

/** Cacheado en el proceso: el store demo es fijo y no cambia entre requests. */
export async function getDemoStore() {
  if (globalForStores.__demoStore) return globalForStores.__demoStore;

  const sql = getAdminClient();
  const [store] = await sql`
    select id, shop_name, currency, platform
      from stores
     where shop_domain = ${DEMO_SHOP_DOMAIN}
     limit 1
  `;

  if (!store) {
    throw new Error('No existe el store demo. Ejecuta: npm run db:seed');
  }

  globalForStores.__demoStore = store;
  return store;
}

/**
 * Rango temporal de los pedidos del store demo.
 *
 * La demo se enseña a desconocidos y el seed no llega hasta hoy: sin decir qué
 * periodo cubre, "¿cuánto he facturado este mes?" contesta correctamente que
 * cero y parece que el producto está roto. El rango se lee de la base, no se
 * escribe a mano, para que no mienta si se vuelve a sembrar.
 */
export async function getDemoDataRange() {
  if (globalForStores.__demoRange) return globalForStores.__demoRange;

  const store = await getDemoStore();
  const sql = getAdminClient();
  const [range] = await sql`
    select min(created_at_platform) as first_order_at,
           max(created_at_platform) as last_order_at
      from orders
     where store_id = ${store.id}
  `;

  if (!range?.first_order_at) return null;

  globalForStores.__demoRange = {
    from: range.first_order_at.toISOString(),
    to: range.last_order_at.toISOString(),
  };
  return globalForStores.__demoRange;
}

/**
 * Resuelve el store para una petición.
 *
 * TODO Fase 3: cuando exista auth, `source: 'store'` debe resolver el store del
 * usuario autenticado leyendo la sesión de Supabase en el servidor. El `storeId`
 * NO puede venir del body de la request bajo ningún concepto.
 */
export async function resolveStore({ source }) {
  if (source === 'demo') return getDemoStore();

  if (source === 'store') {
    throw new Error('source "store" requiere autenticación (Fase 3)');
  }

  throw new Error(`source no soportado: ${source}`);
}
