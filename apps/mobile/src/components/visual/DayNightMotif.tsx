import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "@/context/ThemeContext";
export function DayNightMotif() {
  const { colors, isDark } = useTheme();
  return (
    <Svg
      width={32}
      height={40}
      viewBox="0 0 32 40"
      aria-hidden
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d="M16 2C14 9 3 19 3 25a13 13 0 0026 0C29 19 18 9 16 2Z"
        stroke={colors.primaryDark}
        strokeWidth={2}
        fill="none"
      />
      <Circle cx={isDark ? 19 : 13} cy={25} r={7} fill={colors.textSecondary} />
      {isDark && <Circle cx={22} cy={22} r={7} fill={colors.background} />}
    </Svg>
  );
}
