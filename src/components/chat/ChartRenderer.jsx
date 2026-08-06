'use client';

/**
 * Gráfico del resultado, con Recharts.
 *
 * Los colores salen SIEMPRE de las variables `--chart-1..5` del tema: pintados
 * a mano se verían mal en uno de los dos modos, y el criterio de aceptación
 * pide claro y oscuro correctos, gráficos incluidos.
 *
 * `chart.type === 'table'` no se pinta aquí: la tabla la renderiza QueryResult
 * y duplicarla no aporta nada.
 */

import { useLocale } from 'next-intl';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

import { formatAxisNumber, formatColumnName, formatValue } from '@/lib/utils/format';

const SERIES_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
];

/** Etiquetas largas ilegibles en móvil: se recortan en el eje, no en el dato. */
const MAX_TICK_CHARS = 14;

const AXIS_PROPS = {
  stroke: 'var(--border)',
  tick: { fill: 'var(--muted-foreground)', fontSize: 12 },
  tickLine: false,
};

function toNumber(value) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

function truncateTick(value) {
  const text = String(value ?? '');
  return text.length > MAX_TICK_CHARS ? `${text.slice(0, MAX_TICK_CHARS - 1)}…` : text;
}

/**
 * El tooltip por defecto de Recharts trae fondo blanco fijo: en oscuro se ve
 * como un parche. Este usa las variables del tema.
 */
function ThemedTooltip({ active, payload, label, locale, currency, xField }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="border-border bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground mb-1">
        {formatValue(label ?? payload[0]?.payload?.[xField], { column: xField, locale })}
      </p>
      {payload.map((entry) => (
        <p key={entry.dataKey ?? entry.name} className="font-medium">
          {formatColumnName(entry.name)}: {formatValue(entry.value, { column: entry.name, locale, currency })}
        </p>
      ))}
    </div>
  );
}

export function ChartRenderer({ chart, rows, currency }) {
  const locale = useLocale();

  if (!chart || chart.type === 'table' || !rows?.length) return null;
  const { type, xField, yField } = chart;
  if (!xField || !yField) return null;

  // Recharts necesita números; Postgres devuelve `numeric` como string.
  const data = rows.map((row) => ({ ...row, [yField]: toNumber(row[yField]) }));

  const tooltip = (
    <Tooltip
      content={<ThemedTooltip locale={locale} currency={currency} xField={xField} />}
      cursor={{ fill: 'var(--muted)', fillOpacity: 0.5, stroke: 'var(--border)' }}
    />
  );

  return (
    <div className="w-full">
      {chart.title ? (
        <p className="text-muted-foreground mb-3 text-xs font-medium">{chart.title}</p>
      ) : null}

      {/* Alto fijo: ResponsiveContainer necesita un contenedor con altura real. */}
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'line' ? (
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey={xField} tickFormatter={truncateTick} {...AXIS_PROPS} />
              <YAxis tickFormatter={(v) => formatAxisNumber(v, locale)} {...AXIS_PROPS} />
              {tooltip}
              <Line
                type="monotone"
                dataKey={yField}
                stroke={SERIES_COLORS[0]}
                strokeWidth={2}
                dot={{ r: 2.5, fill: SERIES_COLORS[0] }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          ) : type === 'pie' ? (
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              {tooltip}
              <Legend
                wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }}
                formatter={(value) => truncateTick(value)}
              />
              <Pie
                data={data}
                dataKey={yField}
                nameKey={xField}
                innerRadius="45%"
                outerRadius="75%"
                paddingAngle={1}
                isAnimationActive={false}
              >
                {data.map((row, index) => (
                  <Cell
                    key={String(row[xField]) + index}
                    fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                    stroke="var(--background)"
                  />
                ))}
              </Pie>
            </PieChart>
          ) : type === 'scatter' ? (
            <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey={xField}
                type={typeof rows[0][xField] === 'number' ? 'number' : 'category'}
                tickFormatter={truncateTick}
                {...AXIS_PROPS}
              />
              <YAxis
                dataKey={yField}
                type="number"
                tickFormatter={(v) => formatAxisNumber(v, locale)}
                {...AXIS_PROPS}
              />
              <ZAxis range={[60, 60]} />
              {tooltip}
              <Scatter data={data} fill={SERIES_COLORS[0]} isAnimationActive={false} />
            </ScatterChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey={xField} tickFormatter={truncateTick} {...AXIS_PROPS} />
              <YAxis tickFormatter={(v) => formatAxisNumber(v, locale)} {...AXIS_PROPS} />
              {tooltip}
              <Bar dataKey={yField} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((row, index) => (
                  <Cell
                    key={String(row[xField]) + index}
                    fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
