# Fases

Una fase = una sesión de desarrollo. Se ejecutan **en orden**, con revisión entre medias.

Cada brief es autocontenido: quien lo abre no necesita el historial de ninguna otra sesión. Si un brief
te obliga a preguntar algo para empezar, es un bug del brief — anótalo en `docs/ESTADO.md`.

| Fase | Título | Estado | Depende de |
|---|---|---|---|
| [0](fase-0-fundaciones.md) | Fundaciones del repo | ✅ Completada | — |
| [1](fase-1-motor-queries.md) | Motor de queries + text-to-SQL | ⬜ Siguiente | 0 |
| [2](fase-2-chat-demo.md) | Chat UI + charts + `/demo` — **HITO 1** | ⬜ | 1 |
| [3](fase-3-auth-multitenant.md) | Auth + schema Supabase + multi-tenant | ⬜ | 2 |
| [4](fase-4-csv-upload.md) | CSV / XLSX upload | ⬜ | 3 |
| [5](fase-5-billing.md) | Billing Stripe + límites por plan | ⬜ | 3 |
| [6](fase-6-landing.md) | Landing completa + pricing | ⬜ | 2 |
| [7](fase-7-shopify.md) | Shopify OAuth + sync | 🔒 Bloqueada | 3 + Partner account |
| [8](fase-8-hardening.md) | Hardening + producción | ⬜ | todas |

## Protocolo de cada sesión

**Al empezar**

1. Leer `docs/ESTADO.md`, este brief, `docs/ARQUITECTURA.md` y `CLAUDE.md`
2. Confirmar que la fase anterior está marcada como completada
3. Si falta una credencial de las que lista tu brief, **parar y pedirla** — no inventar mocks para
   seguir adelante

**Al terminar**

1. Pasar el criterio de aceptación, de verdad, ejecutando
2. Actualizar `docs/ESTADO.md`: estado de la fase, decisiones tomadas, deuda encontrada
3. Commit con mensaje `fase-N: <qué>`
4. Dejar escrito en `ESTADO.md` cualquier cosa que la siguiente fase deba saber

## Regla de alcance

Si durante tu fase encuentras algo roto o ausente que pertenece a otra fase: **anótalo, no lo
arregles**. El valor de este reparto es que cada sesión cabe en su contexto. Una fase que se expande se
come el contexto de la siguiente.

Excepción: si lo que falta te **impide** cumplir tu criterio de aceptación, hazlo y déjalo documentado
en `ESTADO.md` bajo "Desviaciones".
