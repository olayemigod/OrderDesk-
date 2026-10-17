export const sellerTrayTheme = {
  colors: {
    navy: '#102A43',
    navyDeep: '#0B2035',
    green: '#12B76A',
    greenDark: '#079455',
    mint: '#D9FBE8',
    mintSoft: '#ECFDF3',
    cloud: '#F8FAFC',
    white: '#FFFFFF',
    slate: '#475467',
    muted: '#667085',
    subtle: '#98A2B3',
    border: '#E4E7EC',
    danger: '#D92D20',
    dangerSoft: '#FEF3F2',
    warning: '#F79009',
    warningSoft: '#FFF6E5',
    info: '#1570EF',
    infoSoft: '#EFF8FF',
  },
  radius: {
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
    pill: 999,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 28,
  },
  shadow: {
    card: {
      shadowColor: '#102A43',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.07,
      shadowRadius: 18,
      elevation: 2,
    },
  },
} as const;

export type SellerTrayTheme = typeof sellerTrayTheme;
