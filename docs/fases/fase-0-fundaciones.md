# Fase 0 — Fundaciones del repo

**Estado:** ✅ Completada
**Depende de:** nada

## Objetivo

Dejar un proyecto que arranca, compila y lint pasa, con todas las decisiones transversales ya cableadas
para que ninguna fase posterior tenga que volver sobre ellas.

## Entregado

- **Next.js 16.3** App Router · React 19.2 · JSX sin TypeScript · `src/`
- **Tailwind v4** CSS-first (sin `tailwind.config`), tema completo en `src/app/globals.css`:
  variables shadcn en `oklch`, variante `dark`, y paleta `--chart-1..5` lista para Recharts
- **shadcn/ui** configurado en `components.json` (`new-york`, `"tsx": false`, base neutral).
  Aún sin componentes instalados: los añade cada fase según necesite con `npx shadcn@latest add`
- **Fontshare (Satoshi)** cargada por `<link>` en el layout. Sin Google Fonts
- **next-intl v4**: `en` (default) + `es`
  - `src/i18n/routing.js`, `request.js`, `navigation.js`
  - `src/proxy.js` — en Next 16 el middleware se llama `proxy.js`
  - `messages/en.json`, `messages/es.json`
- **next-themes** con `attribute="class"`, `defaultTheme="system"`; `ThemeToggle` sin flash de
  hidratación (alterna iconos por CSS, no por estado)
- `src/lib/utils.js` con `cn()`
- `.env.local.example` con todas las variables, anotadas por fase
- `CLAUDE.md` con stack, convenciones y reglas duras de seguridad
- `docs/` con `PRODUCTO.md`, `ARQUITECTURA.md`, `ESTADO.md` y los briefs
- `next.config.mjs` con `serverExternalPackages: ['@duckdb/node-api']` — preparado para Fase 1

## Verificado

```
npx next build   →  ✓  /es y /en prerenderizados (SSG), Proxy activo
npx eslint .     →  ✓  sin errores
curl /           →  307 → /en
curl /es · /en   →  200, h1 traducido correctamente en cada idioma
```

## Decisiones tomadas aquí

| Decisión | Motivo |
|---|---|
| Next 16 en vez de 15 (que decía el doc) | Es el estable actual; `create-next-app` ya no sirve 15. Sin impacto en el diseño |
| `en` como locale por defecto | El grueso del mercado Shopify es angloparlante |
| Layout único bajo `src/app/[locale]/` | Patrón oficial de next-intl. Las API routes viven fuera y no necesitan layout |
| Iconos del theme toggle por CSS, no por `mounted` state | El lint de React Compiler rechaza `setState` en efecto; además evita el flash |

## Para la siguiente sesión

Todo lo transversal está resuelto. La Fase 1 **no** debe tocar i18n, tema, tipografía ni configuración
de build: si algo de eso estorba, es un hallazgo para `ESTADO.md`, no un trabajo a hacer.

`src/app/[locale]/page.js` es un placeholder deliberado. Lo sustituye la Fase 2 (hero real) y lo
completa la Fase 6.
