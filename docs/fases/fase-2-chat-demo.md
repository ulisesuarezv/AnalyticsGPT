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

### Streaming

Respuesta por SSE. El usuario debe ver progreso, no un spinner opaco. Estados visibles:
_interpretando la pregunta → consultando los datos → redactando_. Con latencias de varios segundos, la
diferencia entre "lento" y "roto" es enseñar en qué paso va.

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

## Criterio de aceptación

1. Alguien ajeno al proyecto abre el link, pregunta en español o en inglés, y obtiene respuesta + chart
   + insights sin registrarse
2. Pulsar un insight lanza la pregunta sugerida y encadena la conversación
3. Los números de la tabla coinciden con los del texto de la respuesta
4. Funciona en móvil (el ICP consulta desde el teléfono)
5. Claro y oscuro, ambos correctos, incluidos los gráficos
6. Nada de scroll horizontal en la página; las tablas anchas hacen scroll dentro de su contenedor
7. `npm run build` y `npm run lint` limpios
8. **Revisión del usuario antes de dar la fase por cerrada**

## Qué NO hacer

- Nada de auth, historial persistido ni dashboard (Fase 3)
- Nada de Stripe (Fase 5)
- Nada de upload de ficheros (Fase 4)
- No rediseñar el tema ni cambiar de librería de charts
- No animaciones elaboradas: se decidió explícitamente "producto limpio y rápido", no Awwwards

## Para la siguiente sesión

Anota en `ESTADO.md` qué preguntas hace la gente que prueba la demo. Es la mejor fuente que vas a tener
para afinar los prompts, y no se recupera después.
