/**
 * Errores tipados de la capa de datos.
 *
 * Los errores crudos de Postgres NUNCA salen al cliente: revelan nombres de
 * tablas, tipos de columna y a veces fragmentos de datos. Se conserva el
 * original en `cause` para el log del servidor y se expone solo un código.
 */

export const DB_ERROR_CODES = {
  TIMEOUT: 'TIMEOUT',
  SYNTAX: 'SYNTAX',
  PERMISSION: 'PERMISSION',
  UNKNOWN_COLUMN: 'UNKNOWN_COLUMN',
  UNKNOWN_TABLE: 'UNKNOWN_TABLE',
  DIVISION_BY_ZERO: 'DIVISION_BY_ZERO',
  INVALID_INPUT: 'INVALID_INPUT',
  CONNECTION: 'CONNECTION',
  UNKNOWN: 'UNKNOWN',
};

export class QueryError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'QueryError';
    this.code = code;
    this.cause = cause;
  }

  /**
   * Mensaje seguro para reinyectar en el prompt del LLM en un reintento.
   * Incluye el detalle de Postgres a propósito —el modelo lo necesita para
   * corregir— pero esto no es lo que se le enseña al usuario final.
   */
  get promptHint() {
    return this.cause?.message ? `${this.code}: ${this.cause.message}` : this.code;
  }
}

/** Mapea un error de `postgres` a un código estable. */
export function toQueryError(error) {
  const pgCode = error?.code;

  switch (pgCode) {
    case '57014':
      return new QueryError(DB_ERROR_CODES.TIMEOUT, 'La consulta tardó demasiado', error);
    case '42601':
      return new QueryError(DB_ERROR_CODES.SYNTAX, 'SQL con error de sintaxis', error);
    case '42501':
      return new QueryError(DB_ERROR_CODES.PERMISSION, 'Permiso denegado', error);
    case '42703':
      return new QueryError(DB_ERROR_CODES.UNKNOWN_COLUMN, 'Columna inexistente', error);
    case '42P01':
      return new QueryError(DB_ERROR_CODES.UNKNOWN_TABLE, 'Tabla o vista inexistente', error);
    case '22012':
      return new QueryError(DB_ERROR_CODES.DIVISION_BY_ZERO, 'División por cero', error);
    case '22P02':
    case '22007':
    case '22008':
      return new QueryError(DB_ERROR_CODES.INVALID_INPUT, 'Valor con formato inválido', error);
    default:
      break;
  }

  if (error?.code === 'CONNECT_TIMEOUT' || error?.errno === 'ECONNREFUSED') {
    return new QueryError(DB_ERROR_CODES.CONNECTION, 'No se pudo conectar a la base', error);
  }
  if (error instanceof QueryError) return error;

  return new QueryError(DB_ERROR_CODES.UNKNOWN, 'Error al ejecutar la consulta', error);
}
