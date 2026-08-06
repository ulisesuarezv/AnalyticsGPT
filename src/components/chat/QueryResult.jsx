'use client';

/**
 * El resultado de una pregunta: SQL ejecutado, gráfico y tabla.
 *
 * El orden en pantalla es EL ORDEN EN QUE LLEGAN LAS PIEZAS (SQL ~3,3 s, filas
 * ~3,5 s, prosa ~7 s). Poner la respuesta redactada arriba obligaría a empujar
 * la tabla hacia abajo cada vez que termina el modelo: un salto de layout en
 * cada pregunta, y en móvil se nota mucho.
 *
 * El SQL desplegable no es un detalle para developers: es la prueba de que el
 * número salió de una consulta y no de una suposición.
 */

import { useRef, useState } from 'react';
import { Check, ChevronRight, Copy, Download, Image as ImageIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { ChartRenderer } from './ChartRenderer';
import { Button } from '@/components/ui/button';
import { downloadCsv, downloadPng } from '@/lib/chat/export';
import { formatColumnName, formatValue, isNumericValue } from '@/lib/utils/format';

/** Filas pintadas en el DOM. El resto sigue en el CSV, íntegro. */
const MAX_RENDERED_ROWS = 50;

function SqlDisclosure({ sql }) {
  const t = useTranslations('Chat');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles no hay nada que hacer, y no es un error
      // que merezca interrumpir al usuario.
    }
  };

  return (
    <details className="group border-border bg-muted/40 rounded-md border">
      <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {t('sqlToggle')}
      </summary>
      <div className="border-border relative border-t">
        <pre className="overflow-x-auto px-3 py-2.5 pr-11 font-mono text-xs leading-relaxed">
          {sql}
        </pre>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-1.5 right-1.5"
          onClick={copy}
          aria-label={t('copySql')}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </details>
  );
}

function ResultTable({ rows, rowCount, truncated, currency }) {
  const locale = useLocale();
  const t = useTranslations('Chat');

  const columns = Object.keys(rows[0]);
  const shown = rows.slice(0, MAX_RENDERED_ROWS);

  return (
    <div>
      {/* El scroll horizontal vive AQUÍ, nunca en la página (criterio 8). */}
      <div className="border-border max-h-80 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 sticky top-0 backdrop-blur">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className={`text-muted-foreground border-border border-b px-3 py-2 font-medium whitespace-nowrap ${
                    isNumericValue(rows[0][column]) ? 'text-right' : 'text-left'
                  }`}
                >
                  {formatColumnName(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={index} className="border-border/60 last:border-0 border-b">
                {columns.map((column) => (
                  <td
                    key={column}
                    className={`px-3 py-2 whitespace-nowrap ${
                      isNumericValue(row[column]) ? 'text-right tabular-nums' : 'text-left'
                    }`}
                  >
                    {formatValue(row[column], { column, locale, currency })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground mt-2 text-xs">
        {rows.length > shown.length
          ? t('rowsShown', { shown: shown.length, total: rowCount })
          : t('rowCount', { count: rowCount })}
        {truncated ? ` · ${t('truncated')}` : ''}
      </p>
    </div>
  );
}

export function QueryResult({ message, currency }) {
  const t = useTranslations('Chat');
  const chartRef = useRef(null);
  const { sql, rows, rowCount, truncated, chart } = message;

  const hasRows = Array.isArray(rows) && rows.length > 0;
  const hasChart = chart && chart.type !== 'table' && hasRows;

  if (!sql && !hasRows) return null;

  const exportPng = () => {
    const background = getComputedStyle(document.body).backgroundColor;
    downloadPng(chartRef.current, chart?.title || message.question, background);
  };

  return (
    <div className="space-y-3">
      {sql ? <SqlDisclosure sql={sql} /> : null}

      {hasChart ? (
        <div ref={chartRef} className="bg-card border-border rounded-md border p-3">
          <ChartRenderer chart={chart} rows={rows} currency={currency} />
        </div>
      ) : null}

      {hasRows ? <ResultTable rows={rows} rowCount={rowCount} truncated={truncated} currency={currency} /> : null}

      {hasRows && message.status === 'done' ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCsv(rows, chart?.title || message.question)}>
            <Download className="size-3.5" />
            {t('exportCsv')}
          </Button>
          {hasChart ? (
            <Button variant="outline" size="sm" onClick={exportPng}>
              <ImageIcon className="size-3.5" />
              {t('exportPng')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
