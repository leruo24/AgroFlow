import { useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { useI18n } from "@/i18n";
import { useTheme } from "@/context/ThemeContext";
import { DataState } from "@/components/DataState";
import { FarmPostcard } from "./FarmPostcard";
import { TankIllustration } from "./TankIllustration";
import { FieldGuide } from "./FieldGuide";
import {
  HosepipeProgress,
  PresentationCard,
  StickyActionBar,
} from "./SetupPresentation";
import { LegalNotice } from "./LegalNotice";
import { COMMAND_PHASES, CommandPhaseLabel } from "./CommandPhaseLabel";
// Development/test-only specimen. Not mounted in the production route tree.
// The caller supplies every stage label; wire the now-published journey contract at merge.
export function VisualCatalogue({
  farmName,
  completed,
  installationStage,
}: {
  farmName: string;
  completed: number;
  installationStage: string;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [accepted, setAccepted] = useState(false);
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        backgroundColor: colors.background,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: colors.text, fontSize: 24 }}
      >
        {t("visual.simulated")}
      </Text>
      <FarmPostcard name={farmName} />
      <PresentationCard>
        {COMMAND_PHASES.map((phase) => (
          <CommandPhaseLabel key={phase} phase={phase} />
        ))}
      </PresentationCard>
      <PresentationCard>
        <HosepipeProgress
          completed={completed}
          installationStage={installationStage}
        />
      </PresentationCard>
      <PresentationCard>
        <Text style={{ color: colors.text, fontSize: 24 }}>
          {t("visual.before")}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 16 }}>
          {t("visual.pending")}
        </Text>
        <LegalNotice />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          onPress={() => setAccepted(!accepted)}
          style={{ minHeight: 48 }}
        >
          <Text style={{ color: colors.text, fontSize: 18 }}>
            {accepted ? "☑" : "☐"} {t("visual.accept")}
          </Text>
        </Pressable>
        <StickyActionBar
          onBack={() => setAccepted(false)}
          onContinue={() => undefined}
          disabled
        />
      </PresentationCard>
      {(["loading", "value", "empty", "stale", "error"] as const).map(
        (kind) => (
          <DataState key={kind} kind={kind} title={t(`visual.${kind}`)} />
        ),
      )}
      <TankIllustration litres={null} capacity={5000} />
      <TankIllustration litres={0} capacity={5000} />
      <TankIllustration litres={1200} capacity={5000} />
      <FieldGuide />
    </ScrollView>
  );
}
