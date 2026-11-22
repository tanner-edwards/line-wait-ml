import type { ReactElement } from 'react';

interface LabelArgs { x?: number | string; y?: number | string; index?: number }

/** Direct label: names a series at its last point instead of in a legend.
 *  The chart needs ~60px of right margin for the text. */
export function endLabel(text: string, color: string, lastIndex: number) {
  return ({ x, y, index }: LabelArgs): ReactElement | null =>
    index === lastIndex ? (
      <text x={Number(x) + 8} y={Number(y)} dy={4} fill={color} fontSize={12} fontWeight={600}>{text}</text>
    ) : null;
}
