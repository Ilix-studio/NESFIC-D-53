// Small shared UI kit (plain StyleSheet, no UI library). Large touch targets for outdoor,
// one-handed use; colours from the theme so it also works at night in dark mode.
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Space, TOUCH, useTheme } from '@/constants/theme';

export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.flex, { backgroundColor: t.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { borderTopColor: t.border }]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'small';

export function T({
  children,
  variant = 'body',
  color,
  style,
  ...rest
}: { children: ReactNode; variant?: TextVariant; color?: string; style?: StyleProp<TextStyle> } & Omit<ComponentProps<typeof Text>, 'style'>) {
  const t = useTheme();
  const muted = variant === 'label' || variant === 'small';
  return (
    <Text style={[styles[variant], { color: color ?? (muted ? t.muted : t.text) }, style]} {...rest}>
      {children}
    </Text>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const filled = { primary: t.primary, danger: t.danger, success: t.success, secondary: 'transparent' }[variant];
  const textColor = variant === 'secondary' ? t.text : t.onPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: filled, borderColor: variant === 'secondary' ? t.border : filled },
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      {loading ? <ActivityIndicator color={textColor} /> : <Text style={[styles.buttonText, { color: textColor }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({
  children,
  tone = 'default',
  onPress,
  style,
}: {
  children: ReactNode;
  tone?: 'default' | 'active' | 'dashed' | 'warn';
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const tones: Record<typeof tone, ViewStyle> = {
    default: { borderColor: t.border },
    active: { borderColor: t.primary, borderWidth: 2 },
    dashed: { borderColor: t.muted, borderStyle: 'dashed' },
    warn: { borderColor: t.warn, backgroundColor: t.warnSoft, borderWidth: 2 },
  };
  const toneStyle = tones[tone];
  const body = [styles.card, { backgroundColor: t.background }, toneStyle, style];
  if (!onPress) return <View style={body}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [...body, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export function Pill({ text, tone = 'warn' }: { text: string; tone?: 'warn' | 'ok' | 'muted' }) {
  const t = useTheme();
  const colors = {
    warn: { bg: t.warnSoft, fg: t.warn },
    ok: { bg: t.primarySoft, fg: t.success },
    muted: { bg: t.surface, fg: t.muted },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: colors.bg }]}>
      <Text style={[styles.pillText, { color: colors.fg }]}>{text}</Text>
    </View>
  );
}

export function ProgressBar({ percent, label = 'eDAR fields filled' }: { percent: number; label?: string }) {
  const t = useTheme();
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      style={styles.progress}>
      <View style={styles.row}>
        <T variant="heading" style={styles.flex}>
          {label}
        </T>
        <T variant="heading">{clamped}%</T>
      </View>
      <View style={[styles.track, { backgroundColor: t.surface }]}>
        <View style={[styles.fill, { width: `${Math.max(clamped, 2)}%`, backgroundColor: t.primary }]} />
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Space.md + 4, gap: Space.md },
  footer: { padding: Space.md + 4, gap: Space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  small: { fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: TOUCH,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: Space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 18, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  card: { borderWidth: 1.5, borderRadius: 14, padding: Space.md, gap: Space.xs },
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontSize: 14, fontWeight: '600' },
  progress: { gap: Space.sm },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
});
