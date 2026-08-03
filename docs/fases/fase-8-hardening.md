# Fase 8 — Hardening + producción

**Estado:** ⬜
**Depende de:** todas las anteriores

## Objetivo

Pasar de "funciona en mi preview" a "puedo cobrar por esto sin perder el sueño".

## Alcance

### Seguridad

- Revisión completa del camino del SQL generado: releer `docs/ARQUITECTURA.md` §3 y verificar,
  ejecutando, que las tres capas siguen vivas. Es fácil que siete fases de cambios hayan abierto un
  atajo en alguna
- Ejecutar `docs/eval/ataques.json` otra vez, ampliado con lo aprendido por el camino
- Rotar todos los secretos antes de producción
- Cabeceras de seguridad y CSP
- Rate limiting global, no solo por plan: la demo pública es un vector de gasto en LLM
- Verificar que ningún error devuelve al cliente detalles internos (Postgres, prompts, stack traces)
- Repasar que nada sensible viaja con prefijo `NEXT_PUBLIC_`

### Fiabilidad

- Manejo de errores consistente en todas las API routes, con los códigos estables de `ARQUITECTURA.md` §5
- Logging estructurado; alerta si la tasa de fallo de text-to-SQL sube
- Estados vacíos y de error en toda la UI: tienda sin pedidos, sync en curso, LLM caído
- Timeouts en todas las llamadas externas

### Coste

- Panel interno o consulta con el coste real de LLM por usuario y por query
- Contrastar con el unit economics del documento ($0.02 por 50 queries, margen del 82%). **Si el coste
  real es mucho mayor, es un hallazgo de producto, no un detalle técnico** — el precio de $9 depende de
  esta cifra

### Producción

- Proyecto de Vercel en producción, dominio y DNS
- Stripe a modo live, con webhook de producción
- Backups de Supabase verificados (probar una restauración, no solo activarla)
- Página de estado o al menos un healthcheck

## Criterio de aceptación

1. Checklist de seguridad completa, con cada punto verificado ejecutando algo
2. `docs/eval/ataques.json` al 100%
3. La app funciona en el dominio de producción con Stripe live
4. Un usuario nuevo completa el recorrido entero —registro, conectar tienda, preguntar, pagar— sin
   intervención manual
5. Coste real por query medido y anotado en `ESTADO.md`

## Qué NO hacer

- No añadir funcionalidad. Si algo se quedó fuera del MVP, se queda fuera
- No refactorizar por gusto: solo lo que corrija un fallo real encontrado en la revisión
