import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";

// Pure props: never derive farmer-task completion from the legacy 17-step wizard.
export function HosepipeProgress({
  completed,
  installationStage,
  label,
  installationText,
}: {
  completed: number;
  installationStage: string;
  label?: string;
  installationText?: string;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const count = Math.max(0, Math.min(4, Math.floor(completed)));
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.text, fontSize: 18 }}>
        {label ?? t("visual.details", { count })}
      </Text>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label ?? t("visual.details", { count })}
        accessibilityValue={{ min: 0, max: 4, now: count }}
        style={{ flexDirection: "row", gap: 8 }}
      >
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            testID={index < count ? "hose-filled" : "hose-unfilled"}
            style={{
              height: 12,
              flex: 1,
              borderRadius: 6,
              backgroundColor:
                index < count ? colors.primaryDark : colors.surfaceSecondary,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          />
        ))}
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 16 }}>
        {installationText ??
          `${t("visual.installation")}: ${installationStage}`}
      </Text>
    </View>
  );
}
export function StickyActionBar({
  onBack,
  onContinue,
  saving = false,
  disabled = false,
}: {
  onBack: () => void;
  onContinue: () => void;
  saving?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderColor: colors.border,
          padding: 16,
          paddingBottom: Math.max(16, insets.bottom),
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          disabled={saving}
          style={{ padding: 16, minHeight: 48 }}
        >
          <Text style={{ color: colors.primaryDark, fontSize: 16 }}>
            {t("common.back")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || saving, busy: saving }}
          disabled={disabled || saving}
          onPress={onContinue}
          style={{
            flexGrow: 1,
            backgroundColor: "#143D2A",
            padding: 16,
            minHeight: 48,
            borderRadius: 12,
            opacity: disabled || saving ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 16, textAlign: "center" }}>
            {t(saving ? "common.saving" : "visual.continue")}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
export function PresentationCard({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        padding: 24,
        gap: 16,
        marginVertical: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
      }}
    >
      {children}
    </View>
  );
}
