// Fonts
export const FONTS = {
  mono: 'Menlo',
};

// Typography Scale - Centralized font sizes and styles
export const TYPOGRAPHY = {
  // Display / Hero numbers
  display: {
    fontSize: 22,
    fontFamily: FONTS.mono,
    fontWeight: '200' as const,
    letterSpacing: -0.5,
  },

  // Headings
  h1: {
    fontSize: 24,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 16,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: -0.2,
  },
  h3: {
    fontSize: 13,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: -0.2,
  },

  // Body text
  body: {
    fontSize: 14,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
  },
  bodySmall: {
    fontSize: 13,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
  },

  // Labels (whispers)
  label: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: 0.3,
  },
  labelSmall: {
    fontSize: 9,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: 0.3,
  },

  // Metadata / Details
  meta: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
  },
  metaSmall: {
    fontSize: 9,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
  },
};

// Spacing Scale - Consistent whitespace
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

// Onboarding slides
export const ONBOARDING_SLIDES = [
  {
    id: 'welcome',
    keyword: 'ELEBOOK',
    title: 'Elephant\nIdentification.',
    description: 'Identify individual elephants in the field for conservation research, using on-device AI. No connectivity required.',
  },
  {
    id: 'capture',
    keyword: 'CAPTURE',
    title: 'Snap a Photo.\nAI Finds the Elephant.',
    description: 'Take a photo in the field and our detector locates the elephant automatically, ready for matching.',
  },
  {
    id: 'review',
    keyword: 'REVIEW',
    title: 'Five Suggestions.\nYou Confirm.',
    description: 'Matching runs locally against your downloaded elephant pack. Review the top candidates, then a researcher confirms before it counts.',
  },
  {
    id: 'offline',
    keyword: 'OFFLINE',
    title: 'Built for\nthe Field.',
    description: 'Detection and matching run entirely on your device, no signal needed. Sync your observations whenever you have connectivity.',
  },
];
