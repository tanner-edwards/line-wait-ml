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
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme/tokens';
import { roundWait } from '../../utils/roundWait';


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
}

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

export function TodaysRange({ p10, p90, current, typicalWait }: Props): React.ReactElement {
  const [renderW, setRenderW] = useState(0);

  // High-range fill: use skip color when current is in the upper quartile.
  const fillColor = (current != null && current > p10 + (p90 - p10) * 0.75)
    ? colors.skip
    : colors.brand;

  const {
    innerLeft, innerRight, totalW,
    dotX, dotFloatingLeft, dotFloatingRight,
    typicalX, typicalLabelX, typicalLabelY, svgH,
  } = computeLayout(p10, p90, current, typicalWait);

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

            {/* Fill: none when below range, full when above range, partial when in range */}
            {dotX != null && !dotFloatingLeft ? (
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

            {/* Typical label */}
            {typicalX != null && typicalLabelX != null && typicalWait != null ? (
              <SvgText
                x={typicalLabelX} y={typicalLabelY}
                fontSize="12" fontWeight="500"
                fill={colors.textSecondary} textAnchor="middle"
              >
                {`usually ${roundWait(typicalWait)}m`}
              </SvgText>
            ) : null}

            {/* Current wait dot */}
            {dotX != null ? (
              <Circle cx={dotX} cy={TRACK_CY} r={7} fill={fillColor} stroke="white" strokeWidth={2} />
            ) : null}
          </Svg>
          {/* p10/p90 endpoint labels as native Text so they can't be SVG-clipped.
              Positioned to match LABEL_Y in the SVG coordinate space (y-scale is 1:1). */}
          <View style={styles.rangeLabelsRow}>
            <Text style={styles.rangeLabel}>{roundWait(p10)}m</Text>
            <Text style={styles.rangeLabel}>{roundWait(p90)}m</Text>
          </View>
          </>
        ) : null}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  rangeLabelsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    // LABEL_Y is the SVG baseline. y-scale is 1:1, so subtract cap-height (~11px)
    // to align the native text cap with the SVG label row.
    top: LABEL_Y - 11,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rangeLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
