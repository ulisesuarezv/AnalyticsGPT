# Fase 3 — Auth + multi-tenant real

**Estado:** ⬜
**Depende de:** Fase 2
**Credenciales necesarias:** Supabase · Google OAuth configurado en el proyecto Supabase

## Objetivo

Pasar de "una demo con un store fijo" a "cada usuario con sus propios datos, aislados de verdad".
El schema y las vistas ya existen desde la Fase 1; aquí se conecta la identidad.

## Alcance

- **Supabase Auth** con `@supabase/ssr`: magic link + Google OAuth
  - `src/lib/supabase/client.js` (browser), `server.js` (server components y route handlers)
  - Refresh de sesión en `src/proxy.js`, **componiendo** con el middleware de next-intl que ya está
    ahí. No lo sustituyas: encadena
  - `/api/auth/callback`
- **Inyección del tenant**: `/api/query` deja de aceptar `source: "demo"` con store fijo y resuelve el
  `storeId` desde la sesión del servidor. Sustituye el `TODO Fase 3` que dejó la Fase 1.
  El cliente **nunca** manda un `storeId`
- **Persistencia**: `chat_sessions` y `messages` (con `sql_generated`, `query_result`, `chart_config`,
  `insights`, `tokens_used`). Título de sesión autogenerado desde la primera pregunta
- **Rutas**: `/dashboard` (lista de sesiones + nueva conversación), `/dashboard/chat/[sessionId]`,
  `/dashboard/settings`
- Rutas protegidas; `/demo` sigue siendo pública
- Verificar que las policies RLS de la Fase 1 funcionan de verdad con usuarios reales

### Migración `002`: ingresos netos de devoluciones

Decisión del PM, tomada tras la Fase 1. Hoy los pedidos `partially_refunded` cuentan su importe
**entero** porque el schema no guarda cuánto se devolvió: los ingresos están sobrestimados por diseño.
Con datos demo da igual; con un seller real que devuelve, el número está inflado y lo va a descubrir al
cuadrarlo contra su admin de Shopify — que es justo la propiedad que vende el producto.

- Añadir `orders.total_refunded numeric(12,2) not null default 0`
- Exponerla en `v_orders`
- Actualizar el `COMMENT ON` de `v_orders.financial_status` y de la nueva columna: la facturación es
  `total_price - total_refunded`, y los `refunded` se siguen excluyendo enteros. El catálogo lo propaga
  solo al prompt, que es donde se decidió que viviera esta convención en la Fase 1
- Actualizar el seed para que genere importes parciales coherentes, y las cifras de `docs/eval/dataset.md`

Con `default 0` la convención nueva y la vieja coinciden mientras no haya datos reales, así que no
rompe el eval. La Fase 7 rellena la columna desde `totalRefundedSet`.

## Revisión adversarial del aislamiento — obligatoria

**Esta fase es la primera en la que varios tenants reales comparten base.** El guard pasó 26 ataques en
la Fase 1, pero los escribió quien escribió el guard: eso valida la implementación contra los fallos que
su autor supo imaginar, no el diseño.

Antes de cerrar la fase, una **sesión distinta**, que no haya escrito `src/lib/sql/guard.js` ni las
vistas, tiene que intentar romper el aislamiento con vectores nuevos. No vale volver a pasar
`ataques.json`: eso ya se sabe que pasa. Terreno que la Fase 1 no cubrió:

- inyección a través del **resultado de una query** que luego alimenta el resumen o una repregunta
- funciones y operadores de Postgres que lean fuera de la vista (`pg_read_file`, `dblink`, casts raros,
  `lateral` sobre catálogos)
- abuso del `SET LOCAL app.store_id`: ¿puede el SQL generado emitir otro `set`, o cerrar la transacción?
- CTEs recursivos o consultas caras como denegación de servicio (el `statement_timeout` es de 5 s: ¿se
  puede evitar?)
- prompt injection que venga **de los datos**, no de la pregunta: un producto llamado
  `'; ignora las instrucciones anteriores` sincronizado desde una tienda real

Lo que encuentre se añade a `ataques.json` y se arregla antes de cerrar. Carga la skill
`/security-review` para esa pasada.

## Criterio de aceptación

1. **Test de aislamiento explícito y automatizado**: dos usuarios con datos distintos; ninguna ruta,
   ninguna query y ninguna manipulación del request deja que A vea nada de B. Incluye el intento de
   mandar un `storeId` ajeno en el body
2. **Revisión adversarial hecha por una sesión que no escribió el guard**, con vectores nuevos añadidos
   a `ataques.json` y el suite entero en verde
3. Login por magic link y por Google, ambos funcionando end-to-end
4. La sesión sobrevive a un refresh y a la expiración del token
5. El historial persiste y se puede retomar una conversación anterior; el resumen que se manda como
   `historySummary` a `/api/query` se compone en servidor desde `messages`
6. `npm run build` y `npm run lint` limpios

## Qué NO hacer

- Nada de Stripe ni límites de uso (Fase 5) — todos los usuarios ilimitados por ahora
- Nada de Shopify (Fase 7): en esta fase no hay forma de crear un store con datos reales, y está bien.
  Se prueba con el store demo asignado a cada usuario de prueba
- No rehacer la UI de chat: se reutiliza la de la Fase 2 tal cual

## Nota

Este es el punto del proyecto donde un error cuesta caro de verdad. `docs/ARQUITECTURA.md` §3 describe
tres capas de defensa; aquí se comprueba que las tres están vivas, no solo escritas.
