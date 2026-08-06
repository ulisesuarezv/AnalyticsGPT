/**
 * Export de un resultado: CSV de la tabla y PNG del gráfico.
 *
 * El CSV lleva los valores CRUDOS que devolvió Postgres, no los formateados
 * para pantalla: quien exporta va a abrirlo en una hoja de cálculo y necesita
 * números que sumen, no cadenas con separadores de miles.
 */

/** Cierto para valores que Excel interpretaría como fórmula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Prefijo de comilla simple contra CSV injection: el fichero se abre en Excel.
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** @param {object[]} rows @returns {string} */
export function rowsToCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const lines = [columns.map(escapeCsvValue).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvValue(row[column])).join(','));
  }
  return lines.join('\n');
}

/** Nombre de fichero seguro a partir del título del chart o de la pregunta. */
export function toFileName(label, extension) {
  const slug = String(label ?? 'export')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'export';
  return `${slug}.${extension}`;
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(rows, label) {
  const csv = rowsToCsv(rows);
  if (!csv) return;
  // BOM para que Excel abra los acentos bien.
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, toFileName(label, 'csv'));
}

/**
 * PNG del nodo del gráfico. `html-to-image` se importa dinámicamente para no
 * meterlo en el bundle de quien nunca pulsa exportar.
 */
export async function downloadPng(node, label, backgroundColor) {
  if (!node) return;
  const { toBlob } = await import('html-to-image');
  const blob = await toBlob(node, {
    pixelRatio: 2,
    backgroundColor,
    // Fontshare es cross-origin: intentar inlinear la fuente falla y aborta la
    // captura. El PNG sale con la fuente de sistema, que es aceptable.
    skipFonts: true,
  });
  if (blob) triggerDownload(blob, toFileName(label, 'png'));
}
