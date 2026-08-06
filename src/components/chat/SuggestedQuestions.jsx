'use client';

/**
 * Preguntas de arranque. El chat vacío no puede ser un cursor parpadeando: un
 * desconocido tiene que entender en 30 segundos qué se le puede preguntar.
 *
 * El texto sale de `messages/*.json` (`Chat.suggestions`), así que están en el
 * idioma activo. Se eligen para cubrir tipos distintos de respuesta —escalar,
 * ranking, serie temporal, cruce de dos conceptos— y no solo variantes de "top
 * productos".
 */

import { useTranslations } from 'next-intl';

const SUGGESTION_KEYS = ['revenue', 'topProducts', 'trend', 'repeatCustomers', 'geography', 'lowStock'];

export function SuggestedQuestions({ onAsk, disabled }) {
  const t = useTranslations('Chat');

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {t('suggestionsTitle')}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {SUGGESTION_KEYS.map((key) => {
          const question = t(`suggestions.${key}`);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onAsk(question)}
              disabled={disabled}
              className="border-border bg-card hover:border-foreground/20 hover:bg-accent/50 focus-visible:ring-ring cursor-pointer rounded-md border px-3 py-2.5 text-left text-sm text-pretty transition-colors focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {question}
            </button>
          );
        })}
      </div>
    </div>
  );
}
