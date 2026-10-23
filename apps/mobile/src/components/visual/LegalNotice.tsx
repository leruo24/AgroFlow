import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
export function LegalNotice() {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={{ minHeight: 48, justifyContent: "center" }}
      >
        <Text style={{ color: colors.primaryDark, fontSize: 16 }}>
          {t("visual.legal")}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        onRequestClose={() => setOpen(false)}
        animationType="none"
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            role="dialog"
            accessibilityLabel={t("visual.legal")}
            accessibilityViewIsModal
            style={{ padding: 24, gap: 24 }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: colors.text, fontSize: 28 }}
            >
              {t("visual.legal")}
            </Text>
            <Text style={{ color: colors.text, fontSize: 20 }}>
              {t("visual.draft")}
            </Text>
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 18,
                lineHeight: 28,
              }}
            >
              {t("visual.pending")}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              style={{ minHeight: 48 }}
            >
              <Text style={{ color: colors.primaryDark, fontSize: 18 }}>
                {t("common.back")}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}
