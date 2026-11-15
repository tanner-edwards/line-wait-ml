// Lucide's Compass geometry, with a filled variant for the selected tab.
// Lucide's own `fill` paints the circle and the needle the same color, which
// hides the needle — here the filled state paints the circle solid and the
// needle in `cutoutColor` (the tab bar background) so it reads as inverted.

import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
  /** Solid circle with the needle knocked out. */
  filled?: boolean;
  /** Needle color when filled — match the background behind the icon. */
  cutoutColor?: string;
  strokeWidth?: number;
}

const NEEDLE =
  'm16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z';

export function CompassIcon({
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
      <Circle cx="12" cy="12" r="10" fill={filled ? color : 'none'} />
      <Path
        d={NEEDLE}
        fill={filled ? cutoutColor : 'none'}
        stroke={filled ? cutoutColor : color}
      />
    </Svg>
  );
}
