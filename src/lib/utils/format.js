/**
 * Formateo de las celdas que ve el usuario.
 *
 * Regla: formatear NUNCA cambia el valor. Se ajustan separadores y se recortan
 * fechas ISO, y nada más — redondear aquí rompería la única promesa del
 * producto (docs/ARQUITECTURA.md §1).
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** Columnas cuyo valor es dinero, por convención de nombre del catálogo. */
const MONEY_HINTS = ['price', 'revenue', 'total', 'spent', 'amount', 'sales', 'discount', 'tax'];

export function isMoneyColumn(column) {
  const name = String(column).toLowerCase();
  return MONEY_HINTS.some((hint) => name.includes(hint));
}

export function isNumericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value));
  return false;
}

/**
 * Un valor de celda como texto.
 * Los decimales se respetan tal cual vienen: `toLocaleString` con
 * `maximumFractionDigits` fijo redondearía, y eso no se hace aquí.
 */
export function formatValue(value, { column = '', locale = 'en', currency = null } = {}) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';

  if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
    }
  }

  if (isNumericValue(value)) {
    const asNumber = Number(value);
    const decimals = String(value).includes('.') ? String(value).split('.')[1].length : 0;
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(asNumber);

    return currency && isMoneyColumn(column) ? `${formatted} ${currency}` : formatted;
  }

  return String(value);
}

/** Etiqueta legible para una columna: `total_revenue` → `Total revenue`. */
export function formatColumnName(column) {
  const words = String(column).replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Números compactos para los ejes: 12.400 → 12,4 k. */
export function formatAxisNumber(value, locale = 'en') {
  if (!isNumericValue(value)) return String(value ?? '');
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
    .format(Number(value));
}
