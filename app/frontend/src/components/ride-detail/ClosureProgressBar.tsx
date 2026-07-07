// Horizontal progress bar showing elapsed closure time relative to a
// predicted reopen estimate. Shares the same bubble / track geometry as
// TodaysRange — pill bubble with a downward pointer triangle sits above
// the fill's leading edge showing elapsed time (e.g. "25 min" / "1h 25m").
//
// When overflow is true the bar fills completely and the right label
// becomes "+X past Ym" in brick red (past-break state).

import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme/tokens';

// Shared geometry constants — identical to TodaysRange.tsx.
const TR_W = 360;
const HALF_BUBBLE = 22;
const BUBBLE_TOP_Y = 4;
const BUBBLE_H = 18;
const BUBBLE_BOTTOM_Y = BUBBLE_TOP_Y + BUBBLE_H;    // 22
const POINTER_H = 7;
const POINTER_TIP_Y = BUBBLE_BOTTOM_Y + POINTER_H;  // 29
const TRACK_TOP_Y = POINTER_TIP_Y + 2;              // 31
const TRACK_H = 8;
const TRACK_CY = TRACK_TOP_Y + TRACK_H / 2;         // 35
const TRACK_BOTTOM_Y = TRACK_TOP_Y + TRACK_H;       // 39
const LABEL_Y = TRACK_BOTTOM_Y + 16;                // 55
const TR_H = LABEL_Y + 10;                          // 65
const EDGE_PAD = 12;

interface Props {
  elapsedMinutes: number;
  rightEdgeMinutes: number;
  ghostTickMinutes?: number | null;
  fillColor: string;
  overflow: boolean;
}

function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function ClosureProgressBar({
  elapsedMinutes,
  rightEdgeMinutes,
  ghostTickMinutes,
  fillColor,
  overflow,
}: Props): React.ReactElement {
  const [renderW, setRenderW] = useState(0);

  const trackLeft = EDGE_PAD;
  const trackRight = TR_W - EDGE_PAD;
  const trackWidth = trackRight - trackLeft;

  const fraction = overflow ? 1 : Math.min(1, elapsedMinutes / rightEdgeMinutes);
  const fillRight = trackLeft + fraction * trackWidth;

  // Bubble center at the fill leading edge, nudged right when near the left edge.
  const MIN_BUBBLE_CX = trackLeft + HALF_BUBBLE + 4;
  const rawBubbleCx = fillRight;
  const bubbleCx = Math.max(MIN_BUBBLE_CX, rawBubbleCx);
  const bubbleLeft = bubbleCx - HALF_BUBBLE;

  // Pointer tip clamped to the bubble width so it never floats outside the pill.
  const pointerTipX = Math.max(bubbleLeft + 6, Math.min(bubbleLeft + HALF_BUBBLE * 2 - 6, fillRight));

  // Ghost tick — where the blip estimate falls on the 0→rightEdge scale.
  let ghostX: number | null = null;
  if (ghostTickMinutes != null && ghostTickMinutes > 0 && ghostTickMinutes < rightEdgeMinutes) {
    ghostX = trackLeft + (ghostTickMinutes / rightEdgeMinutes) * trackWidth;
  }

  const rightLabel = overflow
    ? `+${formatElapsed(elapsedMinutes - rightEdgeMinutes)} past ${rightEdgeMinutes}m`
    : `~${rightEdgeMinutes}m`;

  return (
    <View
      onLayout={e => setRenderW(Math.round(e.nativeEvent.layout.width))}
      style={{ marginTop: 14 }}
    >
      {renderW > 0 ? (
        <Svg
          width={renderW}
          height={TR_H}
          viewBox={`0 0 ${TR_W} ${TR_H}`}
          preserveAspectRatio="none"
        >
          {/* Track background */}
          <Rect
            x={trackLeft} y={TRACK_TOP_Y}
            width={trackWidth} height={TRACK_H}
            rx={TRACK_H / 2}
            fill={colors.border}
          />

          {/* Track fill */}
          {fillRight > trackLeft ? (
            <Rect
              x={trackLeft} y={TRACK_TOP_Y}
              width={fillRight - trackLeft} height={TRACK_H}
              rx={TRACK_H / 2}
              fill={fillColor}
            />
          ) : null}

          {/* Ghost tick — blip estimate position (white inside overflow fill, teal otherwise) */}
          {ghostX != null ? (
            <Line
              x1={ghostX} x2={ghostX}
              y1={TRACK_TOP_Y - 3} y2={TRACK_BOTTOM_Y + 3}
              stroke={overflow ? 'white' : colors.textTertiary}
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          ) : null}

          {/* Ghost tick label */}
          {ghostX != null && ghostTickMinutes != null ? (
            <SvgText
              x={ghostX} y={LABEL_Y}
              fontSize="11" fill={colors.textTertiary} textAnchor="middle"
            >
              {`est. ${ghostTickMinutes}m`}
            </SvgText>
          ) : null}

          {/* Left label */}
          <SvgText
            x={trackLeft} y={LABEL_Y}
            fontSize="11" fill={colors.textTertiary} textAnchor="start"
          >
            0
          </SvgText>

          {/* Right label — brick red when overflow, tertiary otherwise */}
          <SvgText
            x={trackRight} y={LABEL_Y}
            fontSize="11"
            fill={overflow ? colors.skip : colors.textTertiary}
            textAnchor="end"
          >
            {rightLabel}
          </SvgText>

          {/* Elapsed bubble */}
          <Rect
            x={bubbleLeft} y={BUBBLE_TOP_Y}
            width={HALF_BUBBLE * 2} height={BUBBLE_H}
            rx={BUBBLE_H / 2}
            fill={fillColor}
          />
          <Polygon
            points={`${bubbleCx - 5},${BUBBLE_BOTTOM_Y} ${bubbleCx + 5},${BUBBLE_BOTTOM_Y} ${pointerTipX},${POINTER_TIP_Y}`}
            fill={fillColor}
          />
          <SvgText
            x={bubbleCx} y={BUBBLE_TOP_Y + BUBBLE_H - 5}
            fontSize="11" fontWeight="700"
            fill="white" textAnchor="middle"
          >
            {formatElapsed(elapsedMinutes)}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}
