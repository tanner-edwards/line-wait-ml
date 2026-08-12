// Horizontal range bar: |─●─| from p10 → p90 with the current wait as a
// dot. A "typical for this slot" tick floats inside the track (or outside
// it when out of range).
//
// Out-of-bounds design principle (both sides):
//   When current or typical falls outside the P10–P90 range, the element
//   renders beyond the track edge with a dashed connector back to the track.
//   The gap is proportional to how far outside the range that value sits.
//   FLOAT_PAD reserves space on each side for these floating elements, but
//   only expands when something actually needs it — in-bounds states use
//   PAD_NORMAL on both sides so the bar remains centered.
//
// Geometry is extracted into computeLayout() so it can be unit tested
// without rendering SVG.

import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme/tokens';
import { roundWait } from '../../utils/roundWait';
import { Badge } from '../../types';


// Geometry constants — all in the viewBox coordinate system.
export const TR_W = 360;
export const PAD_NORMAL = 12;  // padding when nothing floats out of bounds
export const FLOAT_PAD  = 52;  // padding on a side that accommodates OOB elements
export const TRACK_TOP_Y    = 4;
export const TRACK_H        = 8;
export const TRACK_CY       = TRACK_TOP_Y + TRACK_H / 2;
const TRACK_BOTTOM_Y  = TRACK_TOP_Y + TRACK_H;
export const LABEL_Y        = TRACK_BOTTOM_Y + 16;
export const TR_H           = LABEL_Y + 10;
const PROX            = 44;   // proximity threshold for dropping typical label


interface Props {
  p10: number;
  p90: number;
  current: number | null;
  typicalWait: number | null;
  badge: Badge;
}

// Fill/dot color follows the verdict badge so the bar reinforces the ONE
// signal. It used to compute its own upper-quartile "red" rule, which painted
// red on neutral rides (e.g. Pirates at 25 within a 5–30 range) and contradicted
// the badge. Neutral (no badge) → brand; the dot's position still carries the
// "where in range" information without a false skip signal.
const BADGE_FILL: Record<'go' | 'skip' | 'star', string> = {
  go: colors.go,
  skip: colors.skip,
  star: colors.star,
};

export interface RangeLayout {
  innerLeft: number;
  innerRight: number;
  totalW: number;
  dotX: number | null;
  dotFloatingLeft: boolean;
  dotFloatingRight: boolean;
  typicalX: number | null;
  typicalInBounds: boolean;
  typicalLabelX: number | null;
  typicalLabelY: number;
  svgH: number;
}

/** Pure geometry computation — exported for unit testing. */
export function computeLayout(
  p10: number,
  p90: number,
  current: number | null,
  typicalWait: number | null,
): RangeLayout {
  const range = Math.max(1, p90 - p10);

  const dotRatio     = current     != null ? (current     - p10) / range : null;
  const typicalRatio = typicalWait != null ? (typicalWait - p10) / range : null;

  // Expand padding only on the side that needs it.
  const needsLeftFloat  = (dotRatio != null && dotRatio < 0) || (typicalRatio != null && typicalRatio < 0);
  const needsRightFloat = (dotRatio != null && dotRatio > 1) || (typicalRatio != null && typicalRatio > 1);

  const innerLeft  = needsLeftFloat  ? FLOAT_PAD : PAD_NORMAL;
  const innerRight = TR_W - (needsRightFloat ? FLOAT_PAD : PAD_NORMAL);
  const totalW     = innerRight - innerLeft;

  // Dot — unclamped; capped only at SVG edges (dot radius = 7).
  const rawDotX = dotRatio != null ? innerLeft + dotRatio * totalW : null;
  const dotX    = rawDotX != null ? Math.max(7, Math.min(TR_W - 7, rawDotX)) : null;
  const dotFloatingLeft  = rawDotX != null && rawDotX < innerLeft;
  const dotFloatingRight = rawDotX != null && rawDotX > innerRight;

  // Typical marker — unclamped on both sides.
  const rawTypicalX = typicalRatio != null ? innerLeft + typicalRatio * totalW : null;
  const typicalX    = rawTypicalX  != null ? Math.max(7, Math.min(TR_W - 7, rawTypicalX)) : null;
  const typicalInBounds = rawTypicalX != null && rawTypicalX >= innerLeft && rawTypicalX <= innerRight;

  // Label: nudge away from track endpoints when in-bounds; anchor near tick when floating.
  const typicalLabelX = typicalX != null
    ? typicalInBounds
      ? Math.max(innerLeft + 28, Math.min(innerRight - 28, typicalX))
      : Math.max(22, Math.min(TR_W - 22, typicalX))
    : null;

  // Drop typical label to a second row only when in-bounds and crowding an endpoint label.
  const typicalDropped = typicalInBounds && typicalLabelX != null && (
    typicalLabelX - innerLeft < PROX || innerRight - typicalLabelX < PROX
  );

  return {
    innerLeft, innerRight, totalW,
    dotX, dotFloatingLeft, dotFloatingRight,
    typicalX, typicalInBounds, typicalLabelX,
    typicalLabelY: typicalDropped ? LABEL_Y + 14 : LABEL_Y,
    svgH: typicalDropped ? TR_H + 14 : TR_H,
  };
}

export function TodaysRange({ p10, p90, current, typicalWait, badge }: Props): React.ReactElement {
  const [renderW, setRenderW] = useState(0);

  // Fill/dot color = the verdict badge (see BADGE_FILL). No independent rule.
  const fillColor = badge ? BADGE_FILL[badge] : colors.brand;

  // Round to Disney's 5-min grid ONCE, then drive BOTH positions and labels
  // from the rounded values. Raw positions + rounded labels was the drift
  // source — a dot/marker/endpoint would sit where its label didn't claim.
  const rP10 = roundWait(p10);
  const rP90 = roundWait(p90);
  const rCurrent = current != null ? roundWait(current) : null;
  const rTypical = typicalWait != null ? roundWait(typicalWait) : null;

  const {
    innerLeft, innerRight, totalW,
    dotX, dotFloatingLeft, dotFloatingRight,
    typicalX, typicalLabelX, typicalLabelY, svgH,
  } = computeLayout(rP10, rP90, rCurrent, rTypical);

  return (
    <View>
      <View onLayout={e => setRenderW(Math.round(e.nativeEvent.layout.width))}>
        {renderW > 0 ? (
          <>
          <Svg
            width={renderW}
            height={svgH}
            viewBox={`0 0 ${TR_W} ${svgH}`}
            preserveAspectRatio="none"
          >
            {/* Track background */}
            <Rect
              x={innerLeft} y={TRACK_TOP_Y}
              width={totalW} height={TRACK_H}
              rx={TRACK_H / 2}
              fill={colors.border}
            />

            {/* Dashed connector — left float */}
            {dotX != null && dotFloatingLeft ? (
              <Line
                x1={dotX} x2={innerLeft}
                y1={TRACK_CY} y2={TRACK_CY}
                stroke={fillColor} strokeWidth={1.5}
                strokeDasharray="3 4" opacity={0.5}
              />
            ) : null}

            {/* Dashed connector — right float */}
            {dotX != null && dotFloatingRight ? (
              <Line
                x1={innerRight} x2={dotX}
                y1={TRACK_CY} y2={TRACK_CY}
                stroke={fillColor} strokeWidth={1.5}
                strokeDasharray="3 4" opacity={0.5}
              />
            ) : null}

            {/* Fill carries the verdict: only drawn when there's a badge, so a
                neutral ride never shows an alarming full/partial bar — just the
                position dot on an empty track. skip → long red, go/star → short
                green/gold, neutral → no fill. */}
            {dotX != null && !dotFloatingLeft && badge != null ? (
              <Rect
                x={innerLeft} y={TRACK_TOP_Y}
                width={dotFloatingRight ? totalW : dotX - innerLeft}
                height={TRACK_H}
                rx={TRACK_H / 2}
                fill={fillColor}
              />
            ) : null}

            {/* Typical marker tick */}
            {typicalX != null ? (
              <Line
                x1={typicalX} x2={typicalX}
                y1={TRACK_TOP_Y - 4} y2={TRACK_BOTTOM_Y + 4}
                stroke={colors.textTertiary} strokeWidth={2}
              />
            ) : null}

            {/* p10 / p90 endpoint labels — anchored to the actual track ends
                (same coordinate system as the track), so they follow the float
                padding instead of pinning to the container edges. */}
            <SvgText
              x={innerLeft} y={LABEL_Y}
              fontSize="12" fill={colors.textSecondary} textAnchor="start"
            >
              {`${rP10}m`}
            </SvgText>
            <SvgText
              x={innerRight} y={LABEL_Y}
              fontSize="12" fill={colors.textSecondary} textAnchor="end"
            >
              {`${rP90}m`}
            </SvgText>

            {/* Typical label */}
            {typicalX != null && typicalLabelX != null && rTypical != null ? (
              <SvgText
                x={typicalLabelX} y={typicalLabelY}
                fontSize="12" fontWeight="500"
                fill={colors.textSecondary} textAnchor="middle"
              >
                {`usually ${rTypical}m`}
              </SvgText>
            ) : null}

            {/* Current wait dot */}
            {dotX != null ? (
              <Circle cx={dotX} cy={TRACK_CY} r={7} fill={fillColor} stroke="white" strokeWidth={2} />
            ) : null}
          </Svg>
          </>
        ) : null}
      </View>

    </View>
  );
}
