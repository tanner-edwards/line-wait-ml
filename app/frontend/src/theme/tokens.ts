// Design tokens — single source of truth for Club 32.
// Import from here in StyleSheet.create() calls, SVG fills, and gradients.
// Phase 1: colors, typography, spacing, radius, shadows.

export const colors = {
  // Brand
  brand:             '#4F46E5',
  brandPressed:      '#4338CA',
  gradientFrom:      '#0369A1',
  gradientTo:        '#7C3AED',

  // Surfaces
  bg:                '#F4F6FF',
  surface:           '#FFFFFF',

  // Text
  textPrimary:       '#0F0E30',
  textSecondary:     '#5A5880',
  textTertiary:      '#9896C0',
  textInverse:       '#FFFFFF',
  textInverseMuted:  'rgba(255,255,255,0.55)',

  // Status
  go:                '#059669',
  goBg:              'rgba(5,150,105,0.09)',
  skip:              '#DC2626',
  skipBg:            'rgba(220,38,38,0.09)',
  star:              '#F59E0B',
  starBg:            'rgba(245,158,11,0.12)',

  // Trend
  trendDown:         '#059669',
  trendUp:           '#DC2626',
  trendFlat:         '#9896C0',

  // Borders
  border:            'rgba(70,70,200,0.08)',
  borderStrong:      'rgba(70,70,200,0.14)',
} as const;

export const fonts = {
  display:          'Lora_700Bold',
  displaySemiBold:  'Lora_600SemiBold',
  ui:               'Outfit_400Regular',
  uiMedium:         'Outfit_500Medium',
  uiSemiBold:       'Outfit_600SemiBold',
  uiBold:           'Outfit_700Bold',
} as const;

export const typography = {
  screenTitle: {
    fontFamily: 'Lora_700Bold',
    fontSize: 27,
    fontWeight: '700' as const,
    letterSpacing: -0.54,
  },
  cardTitle: {
    fontFamily: 'Lora_600SemiBold',
    fontSize: 17,
    fontWeight: '600' as const,
    letterSpacing: -0.17,
  },
  waitNumber: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 24,
    fontWeight: '700' as const,
    letterSpacing: -0.72,
    fontVariant: ['tabular-nums'] as ['tabular-nums'],
  },
  body: {
    fontFamily: 'Outfit_400Regular',
    fontSize: 13.5,
    fontWeight: '400' as const,
    lineHeight: 21,
  },
  label: {
    fontFamily: 'Outfit_500Medium',
    fontSize: 12,
    fontWeight: '500' as const,
  },
  caption: {
    fontFamily: 'Outfit_500Medium',
    fontSize: 11,
    fontWeight: '500' as const,
  },
  badge: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 10.5,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.74,
  },
} as const;

export const spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  base: 16,
  lg:   20,
  xl:   24,
  xxl:  32,
  xxxl: 40,
} as const;

export const radius = {
  sm:    8,
  md:    12,
  card:  16,
  sheet: 24,
  pill:  9999,
} as const;

export const shadows = {
  card: {
    shadowColor:   '#1E1478',
    shadowOffset:  { width: 0, height: 2 },
    shadowRadius:  10,
    shadowOpacity: 0.08,
    elevation:     2,
  },
  sheet: {
    shadowColor:   '#140F50',
    shadowOffset:  { width: 0, height: -4 },
    shadowRadius:  24,
    shadowOpacity: 0.18,
    elevation:     12,
  },
} as const;
