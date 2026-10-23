import { Image } from "react-native";
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <Image
      source={require("../../../assets/images/icon.png")}
      accessible={false}
      style={{ width: size, height: size }}
    />
  );
}
