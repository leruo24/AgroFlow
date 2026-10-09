import type { Recommendation, ScenarioId } from "../data/scenarios";

export interface PlanDay {
  day: string;
  action: string;
  tone: "water" | "monitor" | "clear" | "rain";
}

const DAYS = ["TODAY", "FRI", "SAT", "SUN", "MON", "TUE", "WED"];

export function initialWeeklyPlan(scenario: ScenarioId): PlanDay[] {
  if (scenario === "HEAVY_RAIN") {
    return [
      { day: DAYS[0], action: "Monitor", tone: "monitor" },
      { day: DAYS[1], action: "Irrigation likely · 10 mm", tone: "water" },
      { day: DAYS[2], action: "Monitor", tone: "monitor" },
      { day: DAYS[3], action: "Reassess soil", tone: "monitor" },
      { day: DAYS[4], action: "Tentative", tone: "monitor" },
      { day: DAYS[5], action: "No irrigation", tone: "clear" },
      { day: DAYS[6], action: "Tentative", tone: "monitor" },
    ];
  }
  if (scenario === "SENSOR_DISAGREEMENT") {
    return [
      { day: DAYS[0], action: "Check field", tone: "monitor" },
      { day: DAYS[1], action: "Decision pending", tone: "monitor" },
      { day: DAYS[2], action: "Monitor", tone: "monitor" },
      { day: DAYS[3], action: "Tentative", tone: "monitor" },
      { day: DAYS[4], action: "No irrigation", tone: "clear" },
      { day: DAYS[5], action: "Tentative", tone: "monitor" },
      { day: DAYS[6], action: "Monitor", tone: "monitor" },
    ];
  }
  return [
    { day: DAYS[0], action: "Water today", tone: "water" },
    { day: DAYS[1], action: "No irrigation", tone: "clear" },
    { day: DAYS[2], action: "No irrigation", tone: "clear" },
    { day: DAYS[3], action: "Monitor", tone: "monitor" },
    { day: DAYS[4], action: "Rain expected", tone: "rain" },
    { day: DAYS[5], action: "No irrigation", tone: "clear" },
    { day: DAYS[6], action: "Tentative", tone: "monitor" },
  ];
}

export function completedWeeklyPlan(appliedLitres: number, recommendedLitres: number): PlanDay[] {
  const belowTarget = appliedLitres < recommendedLitres;
  return [
    { day: DAYS[0], action: `${appliedLitres.toLocaleString("en-US")} L applied`, tone: "clear" },
    { day: DAYS[1], action: belowTarget ? "Monitor deficit" : "No irrigation", tone: belowTarget ? "monitor" : "clear" },
    { day: DAYS[2], action: "No irrigation", tone: "clear" },
    { day: DAYS[3], action: "Monitor", tone: "monitor" },
    { day: DAYS[4], action: "Rain expected", tone: "rain" },
    { day: DAYS[5], action: "No irrigation", tone: "clear" },
    { day: DAYS[6], action: "Tentative", tone: "monitor" },
  ];
}

export function weatherUpdatedPlan(): PlanDay[] {
  return [
    { day: DAYS[0], action: "Cycle complete", tone: "clear" },
    { day: DAYS[1], action: "18 mm rain", tone: "rain" },
    { day: DAYS[2], action: "No irrigation", tone: "clear" },
    { day: DAYS[3], action: "Check soil", tone: "monitor" },
    { day: DAYS[4], action: "No irrigation", tone: "clear" },
    { day: DAYS[5], action: "Monitor", tone: "monitor" },
    { day: DAYS[6], action: "Tentative", tone: "monitor" },
  ];
}

export function rainScenarioUpdatedPlan(): PlanDay[] {
  return [
    { day: DAYS[0], action: "Monitor", tone: "monitor" },
    { day: DAYS[1], action: "18 mm rain", tone: "rain" },
    { day: DAYS[2], action: "No irrigation", tone: "clear" },
    { day: DAYS[3], action: "Reassess soil", tone: "monitor" },
    { day: DAYS[4], action: "No irrigation", tone: "clear" },
    { day: DAYS[5], action: "Monitor", tone: "monitor" },
    { day: DAYS[6], action: "Tentative", tone: "monitor" },
  ];
}

export function recommendationLabel(value: Recommendation): string {
  return {
    WATER_TODAY: "WATER TODAY",
    WAIT_FOR_RAIN: "WAIT FOR RAIN",
    CHECK_FIELD: "CHECK THE FIELD",
    MONITOR: "MONITOR",
  }[value];
}
