# Fase 7 — Shopify OAuth + sync + webhooks

**Estado:** 🔒 **BLOQUEADA**
**Depende de:** Fase 3

## Bloqueo

No se empieza esta fase hasta tener **todo** esto:

- [ ] Cuenta de Shopify Partners
- [ ] Development store con datos de prueba (idealmente varios meses de pedidos, no cuatro pedidos
      creados a mano — el sync y los insights no se pueden validar con eso)
- [ ] App creada en el Partner Dashboard, con `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET`
- [ ] URL de callback registrada (la del preview de Vercel y la de local)

Si falta algo, **para y pídelo**. No construyas contra un mock: el 80% de la dificultad de esta fase
está en el comportamiento real de la API (paginación, rate limits, formas de los datos), y un mock no
reproduce nada de eso.

## Objetivo

Que un seller conecte su tienda en dos clics y, minutos después, pueda preguntarle a sus datos reales.

## Alcance

- `src/lib/shopify/auth.js` — OAuth: `state` firmado y verificado, intercambio de código por token,
  **token cifrado en reposo** en `stores.access_token`
- `src/lib/shopify/graphql.js` — cliente GraphQL Admin API. Versión de API fijada explícitamente
- `src/lib/shopify/sync.js` — sync inicial: pedidos de 12 meses, productos, clientes, inventario
  - Paginación por cursor
  - Respetar el rate limit (coste por query, leaky bucket) con backoff
  - Idempotente: `unique(store_id, platform_order_id)` ya está en el schema; usa upsert
  - Reanudable: una tienda grande no cabe en una sola invocación. Cola o job por lotes, con progreso
    reflejado en `stores.sync_status`
- `src/lib/shopify/webhooks.js` — `orders/create`, `orders/updated`, `products/update`
  - **Verificación HMAC obligatoria** antes de procesar nada
  - Idempotente: Shopify reenvía
  - Responder 200 rápido y procesar aparte; Shopify da un timeout corto
- UI: `/dashboard/connect` con `ShopifyConnect.jsx` y `SyncStatus.jsx` (progreso real, no un spinner
  eterno)
- Scopes exactos: `read_orders,read_products,read_customers,read_inventory`. Ni uno más

## Criterio de aceptación

1. Conectar la dev store desde la app, con OAuth completo
2. El sync inicial termina y los totales cuadran con el admin de Shopify (compara revenue del último
   mes y número de pedidos — si no cuadra, algo se está perdiendo o duplicando)
3. Crear un pedido en Shopify lo refleja en la app vía webhook en menos de un minuto
4. Relanzar el sync no duplica datos
5. El chat responde correctamente sobre los datos reales sincronizados
6. Desconectar la tienda borra sus datos
7. `npm run build` y `npm run lint` limpios

## Qué NO hacer

- Nada de WooCommerce ni Amazon (post-MVP)
- Nada de multi-tienda: un store por usuario en el MVP
- No pedir scopes de escritura. El producto es de solo lectura, y pedir de más frena la aprobación y
  asusta al usuario
- No hacer el listado en la Shopify App Store: es canal secundario, post-MVP
