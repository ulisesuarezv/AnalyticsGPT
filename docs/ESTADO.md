# Estado del proyecto

**Última actualización:** 6 agosto 2026 · revisión del PM tras la Fase 1
**Fase actual:** 1 completada → **siguiente: Fase 2 (HITO 1)**

Cada sesión actualiza este fichero al terminar. Es lo primero que lee la sesión siguiente.

---

## Progreso

| Fase | Estado | Notas |
|---|---|---|
| 0 · Fundaciones | ✅ Completada | Build y lint limpios, `/es` y `/en` sirviendo |
| 1 · Motor de queries | ✅ Completada | Eval 95%, ataques 100%, 5/5 verificadas a mano |
| 2 · Chat + `/demo` | ⬜ | **HITO 1** — revisión del usuario obligatoria |
| 3 · Auth + multi-tenant | ⬜ | |
| 4 · CSV upload | ⬜ | |
| 5 · Billing | ⬜ | |
| 6 · Landing | ⬜ | |
| 7 · Shopify | 🔒 **Bloqueada** | Falta Shopify Partners + dev store |
| 8 · Hardening | ⬜ | |

## Fase 1 — cierre

Todo el alcance del brief está entregado y **verificado ejecutando contra la base real**, sin mocks.

### Criterio de aceptación

| # | Criterio | Resultado |
|---|---|---|
| 1 | `preguntas.json` ≥ 90% | **95,0%** (38/40) |
| 2 | Incontestables → `UNANSWERABLE` | **4/4** |
| 3 | `ataques.json` = 100% | **26/26**, sin excepciones |
| 4 | 5 cifras verificadas a mano | **5/5** (`npm run verify:manual`) |
| 5 | `build` y `lint` limpios | ✅ · más 44/44 tests del guard |

### Métricas del pipeline completo (text-to-SQL + summarize)

| Métrica | Valor |
|---|---|
| Latencia p50 | 7,2 s |
| Latencia p95 | 13,4 s |
| Latencia máxima | 17,9 s |
| Tokens medios por query | 4.019 |
| Queries que necesitaron reintento | 3/40 |

Solo la fase text-to-SQL: p50 3,3 s · p95 5,4 s · 2.871 tokens.

**Para la Fase 2: la espera es de ~7 s, con cola hasta 18 s.** Eso no se cubre con un spinner. Hace
falta progreso por etapas ("escribiendo la consulta" → "consultando tus datos" → "redactando") o
streaming del SQL en cuanto está disponible — que además es la prueba visible de que el número es
real, que es lo que vende el producto.

### Qué tipos de pregunta fallan

Los 2 fallos restantes son el mismo patrón: **preguntas que cruzan dos conceptos** y necesitan un CTE
o una subconsulta de apoyo.

- `q24` "Which best-selling products are running low on stock?" — ventas × inventario
- `q27` "¿Qué región ha crecido más en el último trimestre?" — geografía × crecimiento entre periodos

En los dos casos el modelo responde `UNANSWERABLE` en vez de componer la consulta. **Ninguno devuelve
un número equivocado**: falla en seguro, que es la dirección correcta del error. Si la Fase 2 los
necesita, el camino es few-shot con un par de ejemplos de consulta compuesta — no tocar el guard.

### Coste real por query

~4.000 tokens con `gpt-4o-mini` ≈ **$0,0008 por query**, es decir **~$0,04 por 50 queries**. El
`PRODUCTO.md` estimaba $0,02: es el **doble**, pero irrelevante frente a $9/mes — el margen pasa de
82% a ~81,8%. El unit economics aguanta.

## Bloqueos

| # | Bloqueo | Impide | Cómo se desbloquea |
|---|---|---|---|
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

`.env.local` **ya existe en local** con las cinco credenciales, y `DATABASE_URL_READONLY` está
compuesta. No está en git (`.gitignore`), así que en una máquina nueva hay que rehacerlo desde
`.env.local.example` y volver a pedir:

1. `NEXT_PUBLIC_SUPABASE_URL` · 2. `NEXT_PUBLIC_SUPABASE_ANON_KEY` · 3. `SUPABASE_SERVICE_ROLE_KEY`
4. `OPENAI_API_KEY` · 5. la connection string de Postgres **con rol admin** (Dashboard → Connect →
*Session pooler*), que se guarda como `DATABASE_URL_ADMIN`

`DATABASE_URL_READONLY` no se pide nunca: la compone `npm run db:migrate` tras crear el rol
`query_runner`, generándole la contraseña en el momento y fijándola por parámetro bindeado, para que
no acabe interpolada en un fichero versionado.

**Puesta en marcha desde cero:** `npm run db:migrate` → `npm run db:seed` → `npm run eval`.

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

## Decisiones del PM tras la Fase 1

Tomadas el 6 agosto 2026 revisando el cierre de la Fase 1. Ya están aplicadas en los briefs.

1. **Los ingresos se calculan netos de devoluciones.** La Fase 1 dejó los `partially_refunded`
   contando enteros porque el schema no guarda el importe devuelto, y lo señaló. Es una decisión de
   producto, no técnica: un seller con devoluciones cuadra nuestro revenue contra su admin de Shopify,
   ve que inflamos, y pierde exactamente la propiedad por la que paga. La **Fase 3** añade
   `orders.total_refunded` (migración `002`, `default 0`, así que no rompe el eval) y la **Fase 7** la
   rellena desde `totalRefundedSet`. Se hace ahora porque cambiar qué significa "facturación" después
   de que los usuarios hayan visto números es mucho peor que hacerlo antes

2. **La revisión adversarial del aislamiento se adelanta de la Fase 8 a la Fase 3.** Los 26 ataques los
   escribió quien escribió el guard: validan la implementación contra los fallos que su autor supo
   imaginar, no el diseño. La Fase 3 es donde varios tenants reales empiezan a compartir base, así que
   esperar a la 8 dejaba cinco fases de exposición con una sola pasada hecha por el autor. La hace una
   sesión distinta, con vectores nuevos — ver el brief de la Fase 3

3. **Los ~7 s se resuelven reordenando el render, no con un spinner.** El SQL está a los 3,3 s y las
   filas a los 3,5 s; los 7 s son prosa sobre un número que ya existe. La Fase 2 renderiza SQL → tabla
   → texto → insights según van llegando: el dato real aparece a los 3,5 s, la mitad. Requisito duro
   del brief, no sugerencia

4. **El coste no se toca.** $0,04 por 50 queries es el doble de lo estimado, pero el margen pasa de 82%
   a 81,8% y la decisión de precio no cambia. Medir la factura real sigue siendo Fase 8. Si alguna vez
   se plantea bajar de $9, ese número hay que tenerlo **antes** de anunciarlo

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

_Añadido en la Fase 1:_

- **La convención de facturación estaba sin definir y daba dos números distintos.** "¿Cuánto he
  facturado?" admitía sumar todos los pedidos o solo los `paid`: 222.957 € frente a 205.258 €, ambas
  defendibles. Se fijó en el `COMMENT` de `v_orders.financial_status` (excluir solo los `refunded`;
  los `partially_refunded` cuentan enteros porque el schema **no guarda el importe devuelto**). Al
  vivir en el schema, el catálogo la propaga sola al prompt. **La limitación de fondo sigue ahí**: sin
  columna de importe reembolsado, los ingresos de un pedido parcialmente devuelto están sobrestimados.
  Si Shopify lo expone (Fase 7), conviene añadir la columna y revisar la convención
- **`toApiChart` a veces recibe `table` donde un `bar` sería mejor.** En un top-5 con 3 columnas el
  modelo elige `table`. No es incorrecto, pero la Fase 2 puede querer forzar `bar` cuando hay una
  dimensión y una métrica numérica
- **Las 2 preguntas que fallan necesitan few-shot, no más prompt.** Ver "Fase 1 — cierre". Añadir uno
  o dos ejemplos de consulta compuesta al prompt es lo primero que hay que probar; el brief de la
  Fase 1 prohibía few-shot dinámico ("primero que funcione y se mida"), y ya está medido
- **El parser de CSV del eval es de juguete.** `src/lib/duckdb/engine.js` está probado contra el CSV
  demo con un split por comas escrito a mano. El parser real con SheetJS es la Fase 4
- **DuckDB infiere `DECIMAL` para las columnas de dinero.** Con `DOUBLE`, sumar precios devolvía
  `40935.32999999963` en vez de `40935.33`. Es exactamente la clase de error que rompe la promesa del
  producto; si alguien toca `inferType`, que no lo revierta

_Añadido por el PM al revisar la Fase 1:_

- **`ARQUITECTURA.md` §5 documentaba `sessionId` y la ruta implementada lee `historySummary`.**
  Corregido en el documento (la implementación era la correcta: en Fase 1 no hay historial que
  resumir). Se detectó leyendo el código contra el contrato — la Fase 2 habría mandado `sessionId`, lo
  habría visto ignorado **sin error**, y las preguntas de seguimiento habrían dejado de funcionar de
  forma silenciosa. Vale la pena releer §5 contra la implementación al cerrar cada fase que toque la
  ruta
- **`NO_DATA` está definido en `messages/*.json` y no se usa.** La ruta devuelve 200 con `chart: null`
  cuando no hay filas, que es mejor comportamiento (cero ventas en un periodo es una respuesta válida,
  no un error). O se usa el código, o se retira

## Métricas (a rellenar según avancen las fases)

| Métrica | Valor | Medido en |
|---|---|---|
| Acierto del eval de text-to-SQL | **95,0%** (38/40) | Fase 1 |
| Ataques bloqueados | **100%** (26/26) | Fase 1 |
| Latencia p50 / p95 por query | **7,2 s / 13,4 s** (pipeline completo) | Fase 1 |
| Tokens medios por query | **4.019** | Fase 1 |
| Coste real por query | ~$0,0008 (estimado desde tokens) | Fase 8 (medir en factura) |

Reproducir: `npm run eval -- --full` y `npm run verify:manual`. La salida completa, con el SQL
generado por cada pregunta, queda en `docs/eval/resultados/ultimo.json`.
