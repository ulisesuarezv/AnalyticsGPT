# Fase 2 — Chat UI + charts + insights + `/demo` → **HITO 1**

**Estado:** ⬜
**Depende de:** Fase 1
**Credenciales necesarias:** las de Fase 1 · cuenta Vercel para el preview

## Objetivo

Convertir el pipeline de la Fase 1 en algo que un desconocido pueda usar desde un link, sin registrarse,
y entender en 30 segundos qué hace el producto. Este es el hito que se enseña para validar demanda.

## Alcance

### Chat

`src/components/chat/`:

- `ChatInterface.jsx` — contenedor, estado de la conversación, envío
- `MessageBubble.jsx` — mensaje de usuario / de asistente
- `QueryResult.jsx` — tabla de resultados + **el SQL ejecutado, visible en un desplegable**. No es un
  detalle de developer: es la prueba de que el número es real, y es el argumento contra ChatGPT
- `ChartRenderer.jsx` — Recharts, decide el componente según `chart.type` (bar/line/pie/scatter/table).
  Usa las variables `--chart-1..5` del tema, ya definidas en `globals.css`. Debe verse bien en claro y
  en oscuro
- `InsightCard.jsx` — insight proactivo; al pulsarlo, envía su `querySuggestion` como nueva pregunta.
  Este es el bucle de enganche del producto, cuídalo
- `SuggestedQuestions.jsx` — 4-6 preguntas de arranque, en el idioma activo. El chat vacío no puede ser
  un cursor parpadeando

### Streaming y orden de renderizado — requisito duro

Medido en la Fase 1: **p50 7,2 s, p95 13,4 s, máximo 17,9 s** para el pipeline completo. Un spinner de
7 segundos hunde el hito aunque el motor sea perfecto: competimos contra un ChatGPT que responde en dos.

Pero esos 7 s no son una espera indivisible. El desglose real es:

| Momento | Qué hay disponible |
|---|---|
| ~3,3 s | El SQL generado |
| ~3,5 s | Las filas de Postgres — **el número exacto ya existe aquí** |
| ~7 s | La respuesta redactada |
| ~7 s+ | Los insights |

**Renderiza en ese orden, en cuanto cada pieza está lista. No esperes a tenerlo todo.** El dato real
aparece a los 3,5 s en vez de a los 7: la mitad. Y el SQL visible mientras se redacta no es relleno —
es la prueba de que el número salió de una consulta y no de una suposición, que es literalmente el
argumento de venta frente a ChatGPT.

Entre el SQL y la tabla, estados con texto ("consultando tus datos"), nunca un spinner mudo. Con
latencias de dos dígitos, lo que separa "lento" de "roto" es que se vea en qué paso va.

### `/demo`

- Ruta pública, sin login, sobre el store demo de la Fase 1
- Rate limit por IP (generoso pero real: la demo es pública y las llamadas al LLM se pagan)
- CTA a registro tras 2-3 preguntas, sin bloquear la conversación

### Landing mínima

Sustituye el placeholder de `src/app/[locale]/page.js`: hero con la propuesta de valor, un ejemplo real
de pregunta→respuesta, y CTA a `/demo`. La landing completa es la Fase 6 — aquí basta con que sea
presentable y no parezca inacabada.

### Export

- CSV de la tabla de resultados
- PNG del gráfico (`html-to-image` o equivalente)

### Deploy

Preview en Vercel con las env vars configuradas. El entregable de esta fase es **un link que funciona**.

## Herencia de la Fase 1

Léete `docs/ESTADO.md` §"Fase 1 — cierre" antes de empezar. Tres cosas que te afectan directamente:

- **El contrato manda `historySummary`, no `sessionId`** (ver `ARQUITECTURA.md` §5). Sin él, cada
  pregunta se interpreta aislada y "¿y el mes pasado?" deja de funcionar. En esta fase, como todavía no
  hay persistencia, compón el resumen en cliente a partir de los mensajes de la conversación en curso
- **Ya puedes usar few-shot.** El brief de la Fase 1 lo prohibía hasta tener medición; ya la hay. Las 2
  preguntas que fallan (ventas × inventario, geografía × crecimiento) son consultas que cruzan dos
  conceptos: el modelo dice `UNANSWERABLE` en vez de componer un CTE. Un par de ejemplos de consulta
  compuesta en el prompt es lo primero que hay que probar. **No toques el guard**
- **`toApiChart` a veces elige `table` donde un `bar` se lee mejor** (top-5 con 3 columnas). Puedes
  forzar `bar` cuando hay una dimensión y una métrica numérica

## Criterio de aceptación

1. Alguien ajeno al proyecto abre el link, pregunta en español o en inglés, y obtiene respuesta + chart
   + insights sin registrarse
2. **El SQL y la tabla aparecen antes que la prosa**, no todo de golpe al final
3. Una pregunta de seguimiento ("¿y el mes pasado?") se interpreta con el contexto de la anterior
4. Pulsar un insight lanza la pregunta sugerida y encadena la conversación
5. Los números de la tabla coinciden con los del texto de la respuesta
6. Funciona en móvil (el ICP consulta desde el teléfono)
7. Claro y oscuro, ambos correctos, incluidos los gráficos
8. Nada de scroll horizontal en la página; las tablas anchas hacen scroll dentro de su contenedor
9. `npm run build` y `npm run lint` limpios
10. **Revisión del usuario antes de dar la fase por cerrada**

## Qué NO hacer

- Nada de auth, historial persistido ni dashboard (Fase 3)
- Nada de Stripe (Fase 5)
- Nada de upload de ficheros (Fase 4)
- No rediseñar el tema ni cambiar de librería de charts
- No animaciones elaboradas: se decidió explícitamente "producto limpio y rápido", no Awwwards

## Para la siguiente sesión

Anota en `ESTADO.md` qué preguntas hace la gente que prueba la demo. Es la mejor fuente que vas a tener
para afinar los prompts, y no se recupera después.
