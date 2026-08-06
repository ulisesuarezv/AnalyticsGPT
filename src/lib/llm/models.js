/**
 * Resolución de modelos vía AI SDK.
 *
 * ÚNICO fichero del proyecto que nombra un proveedor. Cambiar de modelo o de
 * proveedor es cambiar `LLM_MODEL` / `LLM_FALLBACK`, no un refactor
 * (docs/ARQUITECTURA.md §4).
 */

import { createOpenAI } from '@ai-sdk/openai';

const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_FALLBACK = 'openai/gpt-4.1-mini';

const globalForLlm = globalThis;

function getOpenAI() {
  if (!globalForLlm.__openaiProvider) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada');
    globalForLlm.__openaiProvider = createOpenAI({ apiKey });
  }
  return globalForLlm.__openaiProvider;
}

/**
 * Resuelve un identificador `proveedor/modelo` a una instancia del AI SDK.
 * @param {string} spec p.ej. "openai/gpt-4o-mini"
 */
function resolve(spec) {
  const [provider, ...rest] = spec.split('/');
  const modelId = rest.join('/');

  switch (provider) {
    case 'openai':
      return getOpenAI()(modelId);
    default:
      throw new Error(`Proveedor no soportado: ${provider}. Añádelo en src/lib/llm/models.js`);
  }
}

export function getPrimaryModel() {
  const spec = process.env.LLM_MODEL || DEFAULT_MODEL;
  return { model: resolve(spec), id: spec };
}

export function getFallbackModel() {
  const spec = process.env.LLM_FALLBACK || DEFAULT_FALLBACK;
  return { model: resolve(spec), id: spec };
}
