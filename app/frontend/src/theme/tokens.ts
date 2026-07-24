// Design tokens — single source of truth for Club 32.
// Import from here in StyleSheet.create() calls, SVG fills, and gradients.
//
// Palette: warm forest green ("country club"). Migrated from blue/purple
// June 2026. Header is now FLAT (gradientFrom === gradientTo), and bar
// neutrals stay blue-gray lavender (still works across the warm palette).

export const colors = {
  // Brand — deep forest teal for buttons, dots, watching state
  brand:             '#0A6B5A',
  brandPressed:      '#085647',
  // Header gradient — flat solid (both stops same value)
  gradientFrom:      '#3D7C65',
  gradientTo:        '#3D7C65',

  // Surfaces
  bg:                '#F2EDE0',  // cream, behind white cards
  surface:           '#FFFFFF',

  // Text — forest-toned grays
  textPrimary:       '#1A3530',
  textSecondary:     '#5C6E68',
  textTertiary:      '#8A9E98',
  textInverse:       '#FFFFFF',
  textInverseMuted:  'rgba(255,255,255,0.55)',

  // Status — verdict colors (badges, alerts, range bar fills)
  go:                '#3D7C65',  // unified with header — single green
  goBg:              'rgba(61,124,101,0.10)',
  goBorder:          'rgba(61,124,101,0.25)',

  // Opportunity card (State 7 hero sub-card) — same RGB family as go,
  // but distinct opacity steps so it reads as "quieter than a badge".
  opportunityCardBg:     'rgba(61,124,101,0.07)',
  opportunityCardBorder: 'rgba(61,124,101,0.22)',
  opportunityCardText:   '#2D6B54',

  skip:              '#B83A2A',  // brick red, complements green + gold
  skipBg:            'rgba(184,58,42,0.09)',
  skipBorder:        'rgba(184,58,42,0.25)',
  caution:           '#C96B1A',  // orange — 4th badge state, between go and skip
  cautionBg:         'rgba(138,158,152,0.14)',  // neutral gray, distinct from all other badge bgs
  star:              '#C9941D',  // deeper amber gold, reserved for star
  starBg:            'rgba(201,148,29,0.12)',
  starBorder:        'rgba(201,148,29,0.25)',

  // Trend direction — NEUTRAL gray everywhere. The arrow shape and label
  // carry the meaning; color was creating contradictory signals (green
  // wait paired with red "Rising" arrow). textTertiary for the active
  // states, trendFlat (one step lighter) for the least-actionable Steady.
  trendDown:         '#8A9E98',  // ≡ textTertiary
  trendUp:           '#8A9E98',  // ≡ textTertiary
  trendFlat:         '#C8CADD',  // one step lighter — Steady reads as quiet

  // Forecast bars (FullDayForecast). Neutral stays blue-gray lavender —
  // works visually against both the old and new palette.
  barNeutral:        '#8A8FA8',
  barNeutralPast:    '#BDC0CE',
  barPeak:           '#B83A2A',
  barPeakPast:       'rgba(184,58,42,0.28)',
  barTrough:         '#3D7C65',
  barTroughPast:     'rgba(61,124,101,0.32)',

  // Borders — teal-tinted at low opacity
  border:            'rgba(10,107,90,0.09)',
  borderStrong:      'rgba(10,107,90,0.20)',
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

// Shadow tint matches the new brand green. Distances and blur unchanged
// per the migration spec — only the color shifts.
export const shadows = {
  card: {
    shadowColor:   '#0A6B5A',
    shadowOffset:  { width: 0, height: 2 },
    shadowRadius:  10,
    shadowOpacity: 0.06,
    elevation:     2,
  },
  sheet: {
    shadowColor:   '#0A6B5A',
    shadowOffset:  { width: 0, height: -4 },
    shadowRadius:  24,
    shadowOpacity: 0.14,
    elevation:     12,
  },
} as const;
