// Design tokens extracted from the Ankveda Figma file (section 1:2).

export const colors = {
  backgroundTop: '#300810',
  backgroundBottom: '#5b1022',
  card: '#601528',
  cardSoft: 'rgba(96, 21, 40, 0.2)',
  input: '#460e1c',
  border: '#9b6145',
  ringMuted: '#7e3441',
  gold: '#e9c783',
  goldLight: '#f9e4b2',
  goldDeep: '#dca951',
  cream: '#fff5e4',
  creamSoft: '#f8ebd6',
  muted: '#d7b9b6',
  onGold: '#350911',
  navBackground: '#2c0710',
  navActive: '#6e2030',
  progressTrack: '#7c3e49',
  glow: 'rgba(249, 228, 178, 0.25)',
  danger: '#ff9b8a',
} as const;

export const fonts = {
  serifMedium: 'CormorantGaramond_500Medium',
  serifMediumItalic: 'CormorantGaramond_500Medium_Italic',
  serifSemiBold: 'CormorantGaramond_600SemiBold',
  sansRegular: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemiBold: 'DMSans_600SemiBold',
  sansBold: 'DMSans_700Bold',
} as const;

export const radii = {
  input: 12,
  button: 16,
  card: 18,
  nav: 17,
  tab: 12,
  pill: 20,
} as const;

export const spacing = {
  gutter: 28,
  screenTop: 16,
} as const;

export const borderWidth = 0.7;

export const goldGradient = [colors.goldLight, colors.goldDeep] as const;
export const backgroundGradient = [colors.backgroundTop, colors.backgroundBottom] as const;
