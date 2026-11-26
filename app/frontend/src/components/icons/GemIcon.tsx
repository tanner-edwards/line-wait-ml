// Lucide's Gem geometry, with a filled variant. Lucide's own `fill` paints the
// whole silhouette one color, which hides the facet lines and leaves a blob —
// here the filled state paints the outline solid and draws the facets in
// `cutoutColor` (the background behind the icon) so the cuts still read.

import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
  /** Solid gem with the facets knocked out. */
  filled?: boolean;
  /** Facet color when filled — match the background behind the icon. */
  cutoutColor?: string;
  strokeWidth?: number;
}

export const GEM_OUTLINE =
  'M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z';
export const GEM_FACETS = ['M10.5 3 8 9l4 13 4-13-2.5-6', 'M2 9h20'];

export function GemIcon({
  size = 24,
  color = '#000',
  filled = false,
  cutoutColor = '#fff',
  strokeWidth = 2,
}: Props): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d={GEM_OUTLINE} fill={filled ? color : 'none'} />
      {GEM_FACETS.map(d => (
        <Path key={d} d={d} stroke={filled ? cutoutColor : color} />
      ))}
    </Svg>
  );
}
