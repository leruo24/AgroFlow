import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";
import { useI18n, type TranslationKey } from "@/i18n";
import { FieldArtwork } from "./FieldArtwork";
const topics: TranslationKey[] = [
  "visual.zone",
  "visual.soil",
  "visual.calibration",
  "visual.tank",
  "visual.drought",
];
export function FieldGuide() {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("visual.guide")}
        onPress={() => setOpen(true)}
        style={{ minHeight: 48, justifyContent: "center", padding: 8 }}
      >
        <Text style={{ color: colors.primaryDark, fontSize: 16 }}>
          {t("visual.guide")}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        onRequestClose={() => setOpen(false)}
        animationType="none"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            role="dialog"
            accessibilityLabel={t("visual.guide")}
            accessibilityViewIsModal
            style={{ flex: 1, padding: 16 }}
          >
            <Text
              accessibilityRole="header"
              style={{ fontSize: 28, color: colors.text, fontWeight: "600" }}
            >
              {t("visual.guide")}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <Text style={{ color: colors.primaryDark, fontSize: 18 }}>
                {t("common.back")}
              </Text>
            </Pressable>
            <ScrollView>
              <Text style={{ fontSize: 16, color: colors.textSecondary }}>
                {t("visual.guideBody")}
              </Text>
              {topics.map((topic) => (
                <View
                  key={topic}
                  style={{
                    padding: 16,
                    marginTop: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    backgroundColor: colors.surface,
                  }}
                >
                  <FieldArtwork color={colors.secondaryDark} />
                  <Text
                    style={{ color: colors.text, fontSize: 18, lineHeight: 28 }}
                  >
                    {t(topic)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}
