// Reusable frosted-glass sheet, matching the Webex reference (docs/ui_reference):
// content behind stays visible, blurred and dimmed; the sheet itself sits near-white
// with a bold left-aligned title and a top-right dismiss control.
//
// Android note: real-time blur is only cheap on Android 12+ (SDK 31+), which is
// where the OS gained the RenderNode API. Below that, the historical fallback is
// RenderScript - measurably slower, a real concern on whatever low-end phone a
// farmer owns. blurMethod="dimezisBlurViewSdk31Plus" sidesteps that entirely: fast
// native blur on 12+, and expo-blur's own graceful degrade to a plain semi-transparent
// view below that - never the slow path, never a broken opaque panel. iOS always gets
// real blur via UIVisualEffectView (effectively free, no perf concern there).
import {
  BlurView,
  BlurTargetView,
} from 'expo-blur';
import { createContext, useContext, useRef } from 'react';
import type { RefObject } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ChevronRight,
  X,
} from 'lucide-react-native';

import type {
  ReactNode,
} from 'react';

import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type {
  AppColors,
} from '@/constants/colors';

import { Type } from '@/constants/colors';

import {
  useTheme,
} from '@/context/ThemeContext';

const BlurTargetContext = createContext<RefObject<View | null> | undefined>(undefined);
export const FROSTED_BLUR_INTENSITY = 45;

export function useBlurTarget() {
  return useContext(BlurTargetContext);
}

export function BlurRoot({ children }: { children: ReactNode }) {
  const target = useRef<View | null>(null);
  return <BlurTargetContext.Provider value={target}>
    {Platform.OS === 'android' ? <BlurTargetView ref={target} style={{ flex: 1 }}>{children}</BlurTargetView> : <View style={{ flex: 1 }}>{children}</View>}
  </BlurTargetContext.Provider>;
}

type BlurSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  // Sheets vary a lot in content length (a two-row confirmation vs. a farm
  // picker list) - cap height as a fraction of the screen rather than
  // forcing every sheet to the same size.
  maxHeightRatio?: number;
};

export function BlurSheet({
  visible,
  onClose,
  title,
  children,
  maxHeightRatio = 0.82,
}: BlurSheetProps) {
  const {
    colors,
    isDark,
  } = useTheme();

  const styles = createStyles(colors);
  const target = useBlurTarget();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill}>
        {Platform.OS === 'web' ? (
          // BlurView.web renders its own backdrop-filter layer; a plain dim
          // behind it keeps contrast consistent with iOS/Android without
          // double-applying opacity.
          <View style={[StyleSheet.absoluteFill, styles.webDim]} />
        ) : null}

        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={FROSTED_BLUR_INTENSITY}
          blurTarget={target}
          tint={isDark ? 'dark' : 'light'}
          blurMethod={
            Platform.OS === 'android'
              ? 'dimezisBlurViewSdk31Plus'
              : undefined
          }
        />

        {/* Extra dim on top of the blur - the reference sheet's backdrop
            reads as darkened, not just softened, and this keeps that true
            even on the pre-Android-12 plain-tint fallback. */}
        <View style={[StyleSheet.absoluteFill, styles.dim]} />

        <Pressable
          style={styles.backdropPress}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />

        <View
          style={[
            styles.sheet,
            { maxHeight: `${Math.round(maxHeightRatio * 100)}%`, paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {title ?? ''}
            </Text>

            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={22} color={colors.textSecondary} strokeWidth={1.8} />
            </TouchableOpacity>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// A ready-made row for BlurSheet content, matching the list pattern already
// established on the home screen and propagated across the app: icon,
// label, chevron, hairline divider.
export function BlurSheetRow({
  label,
  onPress,
  selected,
  last,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  last?: boolean;
}) {
  const {
    colors,
  } = useTheme();

  const styles = createStyles(colors);

  return (
    <TouchableOpacity
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Text
        style={[
          styles.rowLabel,
          selected && { color: colors.primary, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>

      <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.8} />
    </TouchableOpacity>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    dim: {
      backgroundColor: 'rgba(0,0,0,0.22)',
    },

    webDim: {
      backgroundColor: 'rgba(0,0,0,0.18)',
    },

    backdropPress: {
      flex: 1,
    },

    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
      paddingBottom: 24,
      overflow: 'hidden',
    },

    header: {
      minHeight: 56,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },

    title: {
      flex: 1,
      fontSize: Type.title,
      fontWeight: '700',
      color: colors.text,
    },

    row: {
      minHeight: 52,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },

    rowLast: {
      borderBottomWidth: 0,
    },

    rowLabel: {
      fontSize: Type.body,
      color: colors.text,
    },
  });
}
