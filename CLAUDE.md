# ecommerce-analytics

Chat analítico para sellers de ecommerce. El usuario pregunta a sus datos de ventas en lenguaje
natural y recibe **números exactos**: el LLM escribe la consulta, la base de datos produce las cifras.
Cero alucinación en los números — es la propiedad que vende el producto.

**Antes de tocar código, lee en este orden:**

1. `docs/ESTADO.md` — en qué fase estamos, qué está bloqueado
2. `docs/fases/fase-N-*.md` — el brief de tu fase (es tu única fuente de alcance)
3. `docs/ARQUITECTURA.md` — el pipeline real y el modelo de aislamiento multi-tenant
4. `docs/PRODUCTO.md` — el documento de producto (qué y para quién)

Si `docs/ARQUITECTURA.md` y `docs/PRODUCTO.md` se contradicen, **manda ARQUITECTURA**: contiene las
desviaciones deliberadas decididas por el PM.

---

## Stack

| Capa | Elección |
|---|---|
| Framework | Next.js 16 App Router, React 19, **JSX sin TypeScript** |
| Estilos | Tailwind v4 (CSS-first, sin `tailwind.config`) + shadcn/ui (`new-york`, JS) |
| Tipografía | **Fontshare** (Satoshi). Nunca Google Fonts |
| i18n | `next-intl`, locales `en` (default) y `es` |
| DB | Supabase Postgres + RLS |
| Motor de queries | Postgres para datos de tienda · DuckDB in-memory solo para CSV/XLSX |
| LLM | AI SDK de Vercel, modelo por env (`LLM_MODEL`, `LLM_FALLBACK`) |
| Charts | Recharts |
| Billing | Stripe |
| Deploy | Vercel |

## Convenciones

- **JSX, no TypeScript.** Única excepción: tipos autogenerados de Supabase.
- Server Components por defecto. `'use client'` solo cuando hay estado, efectos o eventos.
- Nombres: `PascalCase.jsx` para componentes, `camelCase.js` para `lib/` y utils.
- Navegación: importar `Link`, `useRouter`, `redirect` de `@/i18n/navigation`, **nunca** de
  `next/navigation` — si no, se pierde el locale.
- Todo texto visible pasa por `next-intl`. Añadir la clave a `messages/en.json` **y** `messages/es.json`
  en el mismo commit; las dos deben tener siempre las mismas claves.
- Estilos con las variables de tema (`bg-background`, `text-muted-foreground`, `border-border`…).
  Nada de colores hardcodeados: rompen el dark mode.
- API routes: `try/catch` en todas, status codes explícitos, y nunca devolver al cliente el mensaje de
  error crudo de Postgres o del LLM.
- Sin ORM. Queries directas con el SDK de Supabase, o SQL explícito.
- Streaming de respuestas del LLM vía SSE cuando sea posible.
- El middleware de Next 16 vive en `src/proxy.js` (no `middleware.js`).

## Reglas duras de seguridad

Estas no se negocian ni se "simplifican para ir más rápido":

1. **El SQL generado por el LLM solo se ejecuta a través de `DATABASE_URL_READONLY`**, con el rol
   `query_runner`, contra las vistas scoped por tenant. Nunca con el service role, nunca contra las
   tablas base.
2. **Todo SQL generado pasa por el validador** `src/lib/sql/guard.js` antes de ejecutarse.
3. **El `store_id` nunca lo elige el LLM ni llega del cliente**: se deriva de la sesión en el servidor.
4. RLS activado en todas las tablas, sin excepción.
5. Secretos solo en variables de entorno server-side. Nada sensible con prefijo `NEXT_PUBLIC_`.

## Comandos

```bash
npm run dev     # http://localhost:3000 → redirige a /en
npm run build
npm run lint
npx shadcn@latest add <componente>
```

## Qué NO hacer

- No añadir TypeScript al proyecto.
- No instalar Google Fonts ni usar `next/font/google`.
- No ampliar el alcance de tu fase. Si detectas algo que falta y pertenece a otra fase, anótalo en
  `docs/ESTADO.md` bajo "Deuda y hallazgos" y sigue con lo tuyo.
- No hidratar DuckDB con datos de tienda: se descartó deliberadamente (ver `docs/ARQUITECTURA.md`).

---

Next.js 16 trae cambios que probablemente no están en tu training data (el middleware renombrado a
`proxy.js` es solo uno). `AGENTS.md` — que regenera `next dev` — apunta a los docs de la versión
instalada en `node_modules/next/dist/docs/`. Consúltalos ante cualquier duda de API en vez de tirar de
memoria.
