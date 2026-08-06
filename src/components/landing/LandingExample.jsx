'use client';

/**
 * El ejemplo de la landing: una pregunta real, la consulta que se ejecutó y el
 * resultado que devolvió.
 *
 * Los datos NO son inventados: salen de ejecutar esa misma pregunta contra el
 * store demo (`Aurora Home & Living`) el 6 de agosto de 2026. Enseñar cifras
 * decorativas en la landing de un producto cuyo argumento es "los números son
 * exactos" sería exactamente el error que el producto dice no cometer. Si el
 * seed cambia, hay que volver a ejecutarla y actualizar estas filas.
 */

import { useTranslations } from 'next-intl';

import { ChartRenderer } from '@/components/chat/ChartRenderer';

const EXAMPLE_SQL = `with sold as (
  select oi.product_ref, oi.title, sum(oi.quantity) as units_sold
    from v_order_items oi
   where oi.created_at_platform >= now() - interval '30 days'
     and oi.financial_status <> 'refunded'
   group by oi.product_ref, oi.title
)
select s.title, s.units_sold
  from sold s
 order by s.units_sold desc
 limit 20`;

const EXAMPLE_ROWS = [
  { title: 'Marble Bath Mat', units_sold: 26 },
  { title: 'Stone Quilted Bedspread', units_sold: 25 },
  { title: 'Marble Bath Towel Set', units_sold: 24 },
  { title: 'Brass Wall Art Print', units_sold: 19 },
  { title: 'Bamboo Picture Frame', units_sold: 18 },
];

const EXAMPLE_CHART = { type: 'bar', xField: 'title', yField: 'units_sold', title: '' };

export function LandingExample() {
  const t = useTranslations('Landing');

  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      <div className="border-border flex items-center gap-2 border-b px-4 py-2.5">
        <span className="bg-muted-foreground/30 size-2 rounded-full" />
        <span className="bg-muted-foreground/30 size-2 rounded-full" />
        <span className="bg-muted-foreground/30 size-2 rounded-full" />
        <span className="text-muted-foreground ml-2 text-xs">{t('exampleChrome')}</span>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex justify-end">
          <p className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm">
            {t('exampleQuestion')}
          </p>
        </div>

        <details className="group border-border bg-muted/40 rounded-md border">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none px-3 py-2 text-xs font-medium">
            <span className="group-open:hidden">{t('exampleSqlShow')}</span>
            <span className="hidden group-open:inline">{t('exampleSqlHide')}</span>
          </summary>
          <pre className="border-border overflow-x-auto border-t px-3 py-2.5 font-mono text-xs leading-relaxed">
            {EXAMPLE_SQL}
          </pre>
        </details>

        <div className="border-border rounded-md border p-3">
          <ChartRenderer chart={EXAMPLE_CHART} rows={EXAMPLE_ROWS} />
        </div>

        <p className="text-[15px] leading-relaxed text-pretty">{t('exampleAnswer')}</p>
        <p className="text-muted-foreground text-xs text-pretty">{t('exampleFootnote')}</p>
      </div>
    </div>
  );
}
