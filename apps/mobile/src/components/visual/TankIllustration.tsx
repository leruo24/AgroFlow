import { Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
// Unknown has no fill. A real zero and an unavailable value stay distinct.
export function TankIllustration({
  litres,
  capacity,
}: {
  litres: number | null | undefined;
  capacity: number | null | undefined;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const known =
    litres != null &&
    Number.isFinite(litres) &&
    litres >= 0 &&
    capacity != null &&
    Number.isFinite(capacity) &&
    capacity > 0;
  const fill = known ? Math.min(1, litres / capacity) : null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        paddingVertical: 16,
      }}
    >
      <Svg
        width={72}
        height={88}
        viewBox="0 0 72 88"
        aria-hidden
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {fill !== null && (
          <Rect
            testID="tank-fill"
            x={9}
            y={77 - 64 * fill}
            width={54}
            height={64 * fill}
            fill={colors.primaryDark}
            opacity={0.4}
          />
        )}
        <Rect
          x={8}
          y={12}
          width={56}
          height={66}
          rx={8}
          stroke={colors.textSecondary}
          strokeWidth={2}
          fill="none"
        />
        <Rect
          x={25}
          y={5}
          width={22}
          height={7}
          rx={2}
          fill={colors.textSecondary}
        />
      </Svg>
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: "600" }}>
          {known
            ? `${Math.round(litres)} L / ${Math.round(capacity)} L`
            : t("visual.unknown")}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 16 }}>
          {t("visual.estimate")}
        </Text>
      </View>
    </View>
  );
}
