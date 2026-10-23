// Reusable modal sheet (see docs/ui_reference): a scrim dims the content behind, and the
// sheet has a solid surface, a bold left-aligned title and a top-right close control.
// Do not add expo-blur here: its blur layer crashed the app natively on startup in Expo
// Go (SDK 57) on iOS and Android with no JS error. The scrim needs no native module and
// looks the same everywhere.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';

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

import { Type, Space } from '@/constants/colors';

import {
  useTheme,
} from '@/context/ThemeContext';

type BlurSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  // Sheets vary a lot in length (a two-row confirmation vs a farm list), so the height is
  // capped as a fraction of the screen.
  maxHeightRatio?: number;
};

export function BlurSheet({
  visible,
  onClose,
  title,
  children,
  maxHeightRatio = 0.82,
}: BlurSheetProps) {
  const { t } = useI18n();
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
          accessibilityLabel={t('visual.dismiss')}
        />

        <View
          role="dialog"
          accessibilityLabel={title}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { maxHeight: `${Math.round(maxHeightRatio * 100)}%`, paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          <View style={styles.header}>
            {/* The title wraps: "How does the soil feel? Spinach bed" must never be cut off. */}
            <Text style={styles.title} accessibilityRole="header">
              {title ?? ''}
            </Text>

            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={t('visual.close')}
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
      paddingBottom: Space.xl,
      overflow: 'hidden',
    },

    header: {
      minHeight: 56,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.sm,
      gap: Space.sm,
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
      paddingHorizontal: Space.lg,
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
