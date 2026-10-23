import { Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
// Exact phase names from fix/audit-oct22 ui-contracts.md at 6fa2cff.
// This component presents a supplied server phase; it never infers one from timers.
export const COMMAND_PHASES = [
  "request_sent",
  "waiting_for_kit",
  "kit_confirmed_start",
  "finished",
  "stop_requested",
  "kit_confirmed_stop",
  "no_response",
  "failed",
] as const;
export type CommandPhase = (typeof COMMAND_PHASES)[number];
export function CommandPhaseLabel({
  phase,
  phaseLabel,
}: {
  phase: CommandPhase;
  phaseLabel?: string;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        padding: 16,
        borderWidth: 1,
        borderColor:
          phase === "failed" || phase === "no_response"
            ? colors.error
            : colors.border,
        borderRadius: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "600" }}>
        {phaseLabel ?? t(`visual.phase.${phase}`)}
      </Text>
    </View>
  );
}
