// Moved from apps/web-dashboard/src/pages/Dashboard.jsx
// Logic is unchanged from the original inline functions — only relocated
// out of the UI component and into the controllers tier, per the "no
// business logic in UI components" rule.

export type SimpleZone = {
  name: string;
  moisture: number;
  temp: number;
};

export type WeatherSnapshot = {
  weather?: { main?: string }[];
  main?: { humidity?: number };
  wind?: { speed?: number };
} | null;

export type IrrigationDecision = {
  name: string;
  predicted: number;
  pump: 'ON' | 'OFF';
  flow: 'NONE' | 'MEDIUM' | 'HIGH';
  reason: string;
};

/**
 * Decides pump/flow state per zone from current moisture + weather.
 * Moved verbatim from Dashboard.jsx's smartFarmEngine().
 */
export function smartFarmEngine(
  zones: SimpleZone[],
  weather: WeatherSnapshot
): IrrigationDecision[] {
  const rain = weather?.weather?.[0]?.main?.toLowerCase()?.includes('rain');
  const humidity = weather?.main?.humidity || 50;

  return zones.map((z) => {
    const drying = z.temp * 0.08 + (weather?.wind?.speed || 3) * 0.1 + 0.5;

    let predicted = z.moisture;

    if (rain) predicted += 5;
    if (humidity > 80) predicted += 3;

    predicted -= drying;

    predicted = Math.max(0, Math.min(100, predicted));

    let pump: IrrigationDecision['pump'] = 'OFF';
    let flow: IrrigationDecision['flow'] = 'NONE';
    let reason = 'Stable conditions';

    if (predicted < 30) {
      pump = 'ON';
      flow = 'HIGH';
      reason = 'Critical moisture forecast';
    } else if (predicted < 45) {
      pump = 'ON';
      flow = 'MEDIUM';
      reason = 'Preventive irrigation';
    }

    if (rain) {
      pump = 'OFF';
      flow = 'NONE';
      reason = 'Rain detected';
    }

    return {
      name: z.name,
      predicted,
      pump,
      flow,
      reason,
    };
  });
}

/**
 * Builds a short recent-events log from zone moisture levels.
 * Moved verbatim from Dashboard.jsx's generateHistory().
 */
export function generateHistory(zones: SimpleZone[]): string[] {
  const events: string[] = [];

  zones.forEach((z) => {
    if (z.moisture < 35) {
      events.push(`${z.name} - Critical moisture detected`);
    } else if (z.moisture < 45) {
      events.push(`${z.name} - Irrigation triggered`);
    }
  });

  events.push('System scan completed');
  return events.slice(-6);
}
