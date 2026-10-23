import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import { router } from "@/lib/router";
import { formatSast } from "@/lib/sastTime";
import type { JourneyState } from "@/hooks/useJourney";
// Settings → Terms & privacy. The documents' real version, date and status ("Draft – needs
// approval") and the farmer's recorded acceptance, both from the server's journey
// (docs/audit/ui-contracts.md §7). Accepted only shows after the server recorded it.
// Pure props, like the other visual components: Settings passes its useJourney() state.
export function LegalNotice({ journey }: { journey: JourneyState }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const { t } = useI18n();
  const terms = journey.journey?.terms ?? null;
  const acceptedAt = terms?.accepted.all
    ? formatSast(terms.accepted.termsAcceptedAt ?? terms.accepted.privacyAcceptedAt)
    : null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={{ minHeight: 48, justifyContent: "center" }}
        testID="legal-notice"
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
            {journey.status === "loading" ? (
              <Text style={{ color: colors.textSecondary, fontSize: 18 }} accessibilityLiveRegion="polite">
                {t("legal.loading")}
              </Text>
            ) : !terms ? (
              <Text style={{ color: colors.error, fontSize: 18 }} testID="legal-notice-failed">
                {t("legal.failed")}
              </Text>
            ) : (
              <>
                {terms.documents.map((doc) => (
                  <View key={doc.key} style={{ gap: 8 }} testID={`legal-notice-${doc.key}`}>
                    <Text style={{ color: colors.text, fontSize: 20 }}>{doc.title}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 16 }}>
                      {t("legal.version", { version: doc.version, date: doc.date })}
                    </Text>
                    {doc.status === "draft" ? (
                      <Text style={{ color: colors.warning, fontSize: 16 }}>{t("visual.draft")}</Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => { setOpen(false); router.push(`/legal?doc=${doc.key}` as never); }}
                      style={{ minHeight: 48, justifyContent: "center" }}
                    >
                      <Text style={{ color: colors.primaryDark, fontSize: 18 }}>
                        {t("legal.read", { title: doc.title })}
                      </Text>
                    </Pressable>
                  </View>
                ))}
                <Text
                  style={{ color: colors.textSecondary, fontSize: 18, lineHeight: 28 }}
                  testID="legal-notice-acceptance"
                >
                  {acceptedAt ? t("legal.acceptedOn", { date: acceptedAt }) : t("legal.notAccepted")}
                </Text>
              </>
            )}
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
