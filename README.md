# ecommerce-analytics

Chat analítico para sellers de ecommerce. Conecta tu tienda, pregúntale a tus ventas en lenguaje
natural y recibe **números exactos**: el LLM escribe la consulta, la base de datos produce las cifras.

```bash
cp .env.local.example .env.local   # y rellenar
npm install
npm run dev                        # http://localhost:3000 → /en
```

## Documentación

| Documento | Qué contiene |
|---|---|
| [`docs/ESTADO.md`](docs/ESTADO.md) | **Empieza aquí.** Fase actual, bloqueos, decisiones, deuda |
| [`docs/fases/`](docs/fases/README.md) | Un brief autocontenido por fase de desarrollo |
| [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) | Pipeline, aislamiento multi-tenant, contrato de la API |
| [`docs/PRODUCTO.md`](docs/PRODUCTO.md) | Documento de producto: qué, para quién, pricing |
| [`CLAUDE.md`](CLAUDE.md) | Stack, convenciones y reglas duras para quien programe aquí |

## Stack

Next.js 16 (App Router, JSX) · Tailwind v4 + shadcn/ui · next-intl (EN/ES) · Supabase Postgres ·
DuckDB (CSV) · AI SDK · Recharts · Stripe · Vercel
