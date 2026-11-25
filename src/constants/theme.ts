import { useColorScheme } from '@/hooks/use-color-scheme';

// Colours follow the wireframes. The dark palette keeps contrast high for night-time use.
export const Palette = {
  light: {
    background: '#FFFFFF',
    surface: '#F4F5F7',
    text: '#1B1F24',
    muted: '#5B636D',
    border: '#D3D7DD',
    primary: '#0B5CAD',
    onPrimary: '#FFFFFF',
    primarySoft: '#E8F0FB',
    danger: '#B3221B',
    success: '#1E7B34',
    warn: '#8A4B00',
    warnSoft: '#FDF3E7',
  },
  dark: {
    background: '#0E1116',
    surface: '#171B22',
    text: '#ECEFF3',
    muted: '#A2AAB4',
    border: '#2E3540',
    primary: '#4C9BEF',
    onPrimary: '#0E1116',
    primarySoft: '#16283D',
    danger: '#E0574F',
    success: '#3DBA5E',
    warn: '#F2B061',
    warnSoft: '#2B2113',
  },
} as const;

export type Theme = { [K in keyof (typeof Palette)['light']]: string };

export function useTheme(): Theme {
  return Palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export const Space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

/** Minimum touch target (CLAUDE.md: at least 44 px; larger for gloves and one-handed use). */
export const TOUCH = 52;
