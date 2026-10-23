import { Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import { FieldArtwork } from "./FieldArtwork";
export function FarmPostcard({ name }: { name: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View
      style={{
        backgroundColor: colors.surfaceSecondary,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        marginVertical: 16,
        overflow: "hidden",
      }}
    >
      <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
        {t("visual.farm")}
      </Text>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text,
          fontSize: 24,
          fontWeight: "600",
          marginTop: 8,
        }}
      >
        {name}
      </Text>
      <FieldArtwork color={colors.secondaryDark} height={48} />
    </View>
  );
}
