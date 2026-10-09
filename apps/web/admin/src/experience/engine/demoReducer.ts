import { SCENARIOS, type Recommendation, type ScenarioId } from "../data/scenarios";
import { completedWeeklyPlan, initialWeeklyPlan, rainScenarioUpdatedPlan, weatherUpdatedPlan, type PlanDay } from "./weeklyProjection";

export type DemoPhase =
  | "INTRO"
  | "READY"
  | "RECOMMENDATION"
  | "IRRIGATION_STARTING"
  | "IRRIGATING"
  | "IRRIGATION_COMPLETE"
  | "WEATHER_UPDATE"
  | "PLAN_RECALCULATING"
  | "RESULT";

export type CameraMode = "FIELD_OVERVIEW" | "RECOMMENDATION" | "CONTROLLER_FOCUS" | "IRRIGATION_RUNNING" | "FIELD_RESULT" | "WEATHER_EVENT";
export type ViewMode = "FIELD" | "ROOT_ZONE";

export interface DemoState {
  scenario: ScenarioId;
  phase: DemoPhase;
  controllerStatus: "ONLINE" | "MONITORING" | "ACTIVE";
  relayOn: boolean;
  pumpRunning: boolean;
  waterAppliedLitres: number;
  targetWaterLitres: number;
  selectedWaterLitres: number;
  relativeMoisture: number;
  rootZoneDepletionMm: number;
  rawMm: number;
  forecastRainMm: number;
  recommendation: Recommendation;
  weeklyPlan: PlanDay[];
  weatherAlert: string | null;
  sensorStatus: string;
  confidence: "high" | "medium";
  cameraMode: CameraMode;
  viewMode: ViewMode;
  whyOpen: boolean;
  adjustmentOpen: boolean;
  farmerDecision: "NONE" | "IRRIGATE" | "SKIP" | "POSTPONE" | "INSPECT";
  resultMessage: string | null;
}

export type DemoAction =
  | { type: "INTRO_COMPLETE" }
  | { type: "SHOW_RECOMMENDATION" }
  | { type: "SET_SCENARIO"; scenario: ScenarioId }
  | { type: "SET_VIEW"; view: ViewMode }
  | { type: "TOGGLE_WHY" }
  | { type: "TOGGLE_ADJUST" }
  | { type: "SET_TARGET"; litres: number }
  | { type: "START_IRRIGATION" }
  | { type: "CONTROLLER_READY" }
  | { type: "BEGIN_IRRIGATION" }
  | { type: "TICK"; progress: number }
  | { type: "WEATHER_CHANGED" }
  | { type: "RAIN_SCENARIO_UPDATE" }
  | { type: "FINISH_RECALCULATION" }
  | { type: "SKIP" }
  | { type: "POSTPONE" }
  | { type: "INSPECT" }
  | { type: "RESET" };

export function createInitialState(scenario: ScenarioId = "HOT_DRY"): DemoState {
  const definition = SCENARIOS[scenario];
  const initialMoisture = scenario === "SENSOR_DISAGREEMENT" ? 56 : scenario === "HEAVY_RAIN" ? 43 : 34;
  return {
    scenario,
    phase: "INTRO",
    controllerStatus: "ONLINE",
    relayOn: false,
    pumpRunning: false,
    waterAppliedLitres: 0,
    targetWaterLitres: definition.recommendedLitres,
    selectedWaterLitres: definition.recommendedLitres,
    relativeMoisture: initialMoisture,
    rootZoneDepletionMm: definition.depletionMm,
    rawMm: definition.rawMm,
    forecastRainMm: definition.forecastRainMm,
    recommendation: definition.recommendation,
    weeklyPlan: initialWeeklyPlan(scenario),
    weatherAlert: null,
    sensorStatus: definition.sensorStatus,
    confidence: definition.confidence,
    cameraMode: "FIELD_OVERVIEW",
    viewMode: "FIELD",
    whyOpen: false,
    adjustmentOpen: false,
    farmerDecision: "NONE",
    resultMessage: null,
  };
}

function safe(state: DemoState): DemoState {
  let next = state;
  if (next.phase !== "IRRIGATING" && (next.pumpRunning || next.relayOn)) {
    next = { ...next, pumpRunning: false, relayOn: false };
  }
  if (!next.pumpRunning && next.relayOn) next = { ...next, relayOn: false };
  if (next.recommendation !== "WATER_TODAY" && next.farmerDecision !== "IRRIGATE" && next.pumpRunning) {
    next = { ...next, pumpRunning: false, relayOn: false };
  }
  return next;
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "INTRO_COMPLETE":
      return safe({ ...state, phase: "READY", controllerStatus: "MONITORING" });
    case "SHOW_RECOMMENDATION":
      return safe({ ...state, phase: "RECOMMENDATION", cameraMode: "RECOMMENDATION" });
    case "SET_SCENARIO":
      return createInitialState(action.scenario);
    case "SET_VIEW":
      return safe({ ...state, viewMode: action.view });
    case "TOGGLE_WHY":
      return safe({ ...state, whyOpen: !state.whyOpen });
    case "TOGGLE_ADJUST":
      return safe({ ...state, adjustmentOpen: !state.adjustmentOpen });
    case "SET_TARGET": {
      const litres = Math.max(400, Math.min(2400, Math.round(action.litres / 100) * 100));
      return safe({ ...state, selectedWaterLitres: litres });
    }
    case "START_IRRIGATION":
      if (state.phase === "IRRIGATING" || state.phase === "IRRIGATION_STARTING") return state;
      return safe({
        ...state,
        phase: "IRRIGATION_STARTING",
        controllerStatus: "MONITORING",
        cameraMode: "CONTROLLER_FOCUS",
        farmerDecision: "IRRIGATE",
        whyOpen: false,
        adjustmentOpen: false,
        resultMessage: null,
      });
    case "CONTROLLER_READY":
      if (state.phase !== "IRRIGATION_STARTING") return state;
      return safe({ ...state, controllerStatus: "ACTIVE" });
    case "BEGIN_IRRIGATION":
      if (state.phase !== "IRRIGATION_STARTING") return state;
      return safe({ ...state, phase: "IRRIGATING", relayOn: true, pumpRunning: true, cameraMode: "IRRIGATION_RUNNING" });
    case "TICK": {
      if (state.phase !== "IRRIGATING") return state;
      const progress = Math.max(0, Math.min(1, action.progress));
      const waterAppliedLitres = Math.round(state.selectedWaterLitres * progress);
      const irrigationMm = waterAppliedLitres / 200;
      const rootZoneDepletionMm = Math.max(0, Number((SCENARIOS[state.scenario].depletionMm - irrigationMm).toFixed(1)));
      const relativeMoisture = Math.min(82, Math.round((state.scenario === "SENSOR_DISAGREEMENT" ? 56 : state.scenario === "HEAVY_RAIN" ? 43 : 34) + progress * 34));
      if (progress >= 1) {
        const recommended = SCENARIOS[state.scenario].recommendedLitres;
        const resultMessage = state.selectedWaterLitres < recommended
          ? `${state.selectedWaterLitres.toLocaleString("en-US")} L applied — below AgroFlow's recommended amount. A projected deficit remains.`
          : `${state.selectedWaterLitres.toLocaleString("en-US")} L applied. The field returns to monitoring.`;
        return safe({
          ...state,
          phase: "IRRIGATION_COMPLETE",
          relayOn: false,
          pumpRunning: false,
          controllerStatus: "MONITORING",
          cameraMode: "FIELD_RESULT",
          waterAppliedLitres: state.selectedWaterLitres,
          rootZoneDepletionMm,
          relativeMoisture,
          recommendation: rootZoneDepletionMm <= state.rawMm ? "MONITOR" : "WATER_TODAY",
          weeklyPlan: completedWeeklyPlan(state.selectedWaterLitres, recommended),
          resultMessage,
        });
      }
      return safe({ ...state, waterAppliedLitres, rootZoneDepletionMm, relativeMoisture });
    }
    case "WEATHER_CHANGED":
      if (state.scenario !== "HOT_DRY" || state.phase !== "IRRIGATION_COMPLETE") return state;
      return safe({
        ...state,
        phase: "PLAN_RECALCULATING",
        forecastRainMm: 18,
        weatherAlert: "18 mm of rain is now expected tomorrow. Your next planned irrigation has been delayed.",
        cameraMode: "WEATHER_EVENT",
      });
    case "RAIN_SCENARIO_UPDATE":
      if (state.scenario !== "HEAVY_RAIN" || state.recommendation === "WAIT_FOR_RAIN") return state;
      return safe({
        ...state,
        forecastRainMm: 18,
        recommendation: "WAIT_FOR_RAIN",
        weeklyPlan: rainScenarioUpdatedPlan(),
        weatherAlert: "18 mm of rain is now expected tomorrow. The likely 10 mm irrigation has been delayed.",
        cameraMode: "WEATHER_EVENT",
      });
    case "FINISH_RECALCULATION":
      return safe({
        ...state,
        phase: "RESULT",
        recommendation: "MONITOR",
        weeklyPlan: state.scenario === "HOT_DRY" ? weatherUpdatedPlan() : state.weeklyPlan,
        resultMessage: state.scenario === "HOT_DRY"
          ? `${state.resultMessage ? `${state.resultMessage} ` : ""}Expected rainfall is now sufficient to delay the next irrigation.`
          : state.resultMessage,
      });
    case "SKIP":
      return safe({
        ...state,
        phase: "RESULT",
        farmerDecision: "SKIP",
        cameraMode: "FIELD_RESULT",
        resultMessage: "Recommendation skipped. Projected root-zone depletion remains above the recommended threshold.",
      });
    case "POSTPONE":
      return safe({
        ...state,
        phase: "RESULT",
        farmerDecision: "POSTPONE",
        cameraMode: state.scenario === "HEAVY_RAIN" ? "WEATHER_EVENT" : "FIELD_RESULT",
        resultMessage: state.scenario === "HEAVY_RAIN"
          ? "Irrigation postponed. AgroFlow will monitor the forecast and field conditions."
          : "AgroFlow will continue monitoring conditions. The projected deficit may increase.",
      });
    case "INSPECT":
      return safe({
        ...state,
        phase: "RESULT",
        farmerDecision: "INSPECT",
        cameraMode: "FIELD_RESULT",
        resultMessage: "Field inspection selected. Compare several spots in the zone before deciding whether to irrigate.",
      });
    case "RESET":
      return createInitialState(state.scenario);
  }
}

export function stateIsValid(state: DemoState): boolean {
  if (state.relayOn && !state.pumpRunning) return false;
  if (state.pumpRunning && state.phase !== "IRRIGATING") return false;
  if (state.phase === "IRRIGATION_COMPLETE" && (state.relayOn || state.pumpRunning)) return false;
  if ((state.farmerDecision === "SKIP" || state.farmerDecision === "POSTPONE") && state.waterAppliedLitres > 0) return false;
  return true;
}
