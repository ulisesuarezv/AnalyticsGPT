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

## Criterio de aceptación

1. **Test de aislamiento explícito y automatizado**: dos usuarios con datos distintos; ninguna ruta,
   ninguna query y ninguna manipulación del request deja que A vea nada de B. Incluye el intento de
   mandar un `storeId` ajeno en el body
2. Login por magic link y por Google, ambos funcionando end-to-end
3. La sesión sobrevive a un refresh y a la expiración del token
4. El historial persiste y se puede retomar una conversación anterior
5. `npm run build` y `npm run lint` limpios

## Qué NO hacer

- Nada de Stripe ni límites de uso (Fase 5) — todos los usuarios ilimitados por ahora
- Nada de Shopify (Fase 7): en esta fase no hay forma de crear un store con datos reales, y está bien.
  Se prueba con el store demo asignado a cada usuario de prueba
- No rehacer la UI de chat: se reutiliza la de la Fase 2 tal cual

## Nota

Este es el punto del proyecto donde un error cuesta caro de verdad. `docs/ARQUITECTURA.md` §3 describe
tres capas de defensa; aquí se comprueba que las tres están vivas, no solo escritas.
