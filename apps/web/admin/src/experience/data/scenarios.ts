export type ScenarioId = "HOT_DRY" | "HEAVY_RAIN" | "SENSOR_DISAGREEMENT";

export type Recommendation = "WATER_TODAY" | "WAIT_FOR_RAIN" | "CHECK_FIELD" | "MONITOR";

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  weather: string;
  etoMm: number;
  kc: number;
  etcMm: number;
  rawMm: number;
  depletionMm: number;
  forecastRainMm: number;
  recommendation: Recommendation;
  recommendedLitres: number;
  sensorStatus: string;
  confidence: "high" | "medium";
  reason: string;
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  HOT_DRY: {
    id: "HOT_DRY",
    label: "Hot & dry",
    weather: "Hot and dry",
    etoMm: 5.8,
    kc: 1.1,
    etcMm: 6.4,
    rawMm: 28,
    depletionMm: 35,
    forecastRainMm: 2,
    recommendation: "WATER_TODAY",
    recommendedLitres: 1600,
    sensorStatus: "Fresh · relatively dry",
    confidence: "high",
    reason: "Root-zone depletion is above the recommended irrigation threshold and expected rain is not enough to cover the deficit.",
  },
  HEAVY_RAIN: {
    id: "HEAVY_RAIN",
    label: "Heavy rain incoming",
    weather: "Rain approaching",
    etoMm: 4.9,
    kc: 1.1,
    etcMm: 5.4,
    rawMm: 28,
    depletionMm: 31,
    forecastRainMm: 3,
    recommendation: "MONITOR",
    recommendedLitres: 2000,
    sensorStatus: "Fresh · moderately dry",
    confidence: "high",
    reason: "Significant rain is expected tomorrow, so AgroFlow recommends delaying the next irrigation and monitoring the forecast.",
  },
  SENSOR_DISAGREEMENT: {
    id: "SENSOR_DISAGREEMENT",
    label: "Sensor disagreement",
    weather: "Warm and clear",
    etoMm: 5.3,
    kc: 1.1,
    etcMm: 5.8,
    rawMm: 28,
    depletionMm: 32,
    forecastRainMm: 1,
    recommendation: "CHECK_FIELD",
    recommendedLitres: 1400,
    sensorStatus: "Fresh · wetter locally",
    confidence: "medium",
    reason: "The field sensor indicates wetter local conditions than the weather-based estimate. Check the zone before irrigating.",
  },
};
