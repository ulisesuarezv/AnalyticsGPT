'use client';

/**
 * Un turno de la conversación.
 *
 * El bloque del asistente se rellena por partes según llegan del stream. Los
 * estados intermedios llevan SIEMPRE texto ("consultando tus datos"), nunca un
 * spinner mudo: con latencias de dos dígitos, lo que separa "lento" de "roto"
 * es que se vea en qué paso va.
 */

import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { InsightCard } from './InsightCard';
import { QueryResult } from './QueryResult';

/** Qué se está haciendo ahora mismo, según lo que ya ha llegado. */
const STAGE_BY_STATUS = {
  pending: 'stageWritingSql',
  sql: 'stageRunning',
  rows: 'stageSummarizing',
};

function Stage({ status }) {
  const t = useTranslations('Chat');
  const key = STAGE_BY_STATUS[status];
  if (!key) return null;

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <span className="bg-muted-foreground/60 size-1.5 animate-pulse rounded-full" />
      {t(key)}
    </p>
  );
}

export function MessageBubble({ message, currency, onAsk, busy }) {
  const t = useTranslations('Chat');

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-pretty">
          {message.question}
        </p>
      </div>
    );
  }

  const insights = message.insights ?? [];

  return (
    <div className="space-y-4">
      <QueryResult message={message} currency={currency} />

      {message.answer ? (
        <p className="text-[15px] leading-relaxed text-pretty whitespace-pre-wrap">
          {message.answer}
          {message.status === 'answering' ? (
            <span className="bg-foreground ml-0.5 inline-block h-4 w-[2px] animate-pulse align-text-bottom" />
          ) : null}
        </p>
      ) : null}

      <Stage status={message.status} />

      {message.error ? (
        <div className="border-destructive/40 bg-destructive/5 text-foreground flex items-start gap-2 rounded-md border p-3 text-sm">
          <AlertCircle className="text-destructive mt-0.5 size-4 shrink-0" />
          <span className="text-pretty">{message.error}</span>
        </div>
      ) : null}

      {insights.length > 0 ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('insightsTitle')}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {insights.map((insight, index) => (
              <InsightCard
                key={`${insight.title}-${index}`}
                insight={insight}
                onAsk={onAsk}
                disabled={busy}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
