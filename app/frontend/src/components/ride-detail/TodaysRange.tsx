// Horizontal range bar: |─●─| from p10 → p90 with the current wait as a
// dot + callout bubble above. A "typical for this slot" tick floats inside
// the track (or beside it when typical < p10), and a tagline below sums
// up how today compares to the usual.
//
// Layout is fixed at viewBox=360×TR_H and stretched with preserveAspectRatio
// so it scales to whatever container width it lives in.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme/tokens';

const MUTED = '#bbb'; // TODO: tokenize
const SUBINK = '#666'; // TODO: tokenize

// Geometry constants. All in the viewBox coordinate system.
const TR_W = 360;
const TR_PAD_X = 12;
const HALF_BUBBLE = 22;
const BUBBLE_TOP_Y = 4;
const BUBBLE_H = 18;
const BUBBLE_BOTTOM_Y = BUBBLE_TOP_Y + BUBBLE_H;
const POINTER_H = 7;
const POINTER_TIP_Y = BUBBLE_BOTTOM_Y + POINTER_H;
const TRACK_TOP_Y = POINTER_TIP_Y + 2;
const TRACK_H = 8;
const TRACK_CY = TRACK_TOP_Y + TRACK_H / 2;
const TRACK_BOTTOM_Y = TRACK_TOP_Y + TRACK_H;
const LABEL_Y = TRACK_BOTTOM_Y + 16;
const TR_H = LABEL_Y + 10;

function buildTagline(current: number | null, typical: number | null): string | null {
  if (current == null || typical == null) return null;
  const diff = Math.abs(Math.round(current - typical));
  if (diff <= 2) return 'Right around the usual wait for this time.';
  return current < typical
    ? `About ${diff} min less than usual right now.`
    : `About ${diff} min more than usual right now.`;
}

interface Props {
  p10: number;
  p90: number;
  current: number | null;
  typicalWait: number | null;
}

export function TodaysRange({
  p10,
  p90,
  current,
  typicalWait,
}: Props): React.ReactElement {
  const [renderW, setRenderW] = useState(0);

  const innerLeft = TR_PAD_X;
  const innerRight = TR_W - TR_PAD_X;
  const totalW = innerRight - innerLeft;
  const range = Math.max(1, p90 - p10);

  // Fill and dot use brand indigo — verdict lives in the header badge.
  const fillColor = '#4F46E5';

  // Current wait position (clamped to bar)
  const dotRatio = current != null
    ? Math.max(0, Math.min(1, (current - p10) / range))
    : null;
  const dotX = dotRatio != null ? innerLeft + dotRatio * totalW : null;

  // Bubble center — nudge away from edges so it doesn't clip
  const bubbleCx = dotX != null
    ? Math.max(innerLeft + HALF_BUBBLE, Math.min(innerRight - HALF_BUBBLE, dotX))
    : null;
  const bubbleLeft = bubbleCx != null ? bubbleCx - HALF_BUBBLE : null;

  // Typical marker — floats LEFT of track when typicalWait < p10 (below observed min).
  // When floating, render it as a React Native element beside the SVG so we don't
  // need negative SVG x-coordinates.
  const typicalIsFloating = typicalWait != null && typicalWait < p10;
  const typicalRatio = !typicalIsFloating && typicalWait != null
    ? Math.max(0, Math.min(1, (typicalWait - p10) / range))
    : null;
  const typicalX = typicalRatio != null ? innerLeft + typicalRatio * totalW : null;
  const typicalLabelX = typicalX != null
    ? Math.max(innerLeft + 28, Math.min(innerRight - 28, typicalX))
    : null;

  // Nudge the p10 endpoint label right when the floating marker is present
  // so they don't overlap.
  const p10LabelX = typicalIsFloating ? innerLeft + 22 : innerLeft;

  const tagline = buildTagline(current, typicalWait);

  return (
    <View>
      <View style={styles.rangeBarRow}>
        {typicalIsFloating ? (
          <View style={styles.floatingTypical}>
            <View style={styles.floatingTypicalLine} />
            <Text style={styles.floatingTypicalLabel}>{`usually ${typicalWait}m`}</Text>
          </View>
        ) : null}
        <View
          style={{ flex: 1 }}
          onLayout={e => setRenderW(Math.round(e.nativeEvent.layout.width))}
        >
          {renderW > 0 ? (
            <Svg
              width={renderW}
              height={TR_H}
              viewBox={`0 0 ${TR_W} ${TR_H}`}
              preserveAspectRatio="none"
            >
              <Rect
                x={innerLeft} y={TRACK_TOP_Y}
                width={totalW} height={TRACK_H}
                rx={TRACK_H / 2}
                fill={colors.border}
              />

              {dotX != null ? (
                <Rect
                  x={innerLeft} y={TRACK_TOP_Y}
                  width={Math.max(0, dotX - innerLeft)} height={TRACK_H}
                  rx={TRACK_H / 2}
                  fill={fillColor}
                />
              ) : null}

              {typicalX != null ? (
                <Line
                  x1={typicalX} x2={typicalX}
                  y1={TRACK_TOP_Y - 4} y2={TRACK_BOTTOM_Y + 4}
                  stroke={MUTED} strokeWidth={2}
                />
              ) : null}

              {typicalX != null && typicalLabelX != null && typicalWait != null ? (
                <SvgText
                  x={typicalLabelX} y={LABEL_Y}
                  fontSize="10.5" fontWeight="500"
                  fill={SUBINK} textAnchor="middle"
                >
                  {`usually ${typicalWait}m`}
                </SvgText>
              ) : null}

              <SvgText x={p10LabelX} y={LABEL_Y} fontSize="10.5" fill={MUTED} textAnchor="start">{p10}m</SvgText>
              <SvgText x={innerRight} y={LABEL_Y} fontSize="10.5" fill={MUTED} textAnchor="end">{p90}m</SvgText>

              {dotX != null ? (
                <Circle
                  cx={dotX} cy={TRACK_CY}
                  r={7} fill={fillColor}
                  stroke="white" strokeWidth={2}
                />
              ) : null}

              {dotX != null && bubbleLeft != null && bubbleCx != null && current != null ? (
                <>
                  <Rect
                    x={bubbleLeft} y={BUBBLE_TOP_Y}
                    width={HALF_BUBBLE * 2} height={BUBBLE_H}
                    rx={BUBBLE_H / 2}
                    fill={fillColor}
                  />
                  <Polygon
                    points={`${bubbleCx - 5},${BUBBLE_BOTTOM_Y} ${bubbleCx + 5},${BUBBLE_BOTTOM_Y} ${dotX},${POINTER_TIP_Y}`}
                    fill={fillColor}
                  />
                  <SvgText
                    x={bubbleCx} y={BUBBLE_TOP_Y + BUBBLE_H - 5}
                    fontSize="11" fontWeight="700"
                    fill="white" textAnchor="middle"
                  >
                    {`${current}m`}
                  </SvgText>
                </>
              ) : null}
            </Svg>
          ) : null}
        </View>
      </View>

      {tagline ? (
        <>
          <View style={styles.taglineDivider} />
          <Text style={styles.tagline}>{tagline}</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rangeBarRow: { flexDirection: 'row', alignItems: 'flex-start' },
  floatingTypical: {
    width: 44,
    paddingTop: TRACK_TOP_Y - 4,
    alignItems: 'center',
  },
  floatingTypicalLine: {
    width: 2,
    height: TRACK_H + 8,
    backgroundColor: MUTED,
    borderRadius: 2,
  },
  floatingTypicalLabel: {
    fontSize: 10.5,
    fontWeight: '500',
    color: SUBINK,
    marginTop: 4,
    textAlign: 'center',
  },
  taglineDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#eef', // TODO: tokenize
    marginTop: 10,
    marginBottom: 8,
  },
  tagline: { fontSize: 13, color: SUBINK, fontStyle: 'italic' },
});
