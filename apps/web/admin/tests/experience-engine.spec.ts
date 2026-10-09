import { expect, test } from "@playwright/test";
import { createInitialState, demoReducer, stateIsValid, type DemoState } from "../src/experience/engine/demoReducer";

function ready(scenario: "HOT_DRY" | "HEAVY_RAIN" | "SENSOR_DISAGREEMENT" = "HOT_DRY") {
  return demoReducer(demoReducer(createInitialState(scenario), { type: "INTRO_COMPLETE" }), { type: "SHOW_RECOMMENDATION" });
}

function running(state = ready()) {
  return demoReducer(demoReducer(state, { type: "START_IRRIGATION" }), { type: "BEGIN_IRRIGATION" });
}

test.describe("Experience AgroFlow state machine", () => {
  test("hot and dry initial state is internally consistent", () => {
    const state = createInitialState();
    expect(state.scenario).toBe("HOT_DRY");
    expect(state.recommendation).toBe("WATER_TODAY");
    expect(state.rootZoneDepletionMm).toBe(35);
    expect(state.rawMm).toBe(28);
    expect(state.selectedWaterLitres).toBe(1600);
    expect(stateIsValid(state)).toBe(true);
  });

  test("irrigation starts only through the starting phase and keeps pump and relay consistent", () => {
    const starting = demoReducer(ready(), { type: "START_IRRIGATION" });
    expect(starting.phase).toBe("IRRIGATION_STARTING");
    expect(starting.pumpRunning).toBe(false);
    expect(starting.relayOn).toBe(false);
    expect(starting.controllerStatus).toBe("MONITORING");
    const controllerReady = demoReducer(starting, { type: "CONTROLLER_READY" });
    expect(controllerReady.controllerStatus).toBe("ACTIVE");
    expect(controllerReady.pumpRunning).toBe(false);
    const active = demoReducer(controllerReady, { type: "BEGIN_IRRIGATION" });
    expect(active.phase).toBe("IRRIGATING");
    expect(active.pumpRunning).toBe(true);
    expect(active.relayOn).toBe(true);
    expect(stateIsValid(active)).toBe(true);
  });

  test("water and moisture rise while depletion falls", () => {
    const before = running();
    const after = demoReducer(before, { type: "TICK", progress: 0.5 });
    expect(after.waterAppliedLitres).toBe(800);
    expect(after.relativeMoisture).toBeGreaterThan(before.relativeMoisture);
    expect(after.rootZoneDepletionMm).toBeLessThan(before.rootZoneDepletionMm);
  });

  test("completion stops equipment and updates recommendation and weekly plan", () => {
    const before = running();
    const after = demoReducer(before, { type: "TICK", progress: 1 });
    expect(after.phase).toBe("IRRIGATION_COMPLETE");
    expect(after.waterAppliedLitres).toBe(1600);
    expect(after.pumpRunning).toBe(false);
    expect(after.relayOn).toBe(false);
    expect(after.recommendation).toBe("MONITOR");
    expect(after.weeklyPlan[0]?.action).toContain("1,600 L applied");
    expect(stateIsValid(after)).toBe(true);
  });

  test("forecast change delays the next irrigation and updates the carried-forward plan", () => {
    const complete = demoReducer(running(), { type: "TICK", progress: 1 });
    const updating = demoReducer(complete, { type: "WEATHER_CHANGED" });
    expect(updating.forecastRainMm).toBe(18);
    expect(updating.phase).toBe("PLAN_RECALCULATING");
    const result = demoReducer(updating, { type: "FINISH_RECALCULATION" });
    expect(result.recommendation).toBe("MONITOR");
    expect(result.weeklyPlan[1]?.action).toBe("18 mm rain");
  });

  test("rain forecast changes the likely irrigation decision", () => {
    const rain = createInitialState("HEAVY_RAIN");
    expect(rain.recommendation).toBe("MONITOR");
    expect(rain.forecastRainMm).toBe(3);
    expect(rain.weeklyPlan[1]?.action).toContain("10 mm");
    const updated = demoReducer(rain, { type: "RAIN_SCENARIO_UPDATE" });
    expect(updated.recommendation).toBe("WAIT_FOR_RAIN");
    expect(updated.forecastRainMm).toBe(18);
    expect(updated.weeklyPlan[1]?.action).toBe("18 mm rain");
  });

  test("sensor disagreement begins with a field-check decision", () => {
    const sensor = createInitialState("SENSOR_DISAGREEMENT");
    expect(sensor.recommendation).toBe("CHECK_FIELD");
    expect(sensor.confidence).toBe("medium");
  });

  test("skip and postpone never start equipment or add water", () => {
    for (const action of [{ type: "SKIP" as const }, { type: "POSTPONE" as const }]) {
      const result = demoReducer(ready(), action);
      expect(result.waterAppliedLitres).toBe(0);
      expect(result.pumpRunning).toBe(false);
      expect(result.relayOn).toBe(false);
      expect(stateIsValid(result)).toBe(true);
    }
  });

  test("farmer adjustment is the exact completion target", () => {
    let state = demoReducer(ready(), { type: "SET_TARGET", litres: 1200 });
    state = running(state);
    state = demoReducer(state, { type: "TICK", progress: 1 });
    expect(state.waterAppliedLitres).toBe(1200);
    expect(state.resultMessage).toContain("below AgroFlow's recommended amount");
    expect(state.rootZoneDepletionMm).toBe(29);
  });

  test("reset restores the selected scenario", () => {
    let state = ready("HEAVY_RAIN");
    state = demoReducer(state, { type: "START_IRRIGATION" });
    state = demoReducer(state, { type: "BEGIN_IRRIGATION" });
    state = demoReducer(state, { type: "TICK", progress: 0.4 });
    state = demoReducer(state, { type: "RESET" });
    expect(state).toEqual(createInitialState("HEAVY_RAIN"));
  });

  test("ordinary transitions repair impossible pump and relay combinations", () => {
    const corrupt: DemoState = { ...ready(), phase: "RESULT", pumpRunning: true, relayOn: true };
    expect(stateIsValid(corrupt)).toBe(false);
    const repaired = demoReducer(corrupt, { type: "SET_VIEW", view: "ROOT_ZONE" });
    expect(repaired.pumpRunning).toBe(false);
    expect(repaired.relayOn).toBe(false);
    expect(stateIsValid(repaired)).toBe(true);
  });
});
