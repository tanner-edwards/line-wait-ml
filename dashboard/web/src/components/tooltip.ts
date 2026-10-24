import type { ChartTheme } from '../theme';

/** Shared Recharts tooltip styling: card surface, text tokens, no series-colored text. */
export function tooltipProps(t: ChartTheme) {
  return {
    contentStyle: {
      background: t.surface,
      border: `1px solid ${t.axis}`,
      borderRadius: 10,
      fontSize: 13,
      color: t.ink,
      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
    },
    labelStyle: { color: t.inkSecondary, marginBottom: 4 },
    itemStyle: { color: t.ink, padding: 0 },
    cursor: { stroke: t.axis, strokeWidth: 1 },
  };
}

export function axisProps(t: ChartTheme) {
  return {
    stroke: t.axis,
    tick: { fill: t.muted, fontSize: 12 },
    tickLine: false,
  };
}
