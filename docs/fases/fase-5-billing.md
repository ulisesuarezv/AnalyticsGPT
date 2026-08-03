# Fase 5 — Billing Stripe + límites por plan

**Estado:** ⬜
**Depende de:** Fase 3
**Credenciales necesarias:** Stripe en **test mode** (secret key, publishable key, webhook secret)

## Objetivo

Cobrar. Free con 10 queries/mes, Core a $9/mes o $79/año.

Antes de escribir código, carga la skill `stripe:stripe-best-practices` — la integración cambia lo
bastante a menudo como para que no valga la pena hacerla de memoria.

## Alcance

- Productos y precios en Stripe: Core mensual ($9) y anual ($79). IDs a `.env.local`
- `src/lib/stripe/client.js` y `plans.js` (definición de planes y sus límites, en un solo sitio)
- Checkout Session → Core; Customer Portal para gestionar y cancelar
- `POST /api/billing/webhook`: `checkout.session.completed`,
  `customer.subscription.updated|deleted`, `invoice.payment_failed` → tabla `subscriptions`
  - Verificación de firma obligatoria
  - **Idempotente**: Stripe reintenta, y el mismo evento no puede aplicarse dos veces
- Contador de uso: incrementar `usage` en cada query completada con éxito. Las que fallan no cuentan
- `src/lib/utils/rate-limit.js` — límites por plan, comprobados **en servidor**, en `/api/query`.
  Un límite que solo se comprueba en el cliente no es un límite
- Al llegar al límite: `QUOTA_EXCEEDED` + prompt de upgrade en la UI
- Marca de agua en los charts del plan Free
- Sección de facturación en `/dashboard/settings`

## Criterio de aceptación

1. Ciclo completo en test mode: free → 10 queries → bloqueo → checkout → ilimitado → cancelar → vuelve
   a free al final del periodo
2. Reenviar el mismo webhook dos veces no duplica ni corrompe la suscripción
3. Un webhook con firma inválida se rechaza con 400
4. El contador se resetea al cambiar de mes
5. El límite no se puede saltar manipulando el cliente
6. `npm run build` y `npm run lint` limpios

## Qué NO hacer

- Nada del plan Pro ($19): es post-MVP, está en OUT del documento
- Nada de trials, cupones ni pruebas gratuitas
- No tocar Stripe en modo live en esta fase
