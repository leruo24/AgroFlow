// Reusable modal sheet, matching the Webex reference (docs/ui_reference):
// the content behind is dimmed by a scrim, and the sheet itself sits on a
// solid surface with a bold left-aligned title and a top-right dismiss control.
//
// This previously used expo-blur for a frosted backdrop. That was removed: the
// blur layer crashed the app natively on startup in Expo Go (SDK 57) on both
// iOS and Android, with no JS error to catch. The scrim below is the permanent
// replacement - it needs no native module, behaves identically on every
// platform and Android API level, and costs nothing to composite. Do not
// reintroduce expo-blur here without re-testing a native startup crash.
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  X,
} from 'lucide-react-native';

import type {
  ReactNode,
} from 'react';

import {
  Modal,
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
  } = useTheme();

  const styles = createStyles(colors);
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
        {/* One token-based scrim, identical on every platform. */}
        <View style={[StyleSheet.absoluteFill, styles.scrim]} />

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
              style={styles.closeButton}
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

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    scrim: {
      backgroundColor: colors.scrim,
    },

    backdropPress: {
      flex: 1,
    },

    closeButton: {
      minWidth: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
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
