# Estado del proyecto

**Última actualización:** 4 agosto 2026 · sesión PM
**Fase actual:** **Fase 1 en curso, pausada a mitad** — ver "Dónde se retoma"

Cada sesión actualiza este fichero al terminar. Es lo primero que lee la sesión siguiente.

---

## Progreso

| Fase | Estado | Notas |
|---|---|---|
| 0 · Fundaciones | ✅ Completada | Build y lint limpios, `/es` y `/en` sirviendo |
| 1 · Motor de queries | 🟡 **En curso, pausada** | ~30% hecho. Bloqueada por credenciales (B2) |
| 2 · Chat + `/demo` | ⬜ | **HITO 1** — revisión del usuario obligatoria |
| 3 · Auth + multi-tenant | ⬜ | |
| 4 · CSV upload | ⬜ | |
| 5 · Billing | ⬜ | |
| 6 · Landing | ⬜ | |
| 7 · Shopify | 🔒 **Bloqueada** | Falta Shopify Partners + dev store |
| 8 · Hardening | ⬜ | |

## Dónde se retoma la Fase 1

Pausada el 4 agosto 2026. Lee `docs/fases/fase-1-motor-queries.md` para el alcance completo; esto es
solo el punto de corte.

**Hecho y verificado:**

- `supabase/migrations/001_schema.sql` — tablas de `PRODUCTO.md` §8 (reordenadas para que las FK
  compilen), índices, RLS + policies, las 5 vistas `security_barrier`, el rol `query_runner`, y los
  `COMMENT ON` que alimentarán el catálogo del LLM.
  ⚠️ **Escrito pero nunca aplicado contra la base.** Sigue sin validar contra Postgres real
- `src/lib/sql/guard.js` + `tests/guard.test.js` — **42/42 en verde** (`npm test`)
- `package.json` pasa a ESM (`"type": "module"`); scripts `test`, `eval`, `db:migrate`, `db:seed`
  declarados. Dependencias instaladas: `ai` v7, `@ai-sdk/openai`, `zod`, `postgres`, `@duckdb/node-api`,
  `dotenv`

**Falta (todo el resto del brief):**

- `scripts/apply-migrations.js`, `scripts/seed-demo.js`, `scripts/eval.js` — los tres están declarados
  en `package.json` pero **no existen**; el directorio `scripts/` está sin crear
- Aplicar la migración y validar que compila de verdad
- Dataset demo + export a `public/demo-data/sample-ecommerce.csv` + `docs/eval/dataset.md`
- `src/lib/db/` (`runScopedQuery`), `src/lib/sql/catalog.js`, `src/lib/duckdb/`, `src/lib/llm/`
- `POST /api/query`
- `docs/eval/preguntas.json` y `ataques.json`, y la ejecución real del eval

**Nit:** `npx eslint .` da 2 warnings en `guard.js` (directivas `eslint-disable` sin uso, líneas 242 y
300). `npm run lint` limpio es criterio de aceptación de la fase — se arregla con `--fix`.

## Bloqueos

| # | Bloqueo | Impide | Cómo se desbloquea |
|---|---|---|---|
| B2 | **Sin `.env.local`** | Continuar la Fase 1 | Ver "Credenciales" |
| B1 | Sin cuenta de Shopify Partners ni dev store | Fase 7 completa | Crear cuenta en partners.shopify.com, generar una development store con datos de prueba de varios meses, crear la app y obtener client id/secret |

Ninguna otra fase depende de B1. Las Fases 1-6 y 8 pueden completarse sin Shopify.

## Credenciales

| Servicio | Disponible | Necesario desde |
|---|---|---|
| Supabase | ✅ | Fase 1 |
| OpenAI | ✅ | Fase 1 |
| Stripe (test) | ✅ | Fase 5 |
| Vercel | ⚠️ por confirmar | Fase 2 (deploy preview) |
| Google OAuth (en Supabase) | ⚠️ por confirmar | Fase 3 |
| Shopify Partners | ❌ | Fase 7 |

**El repo no tiene `.env.local`** (solo `.env.local.example`). Es el bloqueo B2. Para retomar la Fase 1
hay que pedirle al usuario estas cinco cosas:

1. `NEXT_PUBLIC_SUPABASE_URL`
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. `SUPABASE_SERVICE_ROLE_KEY`
4. `OPENAI_API_KEY`
5. La connection string de Postgres **con rol admin** — Supabase Dashboard → Connect → *Session
   pooler*, formato `postgresql://postgres.<ref>:<password>@aws-….pooler.supabase.com:5432/postgres`

`DATABASE_URL_READONLY` **no se pide**: se compone dentro de la Fase 1 tras crear el rol
`query_runner`, generando su contraseña en el momento. La migración crea el rol a propósito sin
contraseña, y `scripts/apply-migrations.js` se la fija por parámetro bindeado, para que nunca acabe
interpolada en un fichero versionado.

## Decisiones tomadas

Las estructurales están en `docs/ARQUITECTURA.md` §8. Resumen de las que afectan al día a día:

1. **Postgres para datos de tienda, DuckDB solo para CSV.** Desviación deliberada de `PRODUCTO.md` §4
2. **Aislamiento en tres capas**: validador → rol readonly → vistas scoped. No negociable
3. **Modelo LLM por variable de entorno**, vía AI SDK
4. **Bilingüe EN/ES** desde el principio; `en` por defecto
5. **Sin TypeScript**, JSX en todo el proyecto
6. **Diseño limpio y rápido**: shadcn/ui + Tailwind. Sin GSAP ni 3D
7. **Ejecución secuencial**, una fase por sesión, con revisión entre medias
8. **El schema de Supabase se crea en la Fase 1**, no en la 3 — la Fase 1 necesita tablas contra las
   que ejecutar. La Fase 3 añade la identidad encima. (Ajuste sobre el plan original)

## Desviaciones respecto a `PRODUCTO.md`

| Doc dice | Hacemos | Dónde está justificado |
|---|---|---|
| DuckDB in-memory para todo | Postgres + DuckDB solo CSV | `ARQUITECTURA.md` §2 |
| Next.js 15 | Next.js 16 | `fases/fase-0-fundaciones.md` |
| Sin mención de i18n en la UI | Bilingüe EN/ES desde Fase 0 | Decisión del PM |
| Shopify en el primer bloque del MVP | Shopify al final (Fase 7) | Sin credenciales; y el hito es la demo |
| Migración `001_initial.sql` | `001_schema.sql` + vistas + rol `query_runner` | `ARQUITECTURA.md` §3 |

## Deuda y hallazgos

_Cada sesión añade aquí lo que encuentra fuera de su alcance. No lo arregles: anótalo._

- **Coste real del LLM sin medir.** El unit economics del documento (margen 82% a $9) asume $0.02 por
  50 queries. Hasta la Fase 1 no habrá cifras reales. Si se desvía mucho, afecta al precio, no solo al
  código
- **`stores.access_token` sin estrategia de cifrado definida.** El schema dice "encrypted" pero no
  cómo. A resolver en la Fase 7; si se decide antes, anotarlo aquí
- **Sin tests automatizados más allá del eval de la Fase 1.** Decisión consciente para el MVP; el guard
  de SQL sí lleva tests unitarios porque es el punto crítico

## Métricas (a rellenar según avancen las fases)

| Métrica | Valor | Medido en |
|---|---|---|
| Acierto del eval de text-to-SQL | — | Fase 1 |
| Ataques bloqueados | — | Fase 1 |
| Latencia p50 / p95 por query | — | Fase 1 |
| Tokens medios por query | — | Fase 1 |
| Coste real por query | — | Fase 8 |
