// Hand-drawn checkmark for the swipe-to-retire action panel — supplied as a
// standalone SVG with a hardcoded fill; re-exposed here as a normal icon
// component (size/color props) so it drops into the same call sites as a
// lucide icon.

import React from 'react';
import Svg, { Path } from 'react-native-svg';

const PATH_D =
  'M72.963 0l1.888 2.699c-7.7 5.792-16.263 14.713-25.69 26.763s-16.62 23.308-21.584 33.775l-3.993 2.698c-3.312 2.301-5.562 4.009-6.748 5.125-.469-1.69-1.493-4.46-3.074-8.31l-1.514-3.506c-2.158-5.036-4.164-8.758-6.017-11.169S2.301 44.064 0 43.274c3.884-4.124 7.446-6.185 10.685-6.185 2.77 0 5.846 3.768 9.229 11.303l1.672 3.786c6.078-10.252 13.887-20.214 23.422-29.892S63.859 5.186 72.963.004z';

interface RodeItCheckmarkProps {
  size?: number;
  color?: string;
}

export function RodeItCheckmark({ size = 24, color = '#000' }: RodeItCheckmarkProps): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 75.15 72.15">
      <Path d={PATH_D} fill={color} />
    </Svg>
  );
}
