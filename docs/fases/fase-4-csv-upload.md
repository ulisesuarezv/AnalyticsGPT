# Fase 4 — CSV / XLSX upload

**Estado:** ⬜
**Depende de:** Fase 3
**Credenciales necesarias:** Supabase (Storage habilitado)

## Objetivo

Dar valor al usuario **antes** de que conecte su tienda. Es el camino de entrada de menor fricción: el
avatar del producto ya exporta CSVs cada semana, así que puede probar el producto con lo que ya tiene.

El motor DuckDB ya está construido (Fase 1). Aquí se conecta a la UI y al almacenamiento.

## Alcance

- `src/lib/excel/parser.js` — SheetJS: `.csv`, `.tsv`, `.xlsx`. Detección de headers y de tipos
  (fecha, número, moneda, texto), normalizando nombres de columna a identificadores SQL seguros
- `src/components/upload/FileUploader.jsx` — drag & drop, progreso, errores claros
- `src/components/upload/SchemaPreview.jsx` — columnas detectadas y su tipo, **editable**: la detección
  automática se equivoca y el usuario sabe qué es cada columna
- `POST /api/upload` — parseo, tabla `csv_uploads`, fichero en Supabase Storage con TTL 24h
- `/dashboard/upload`
- Limpieza de expirados (cron de Vercel)
- El chat con `source: "csv"` usa el motor DuckDB y el mismo contrato de `/api/query`
- Límites por plan: Free 1 fichero de 5 MB · Core ilimitado, 50 MB

## Criterio de aceptación

1. Subir un export real de pedidos de Shopify (`.csv`) y preguntarle produce respuestas correctas
2. Lo mismo con un `.xlsx` con celdas mezcladas, columnas vacías y fechas en formato europeo
3. Un fichero corrupto o vacío da un error entendible, no un stack trace
4. El guard bloquea `ATTACH`, `read_csv` y lectura de ficheros locales desde el SQL generado
5. Los ficheros expirados se borran de verdad, tanto de Storage como de la tabla
6. `npm run build` y `npm run lint` limpios

## Qué NO hacer

- No inventar un pipeline nuevo: se reutiliza `/api/query` y la UI de chat de la Fase 2
- No soportar formatos fuera de csv/tsv/xlsx
- No intentar mapear automáticamente el CSV al schema de Shopify. Un CSV es su propio schema
