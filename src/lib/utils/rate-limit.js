/**
 * Rate limit por IP para la demo pública.
 *
 * Ventana deslizante en memoria del proceso. Es deliberadamente simple: la demo
 * es pública y cada pregunta cuesta dos llamadas al LLM, así que hace falta un
 * tope real, pero no una dependencia de infraestructura en el hito de la demo.
 *
 * LIMITACIÓN CONOCIDA: en serverless el contador es por instancia, así que con
 * varias instancias calientes el tope efectivo es un múltiplo del configurado.
 * Frena el abuso casual y el bucle accidental, no un ataque distribuido. El
 * límite compartido (Upstash o equivalente) es Fase 8 — anotado en ESTADO.md.
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 30;
/** Cota del mapa: sin esto, una instancia larga acumula IPs sin fin. */
const MAX_TRACKED_KEYS = 10_000;

const globalForRateLimit = globalThis;

function getStore() {
  if (!globalForRateLimit.__rateLimitStore) {
    globalForRateLimit.__rateLimitStore = new Map();
  }
  return globalForRateLimit.__rateLimitStore;
}

/**
 * Registra un intento y dice si se permite.
 *
 * @param {string} key Identificador del cliente (la IP, ya normalizada).
 * @returns {{ allowed: boolean, remaining: number, retryAfterSeconds: number }}
 */
export function checkRateLimit(key, { max = MAX_PER_WINDOW, windowMs = WINDOW_MS } = {}) {
  const store = getStore();
  const now = Date.now();

  if (store.size > MAX_TRACKED_KEYS) {
    for (const [k, stamps] of store) {
      if (stamps.every((t) => now - t >= windowMs)) store.delete(k);
    }
    // Si tras la limpieza sigue lleno, se descarta entero: perder contadores es
    // preferible a que el proceso crezca sin techo.
    if (store.size > MAX_TRACKED_KEYS) store.clear();
  }

  const stamps = (store.get(key) ?? []).filter((t) => now - t < windowMs);

  if (stamps.length >= max) {
    store.set(key, stamps);
    const retryAfterSeconds = Math.ceil((windowMs - (now - stamps[0])) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  stamps.push(now);
  store.set(key, stamps);
  return { allowed: true, remaining: max - stamps.length, retryAfterSeconds: 0 };
}

/**
 * IP del cliente a partir de las cabeceras del proxy.
 * En Vercel `x-forwarded-for` lo fija la plataforma; en local no hay ninguna y
 * cae a una clave fija, que para un solo desarrollador es correcto.
 */
export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'local';
}
