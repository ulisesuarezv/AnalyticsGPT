# Fase 6 — Landing completa + pricing + copy bilingüe final

**Estado:** ⬜
**Depende de:** Fase 2 (idealmente también 5, para que el pricing enlace con el checkout real)

## Objetivo

La landing es el canal de distribución. El documento es explícito sobre Sightly: mismo producto, 20
meses, cero tracción — **fracaso de distribución, no de producto**. Esta fase es la que evita repetirlo.

## Alcance

- `src/components/landing/`: `Hero.jsx`, `DemoWidget.jsx` (demo embebida, jugable sin salir de la
  página), `Features.jsx`, `PricingCards.jsx`, `Footer.jsx`
- `/pricing` con Free y Core, mensual/anual, enlazando al checkout de la Fase 5
- **Copy definitivo en ES y EN.** Traducción de verdad, no calco: el eje es "respuestas exactas, no
  aproximaciones", y la comparación implícita es con subir un CSV a ChatGPT
- Metadata, OG images, `sitemap.js`, `robots.js`, `hreflang` entre locales
- Analytics (Vercel Analytics)

## Criterio de aceptación

1. Lighthouse ≥ 90 en performance y accesibilidad, en móvil
2. `messages/en.json` y `messages/es.json` con exactamente las mismas claves; cero texto hardcodeado
3. La demo embebida funciona sin salir de la landing
4. Las tarjetas de precio llevan al checkout correcto en cada ciclo de facturación
5. OG image correcta al compartir el link (compruébalo de verdad, no lo asumas)
6. Claro y oscuro, móvil y escritorio
7. `npm run build` y `npm run lint` limpios

## Qué NO hacer

- Nada de GSAP, WebGL ni scroll-jacking. La decisión de diseño fue "producto limpio y rápido"
- No prometer en el copy nada que no exista: sin multi-tienda, sin Slack, sin API — son post-MVP
- No inventar testimonios, logos de clientes ni métricas de uso
