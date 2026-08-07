# Estado del proyecto

**Última actualización:** 6 agosto 2026 · cierre de la Fase 2
**Fase actual:** 2 entregada → **pendiente de la revisión del usuario (HITO 1)**

Cada sesión actualiza este fichero al terminar. Es lo primero que lee la sesión siguiente.

---

## Progreso

| Fase | Estado | Notas |
|---|---|---|
| 0 · Fundaciones | ✅ Completada | Build y lint limpios, `/es` y `/en` sirviendo |
| 1 · Motor de queries | ✅ Completada | Eval 95%, ataques 100%, 5/5 verificadas a mano |
| 2 · Chat + `/demo` | 🟡 Entregada | **HITO 1** — demo publicada y verificada en el deploy; falta la revisión del usuario |
| 3 · Auth + multi-tenant | ⬜ | |
| 4 · CSV upload | ⬜ | |
| 5 · Billing | ⬜ | |
| 6 · Landing | ⬜ | |
| 7 · Shopify | 🔒 **Bloqueada** | Falta Shopify Partners + dev store |
| 8 · Hardening | ⬜ | |

## Fase 2 — cierre

Chat completo, `/demo` pública sobre el store demo, landing mínima, export CSV/PNG. Todo verificado
ejecutando contra la base real y en navegador (desktop 1280px y móvil 390px, claro y oscuro).

### Criterio de aceptación

| # | Criterio | Resultado |
|---|---|---|
| 1 | Alguien ajeno pregunta en es/en y obtiene respuesta + chart + insights sin registrarse | ✅ probado en `/es/demo` y `/en/demo` |
| 2 | El SQL y la tabla aparecen antes que la prosa | ✅ **medido en el DOM**: SQL 3,6 s · tabla 3,9 s · prosa 6,3 s · insights 7,7 s |
| 3 | Pregunta de seguimiento con contexto | ✅ "¿y el mes pasado?" tras "top 5 productos" → top de julio, mismo sujeto |
| 4 | Pulsar un insight encadena la conversación | ✅ |
| 5 | Los números de la tabla coinciden con los del texto | ✅ (con una salvedad de formato, ver abajo) |
| 6 | Móvil | ✅ 390×844, sin desbordes (`scrollWidth == innerWidth`) |
| 7 | Claro y oscuro, gráficos incluidos | ✅ todo el color sale de `--chart-1..5` y las variables del tema |
| 8 | Sin scroll horizontal de página; tablas anchas scrollean dentro | ✅ tabla de 5 columnas: contenedor 356 px, tabla 598 px, scroll interno |
| 9 | `build` y `lint` limpios | ✅ |
| 10 | Revisión del usuario | ⏳ **pendiente** |

### Streaming: cómo está montado

`/api/query` responde JSON exactamente como antes; con `Accept: text/event-stream` responde SSE con
los mismos campos, emitidos según existen (`sql` → `rows` → `answerDelta` → `done`). **El contrato de
§5 no cambia**: el evento `done` lleva el payload completo de §5 y es la única fuente de verdad; lo
anterior son adelantos y el cliente los reemplaza (importa si hubo reintento del modelo).

El orden en pantalla es el orden de llegada —SQL, tabla, prosa, insights— a propósito: poner la
respuesta redactada arriba obligaría a empujar la tabla hacia abajo al terminar el modelo, un salto
de layout en cada pregunta que en móvil se nota mucho.

`historySummary` se compone en cliente (`src/lib/chat/history.js`) con los 3 últimos turnos,
incluyendo el SQL de cada uno: es el contexto más preciso que existe sobre qué se midió antes.

### Deploy

La demo está publicada desde la rama `fase-2-chat-demo` (`main` sigue en la Fase 1, a la espera de
la revisión):

```
https://analytics-axde2vm89-ulisesuarezvs-projects.vercel.app/es/demo
```

Verificado sobre esa URL en móvil (390 px): SQL a 6,1 s, tabla a 6,6 s, prosa a 7,3 s, gráfico a
11,3 s — más lento que en local por arranque en frío y red, pero **el orden se mantiene** y el dato
real sigue apareciendo mucho antes que la prosa. Cinco barras, cinco filas, CSV y PNG presentes, sin
scroll horizontal.

El proyecto de Vercel necesita **cinco** env vars, que son todas las que el código lee en runtime.
Ninguna lleva prefijo `NEXT_PUBLIC_`, y así debe seguir: son secretos de servidor.

| Variable | Valor |
|---|---|
| `DATABASE_URL_ADMIN` | de `.env.local` |
| `DATABASE_URL_READONLY` | de `.env.local` (la compuso `db:migrate`) |
| `OPENAI_API_KEY` | de `.env.local` |
| `LLM_MODEL` | `openai/gpt-4o-mini` |
| `LLM_FALLBACK` | `openai/gpt-4.1-mini` |

**Añadir una variable no arregla un deployment ya construido**: hay que volver a desplegar. Costó una
vuelta entera de diagnóstico, así que conviene recordarlo. Comprobación rápida sin navegador:

```bash
curl -s -X POST <url>/api/query -H 'Content-Type: application/json' \
  -d '{"question":"¿Cuánto facturé el mes pasado?","source":"demo","locale":"es"}' | head -c 300
```

Debe devolver un `answer` con una cifra, no un `error`. Los previews además llevan Deployment
Protection activada por defecto (302 a `vercel.com/sso-api`): con ella puesta, un desconocido ve un
login en vez de la demo.

### Latencia: la medida empeora, la percibida mejora

El p50 del pipeline sube de 7,2 s a 9,1 s: el few-shot alarga el prompt (4.019 → 4.865 tokens de
media) y el eval se ejecutó con el equipo ocupado, así que parte de la subida es ruido. Aun así, hay
que mirarlo: **lo que se optimizó no es el total, es cuándo aparece el dato**. La cifra exacta está
en pantalla a los ~3,9 s pase lo que pase después, y esa es la métrica que vive el usuario.

Si el p50 sigue subiendo en la Fase 3, el primer sitio donde mirar es el tamaño del prompt.

### Preguntas que hace la gente en la demo

_Sin datos todavía: la demo aún no ha estado delante de nadie ajeno al proyecto._ El brief de la
Fase 2 pide anotarlas aquí porque no se recuperan después y son la mejor fuente para afinar los
prompts. Hoy no hay analítica de producto (no estaba en el alcance), así que la vía es leer los logs
del servidor: cada query registra su pregunta cuando falla. Si se quiere el listado completo,
conviene decidirlo antes de enseñar la demo a mucha gente.

### Few-shot: qué arregló y qué destapó

Se añadieron 2 ejemplos de consulta compuesta (CTE por concepto + join) al prompt de text-to-SQL.

- **q24 (ventas × inventario) pasa a correcto.** Era uno de los 2 fallos heredados
- **q27 (geografía × crecimiento) sigue fallando**, con el mismo `UNANSWERABLE`. Falla en seguro
- **Destapó una colisión latente entre el prompt y el guard**: ver "Deuda y hallazgos"

El eval se re-ejecutó entero (`npm run eval -- --full`) porque esta fase toca el prompt de
text-to-SQL:

| | Fase 1 | Fase 2 |
|---|---|---|
| Preguntas | 95,0% (38/40) | **97,5% (39/40)** |
| Ataques | 100% (26/26) | **100% (26/26)** |
| Fallos | q24, q27 | q27 |

La primera pasada del eval con el few-shot dio 95% otra vez, pero **con los fallos cambiados**: q24
arreglado y q35 roto por el choque `extract`/guard. Solo tras corregir el prompt quedó en 97,5%.
Mirar únicamente el porcentaje habría escondido el intercambio.

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

## Decisiones del PM tras la Fase 2

Tomadas el 7 agosto 2026, sobre los tres huecos que señaló el cierre de la Fase 2.

1. **La demo circula solo entre gente de confianza, de momento.** Eso desactiva las dos urgencias:
   sin captura de email (con cinco personas el feedback llega hablando) y sin limitador compartido (el
   rate limit por instancia sobra para ese volumen). **Ambas cosas vuelven a ser obligatorias en cuanto
   el link salga a redes o comunidades** — la de email antes de compartir, porque si no gastas tráfico
   sin quedarte lista de lanzamiento

2. **Registrar las preguntas de la demo: sí, pero en la Fase 3, no antes.** Con audiencia reducida deja
   de ser irrecuperable, así que no bloquea el hito. Una tabla en Supabase con pregunta, locale, si
   funcionó y latencia; sin PII y sin auth. Los logs de Vercel no valen: retención corta y solo guardan
   los fallos. Lo que se pierde sin esto es *qué preguntó la gente*, que es lo que afina los prompts

3. **La demo pasa a `main` para tener URL estable** (`analytics-gpt.vercel.app`), después de la revisión
   del usuario. Hay que **desactivar Deployment Protection en producción**: con ella puesta, un
   desconocido ve un login de Vercel en vez de la demo

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

_Añadido en la Fase 2:_

- **El guard rechaza `EXTRACT(campo FROM columna)` y el prompt lo recomendaba.** El colector de
  referencias del guard lee el `FROM` interno de `extract()` como una tabla y devuelve
  `UNKNOWN_TABLE: created_at_platform`. Convivía sin verse porque el modelo casi siempre escribía
  `to_char`/`date_trunc`; al cambiar el prompt con el few-shot, el modelo tiró de `extract` y q35
  ("¿qué día de la semana vendo más?") empezó a fallar. **Arreglado en el prompt** (se recomienda
  `date_part`, se prohíbe `extract`), no en el guard. El guard sigue teniendo el falso positivo:
  falla en seguro —rechaza SQL válido, no acepta SQL peligroso—, pero conviene arreglarlo en la
  revisión adversarial de la Fase 3, que ya toca ese fichero
- **La prosa y la tabla usan separadores de miles distintos.** En español la tabla escribe
  `14.284,85` y el modelo escribe `14,284.85`: mismo número, convención distinta. **Se intentó
  arreglar por prompt y hubo que revertirlo**: cualquier regla sobre separadores en el prompt de
  `summarize` —incluso redactada sin nombrar ningún idioma— hacía que respondiera en español a
  preguntas en inglés, de forma reproducible (3/3 ejecuciones). El idioma de la respuesta importa
  mucho más que la puntuación, así que se dejó el prompt como estaba. Si se retoma, el camino es
  formatear fuera del modelo, no pedírselo a él
- **El rate limit de la demo es por instancia, en memoria** (`src/lib/utils/rate-limit.js`, 30/hora
  por IP). En serverless el tope efectivo se multiplica por el número de instancias calientes.
  Frena el bucle accidental y el abuso casual, no un ataque distribuido. El límite compartido
  (Upstash o equivalente) es Fase 8
- **El CTA de la demo no lleva a un registro, porque todavía no existe** (auth es Fase 3). Apunta a
  una sección `#connect` de la landing que explica qué viene ahora. En cuanto haya signup, es un
  cambio de `href`
- **`toApiChart` no ascendía a barras cuando el modelo decía `none`.** Se arregló la promoción para
  `table` (el hallazgo de la Fase 1) pero se devolvía `null` antes de llegar a la inferencia si la
  sugerencia era `none`, y el modelo contesta `none` a un top-5 más a menudo de lo esperado: en local
  no se vio nunca y en el deploy salió a la primera. Ahora `none` pasa por la misma inferencia;
  sobre un escalar sigue devolviendo `null`, que es lo correcto. **Probar solo en local no bastaba:
  el mismo prompt da otra rama de código según el humor del modelo**
- **El gráfico aparece con `done` (~7 s), no con la tabla (~3,5 s)**, porque el tipo de chart y sus
  campos los decide el segundo LLM. Se podría inferir un chart provisional en cliente cuando hay una
  dimensión y una métrica, y sustituirlo al llegar `done`; se descartó para no arriesgar un parpadeo
  con un gráfico distinto al definitivo
- **El seed llega hasta el 31 de julio de 2026 y "hoy" es agosto**, así que "¿cuánto he facturado
  este mes?" responde correctamente que cero y parece que el producto está roto. Se resolvió en la
  UI (el banner de `/demo` dice el rango real, leído de la base, y las sugerencias evitan "este
  mes"). Si la demo se enseña dentro de unos meses, el problema crece: conviene que `db:seed`
  genere datos relativos a la fecha de ejecución

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
| Acierto del eval de text-to-SQL | **97,5%** (39/40) · era 95,0% | Fase 2 (con few-shot) |
| Ataques bloqueados | **100%** (26/26) | Fase 2 (re-ejecutado) |
| Latencia p50 / p95 por query | **9,1 s / 19,7 s** (pipeline completo) | Fase 2 |
| Dato real en pantalla | **~3,9 s** (tabla), SQL a 3,6 s | Fase 2 (medido en el DOM) |
| Tokens medios por query | **4.865** · era 4.019 | Fase 2 (el few-shot alarga el prompt) |
| Coste real por query | ~$0,0010 (estimado desde tokens) | Fase 8 (medir en factura) |

Reproducir: `npm run eval -- --full` y `npm run verify:manual`. La salida completa, con el SQL
generado por cada pregunta, queda en `docs/eval/resultados/ultimo.json`.
