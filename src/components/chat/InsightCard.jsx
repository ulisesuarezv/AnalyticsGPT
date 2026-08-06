'use client';

/**
 * Insight proactivo. Al pulsarlo lanza su `querySuggestion` como pregunta.
 *
 * Es el bucle de enganche del producto: la respuesta a una pregunta contiene la
 * siguiente pregunta, ya escrita. Por eso la tarjeta ENTERA es el botón, no un
 * enlace pequeño al final del texto.
 */

import { ArrowUpRight, Lightbulb } from 'lucide-react';

export function InsightCard({ insight, onAsk, disabled }) {
  const suggestion = insight.querySuggestion?.trim();

  const content = (
    <>
      <div className="flex items-start gap-2">
        <Lightbulb className="text-chart-3 mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-pretty">{insight.title}</p>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">{insight.description}</p>
        </div>
      </div>
      {/* `min-w-0` en el <p> es lo que permite que `truncate` actúe: sin él, el
          texto de la sugerencia ensancha la tarjeta y se sale en móvil. */}
      {suggestion ? (
        <p className="text-muted-foreground group-hover:text-foreground mt-3 flex min-w-0 items-center gap-1 text-xs font-medium transition-colors">
          <span className="truncate">{suggestion}</span>
          <ArrowUpRight className="size-3.5 shrink-0" />
        </p>
      ) : null}
    </>
  );

  if (!suggestion) {
    return <div className="border-border bg-card rounded-md border p-3">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onAsk(suggestion)}
      disabled={disabled}
      className="group border-border bg-card hover:border-foreground/20 hover:bg-accent/50 focus-visible:ring-ring w-full min-w-0 cursor-pointer rounded-md border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      {content}
    </button>
  );
}
