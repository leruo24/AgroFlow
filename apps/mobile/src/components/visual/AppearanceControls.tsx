import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";

const KEY = "agroflow_simple_view";
let current = false;
const subscribers = new Set<(value: boolean) => void>();
const loaded = AsyncStorage.getItem(KEY)
  .then((value) => {
    current = value === "true";
    subscribers.forEach((fn) => fn(current));
  })
  .catch(() => undefined);
export function useSimpleView() {
  const [simple, setSimple] = useState(current);
  useEffect(() => {
    subscribers.add(setSimple);
    void loaded.then(() => setSimple(current));
    return () => {
      subscribers.delete(setSimple);
    };
  }, []);
  return {
    simple,
    setSimple: (value: boolean) => {
      current = value;
      subscribers.forEach((fn) => fn(value));
      void AsyncStorage.setItem(KEY, String(value)).catch(() => undefined);
    },
  };
}
export function SimpleViewControl() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { simple, setSimple } = useSimpleView();
  return (
    <View style={{ paddingVertical: 16, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Text style={{ color: colors.text, fontSize: 18, flex: 1 }}>
          {t("visual.simple")}
        </Text>
        <Switch
          accessibilityLabel={t("visual.simple")}
          value={simple}
          onValueChange={setSimple}
          trackColor={{ true: "#143D2A" }}
        />
      </View>
      <Text
        style={{ color: colors.textSecondary, fontSize: 16, lineHeight: 24 }}
      >
        {t("visual.simpleBody")}
      </Text>
    </View>
  );
}
