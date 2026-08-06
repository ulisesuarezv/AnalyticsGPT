'use client';

/**
 * Contenedor del chat: estado de la conversación y envío contra /api/query.
 *
 * Consume la ruta en modo SSE (`Accept: text/event-stream`) para pintar cada
 * pieza en cuanto llega —SQL ~3,3 s, filas ~3,5 s, prosa ~7 s— en vez de
 * esperar a los ~7 s del pipeline completo. El evento `done` trae el payload
 * del contrato (ARQUITECTURA.md §5) y REEMPLAZA lo acumulado: si hubo un
 * reintento del modelo, lo emitido antes ya no vale.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { MessageBubble } from './MessageBubble';
import { SuggestedQuestions } from './SuggestedQuestions';
import { Button } from '@/components/ui/button';
import { buildHistorySummary } from '@/lib/chat/history';

const MAX_QUESTION_LENGTH = 500;

/** Trocea un stream SSE en `{ event, data }`. */
async function* parseSseStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');

    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      let event = 'message';
      const dataLines = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }

      if (dataLines.length > 0) {
        try {
          yield { event, data: JSON.parse(dataLines.join('\n')) };
        } catch {
          // Un bloque ilegible no debe tumbar la conversación entera.
        }
      }
    }
  }
}

export function ChatInterface({ source = 'demo', currency, afterQuestions = null, ctaAfter = 2 }) {
  const t = useTranslations('Chat');
  const locale = useLocale();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  // El historial se lee dentro de `ask` sin que `ask` dependa de él: si no,
  // cada mensaje recrearía el callback y con él los handlers de toda la lista.
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const ask = useCallback(async (rawQuestion) => {
    const question = rawQuestion.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!question || abortRef.current) return;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const historySummary = buildHistorySummary(messagesRef.current);

    setInput('');
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { id: `${id}-q`, role: 'user', question },
      { id, role: 'assistant', question, status: 'pending', answer: '', insights: [] },
    ]);

    const patch = (changes) => setMessages((prev) => prev.map(
      (message) => (message.id === id ? { ...message, ...changes } : message),
    ));

    const controller = new AbortController();
    abortRef.current = controller;
    let answer = '';

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ question, source, locale, historySummary }),
        signal: controller.signal,
      });

      // Los errores previos al stream (validación, rate limit) vienen en JSON.
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        const payload = await response.json().catch(() => null);
        patch({ status: 'error', error: payload?.error?.message ?? t('genericError') });
        return;
      }

      for await (const { event, data } of parseSseStream(response.body)) {
        if (event === 'sql') {
          patch({ status: 'sql', sql: data.sql });
        } else if (event === 'rows') {
          patch({
            status: 'rows',
            rows: data.rows,
            rowCount: data.rowCount,
            truncated: data.truncated,
          });
        } else if (event === 'answerDelta') {
          answer += data.delta;
          patch({ status: 'answering', answer });
        } else if (event === 'done') {
          patch({
            status: 'done',
            sql: data.sql,
            rows: data.rows,
            rowCount: data.rowCount,
            truncated: data.truncated,
            answer: data.answer ?? answer,
            chart: data.chart,
            insights: data.insights ?? [],
          });
        } else if (event === 'error') {
          patch({ status: 'error', error: data.error?.message ?? t('genericError') });
        }
      }

      // El stream se cortó sin `done` ni `error` (red, timeout del proxy).
      setMessages((prev) => prev.map((message) => (
        message.id === id && message.status !== 'done' && message.status !== 'error'
          ? { ...message, status: 'error', error: t('genericError') }
          : message
      )));
    } catch (error) {
      if (error.name === 'AbortError') {
        // Parada voluntaria: se conserva lo que ya había llegado.
        patch({ status: 'done', answer });
      } else {
        patch({ status: 'error', error: t('genericError') });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      textareaRef.current?.focus();
    }
  }, [locale, source, t]);

  const stop = () => abortRef.current?.abort();

  const submit = (event) => {
    event.preventDefault();
    ask(input);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask(input);
    }
  };

  const answered = messages.filter((m) => m.role === 'assistant' && m.status === 'done').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <SuggestedQuestions onAsk={ask} disabled={busy} />
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                currency={currency}
                onAsk={ask}
                busy={busy}
              />
            ))
          )}

          {answered >= ctaAfter ? afterQuestions : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-border bg-background/80 border-t backdrop-blur">
        <form onSubmit={submit} className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
          <div className="border-border focus-within:border-foreground/30 flex items-end gap-2 rounded-xl border p-2 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={MAX_QUESTION_LENGTH}
              placeholder={t('placeholder')}
              aria-label={t('placeholder')}
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none"
            />
            {busy ? (
              <Button type="button" size="icon" variant="secondary" onClick={stop} aria-label={t('stop')}>
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label={t('send')}>
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
          <p className="text-muted-foreground mt-2 text-center text-xs text-balance">
            {t('disclaimer')}
          </p>
        </form>
      </div>
    </div>
  );
}
