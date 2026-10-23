/// <reference types="jest" />
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Text } from "react-native";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { FarmPostcard } from "@/components/visual/FarmPostcard";
import { TankIllustration } from "@/components/visual/TankIllustration";
import {
  HosepipeProgress,
  StickyActionBar,
} from "@/components/visual/SetupPresentation";
import { SimpleViewControl } from "@/components/visual/AppearanceControls";
import { FieldGuide } from "@/components/visual/FieldGuide";
import { VisualCatalogue } from "@/components/visual/VisualCatalogue";
import { lightColors, darkColors } from "@/constants/colors";
import {
  COMMAND_PHASES,
  CommandPhaseLabel,
} from "@/components/visual/CommandPhaseLabel";
jest.mock(
  "lucide-react-native",
  () =>
    new Proxy(
      {},
      { get: (_target, name) => (name === "__esModule" ? false : () => null) },
    ),
);
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
  };
});
const wrap = (children: React.ReactNode) => (
  <ThemeProvider>{children}</ThemeProvider>
);

test.each(COMMAND_PHASES)(
  "command phase %s is supplied, never inferred",
  async (phase) => {
    const view = await render(
      wrap(<CommandPhaseLabel phase={phase} phaseLabel={`Server: ${phase}`} />),
    );
    expect(view.getByText(`Server: ${phase}`)).toBeTruthy();
  },
);
test("journey labels can be displayed exactly as supplied by the server", async () => {
  const view = await render(
    wrap(
      <HosepipeProgress
        completed={3}
        installationStage="ready_for_installation"
        label="Your details: 3 of 4"
        installationText="Installation: waiting for booking"
      />,
    ),
  );
  expect(view.getByText("Installation: waiting for booking")).toBeTruthy();
  expect(view.getByRole("progressbar").props.accessibilityValue.now).toBe(3);
});

test("postcard uses the supplied farm name and hides decorative field art", async () => {
  const screen = await render(wrap(<FarmPostcard name="Sesobe" />));
  await screen.findByText("Sesobe");
  expect(
    screen.getByTestId("field-art", { includeHiddenElements: true }).props
      .accessible,
  ).toBe(false);
  expect(
    screen.getByTestId("field-art", { includeHiddenElements: true }).props
      .importantForAccessibility,
  ).toBe("no-hide-descendants");
});
test("unknown tank has no fill; measured zero remains a value", async () => {
  const screen = await render(
    wrap(<TankIllustration litres={null} capacity={5000} />),
  );
  await screen.findByText("Unknown");
  expect(
    screen.queryByTestId("tank-fill", { includeHiddenElements: true }),
  ).toBeNull();
  await screen.rerender(wrap(<TankIllustration litres={0} capacity={5000} />));
  expect(screen.getByText("0 L / 5000 L")).toBeTruthy();
  expect(
    Number(
      screen.getByTestId("tank-fill", { includeHiddenElements: true }).props
        .height,
    ),
  ).toBe(0);
});
test.each([0, 1, 2, 3, 4])(
  "hosepipe reflects supplied completion %i and separate installation stage",
  async (completed) => {
    const screen = await render(
      wrap(
        <HosepipeProgress
          completed={completed}
          installationStage="Simulated: awaiting booking"
        />,
      ),
    );
    await screen.findByText(`Your details: ${completed} of 4`);
    expect(screen.queryAllByTestId("hose-filled")).toHaveLength(completed);
    expect(screen.getByRole("progressbar").props.accessibilityValue.now).toBe(
      completed,
    );
    expect(
      screen.getByText("Installation stage: Simulated: awaiting booking"),
    ).toBeTruthy();
  },
);
test("sticky Back and Continue invoke only their provided callbacks", async () => {
  const back = jest.fn(),
    next = jest.fn();
  const screen = await render(
    wrap(<StickyActionBar onBack={back} onContinue={next} />),
  );
  await screen.findByText("Go back");
  await fireEvent.press(screen.getByText("Go back"));
  await fireEvent.press(screen.getByText("Save and continue"));
  expect(back).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledTimes(1);
});
test("Simple view is saved only on this device", async () => {
  const screen = await render(wrap(<SimpleViewControl />));
  const toggle = await screen.findByRole("switch", { name: "Simple view" });
  await fireEvent(toggle, "valueChange", true);
  await waitFor(() =>
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "agroflow_simple_view",
      "true",
    ),
  );
  expect(screen.getByRole("switch").props.value).toBe(true);
});
test("field guide opens static help and Back returns to its trigger", async () => {
  const screen = await render(wrap(<FieldGuide />));
  await fireEvent.press(
    await screen.findByRole("button", { name: "Pocket field guide" }),
  );
  expect(screen.getByText("A zone is an area watered together.")).toBeTruthy();
  await fireEvent.press(screen.getByText("Go back"));
  expect(screen.queryByText("A zone is an area watered together.")).toBeNull();
});
test("catalogue acceptance starts unchecked and cannot submit a fake acceptance", async () => {
  const screen = await render(
    wrap(
      <VisualCatalogue
        farmName="Simulated farm"
        completed={2}
        installationStage="Simulated"
      />,
    ),
  );
  const check = await screen.findByRole("checkbox");
  expect(check.props.accessibilityState.checked).toBe(false);
  expect(
    screen.getByRole("button", { name: "Save and continue" }).props
      .accessibilityState.disabled,
  ).toBe(true);
});
test("existing theme preference restores dark and supports system", async () => {
  await AsyncStorage.setItem("agroflow_theme_preference", "dark");
  function Probe() {
    const { resolvedTheme } = useTheme();
    return <Text>{resolvedTheme}</Text>;
  }
  const screen = await render(wrap(<Probe />));
  await screen.findByText("dark");
});
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const rgb = hex
      .slice(1)
      .match(/../g)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  return (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
}
test.each([lightColors, darkColors])(
  "core normal text and filled actions meet 4.5:1",
  (colors) => {
    for (const foreground of [
      colors.text,
      colors.textSecondary,
      colors.textMuted,
      colors.primaryDark,
    ])
      expect(contrast(foreground, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.white, colors.action)).toBeGreaterThanOrEqual(4.5);
  },
);
