import Svg, { Circle, Path } from "react-native-svg";
// Decorative: farm identity and operational state always live in adjacent text.
export function FieldArtwork({
  color = "#143D2A",
  height = 90,
}: {
  color?: string;
  height?: number;
}) {
  return (
    <Svg
      testID="field-art"
      width="100%"
      height={height}
      viewBox="0 0 600 120"
      aria-hidden
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle cx="488" cy="28" r="20" fill={color} opacity={0.12} />
      <Path
        d="M0 80Q150 10 300 70T600 55M0 96Q150 26 300 86T600 71M0 112Q150 42 300 102T600 87"
        stroke={color}
        strokeWidth={2}
        fill="none"
        opacity={0.35}
      />
      <Path
        d="M160 75V40Q120 0 115 25q5 25 45 25 30-50 50-25-5 20-50 35"
        fill={color}
        opacity={0.45}
      />
    </Svg>
  );
}
