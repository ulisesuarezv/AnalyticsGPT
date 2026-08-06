/**
 * Cliente Postgres readonly — el ÚNICO canal por el que se ejecuta SQL generado
 * por el LLM. Ver docs/ARQUITECTURA.md §3, capa 2.
 *
 * Usa `DATABASE_URL_READONLY` (rol `query_runner`). Nunca el service role, nunca
 * la conexión admin.
 */

import postgres from 'postgres';

/** Pool pequeño y reutilizado entre invocaciones (serverless: instancia caliente). */
const globalForDb = globalThis;

export function getReadonlyClient() {
  if (!globalForDb.__readonlyPool) {
    const url = process.env.DATABASE_URL_READONLY;
    if (!url) throw new Error('DATABASE_URL_READONLY no está configurada');

    globalForDb.__readonlyPool = postgres(url, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      // El pooler de Supabase en modo transacción no soporta prepared statements.
      prepare: false,
      onnotice: () => {},
      types: {
        // `numeric` llega como string para no perder precisión en importes
        // grandes. Aquí se convierte a number: los valores de una tienda caben
        // de sobra en un double y la respuesta tiene que ser JSON serializable.
        numeric: {
          to: 1700,
          from: [1700],
          serialize: (x) => String(x),
          parse: (x) => Number.parseFloat(x),
        },
        // `count(*)` y demás agregados devuelven int8, que por defecto llega
        // como string. Sin esto, un recuento acaba en el chart y en el prompt
        // del LLM como texto, y las comparaciones numéricas fallan en silencio.
        int8: {
          to: 20,
          from: [20],
          serialize: (x) => String(x),
          parse: (x) => Number(x),
        },
      },
    });
  }
  return globalForDb.__readonlyPool;
}
