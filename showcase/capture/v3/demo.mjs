// ILLUSTRATIVE DEMO DATA for the v3 showcase walkthrough capture.
//
// Nothing here is a production record. The real, unmodified AgroFlow apps run
// locally and these values are what their network calls receive. Farm names
// carry "(demo)", e-mail addresses use the reserved .invalid domain.
//
// Every number is worked out in scenario_calc.py with the engine's own
// formulas (SoilWaterBalance.cs, Fao56EngineReference.cs) and every sentence
// is the template the server uses (TodayRules.cs, Explanations.cs,
// ConfidenceRules.cs, ForecastOutlook.cs, ManualLogEndpoints.cs), filled with
// those numbers - so nothing on screen contradicts anything else.
//
// Tomato field: tomato, loam, 50 m2, 25 L/min, day 66 of 145.
//   ETo 5.8, Kc 1.09, ETc 6.4 mm, TAW 91 mm, p 0.35, RAW 31.5 mm, Dr 35 mm,
//   rain today 2 mm (< 6.4 mm crop use, so no skip) -> water.
//   35 mm x 50 m2 = 1750 L; 1750 / 25 = 70 min.

export const NOW = Date.now();
export const ago = (min) => new Date(NOW - min * 60000).toISOString();
export const sastDay = (d = 0) => new Date(NOW + 2 * 3600000 + d * 86400000).toISOString().slice(0, 10);
export const weekday = (d, style = 'long') => new Date(NOW + d * 86400000).toLocaleDateString('en-ZA', { weekday: style, timeZone: 'Africa/Johannesburg' });

export const FARMER_ID = '00000000-0000-0000-0000-000000000001';
export const ADMIN_ID = '00000000-0000-0000-0000-00000000a001';

export const farms = [
  { farm_id: 1, owner_id: FARMER_ID, owner_name: 'Smallholder Farmer (demo)', name: 'Green Valley (demo)', location: 'Stellenbosch, Western Cape', latitude: -33.93, longitude: 18.86, total_area: 1.2, status: 'Active' },
];

const zoneBase = { weather_adjustment: true, size_unit: 'm2', schedule_days: [], schedule_start_time: '06:00', schedule_duration_minutes: 15, schedule_enabled: false, status: 'Active', soil_type: 'loam', calibration_wet: 1200, calibration_dry: 3200 };
export const zones = [
  { ...zoneBase, id: 11, farm_id: 1, name: 'Tomato field', crop_type: 'tomato', location: 'North field', planting_date: sastDay(-66), irrigation_mode: 'manual', moisture_threshold: 35, desired_moisture: 60, health_status: 'Warning', size_value: 50, area_m2: 50, flow_rate_lpm: 25 },
  { ...zoneBase, id: 12, farm_id: 1, name: 'Spinach beds', crop_type: 'spinach', location: 'South beds', planting_date: sastDay(-24), irrigation_mode: 'manual', moisture_threshold: 30, desired_moisture: 55, health_status: 'Healthy', size_value: 30, area_m2: 30, flow_rate_lpm: 15 },
  { ...zoneBase, id: 13, farm_id: 1, name: 'Maize block', crop_type: 'maize', location: 'East field', planting_date: sastDay(-58), irrigation_mode: 'manual', moisture_threshold: 30, desired_moisture: 55, health_status: 'Healthy', size_value: 60, area_m2: 60, flow_rate_lpm: null },
];

export const readings = [
  // Resistive probe: raw counts, wet 1200 / dry 3200 -> 41%, 52%, 47% after the wet/dry setup.
  { zone_id: 11, moisture: 2380, temperature: 27, humidity: 41, last_reading_at: ago(1) },
  { zone_id: 12, moisture: 2160, temperature: 26, humidity: 44, last_reading_at: ago(1) },
  { zone_id: 13, moisture: 2260, temperature: 27, humidity: 42, last_reading_at: ago(2) },
];

export const baseEvents = [
  { id: 402, zone_id: 12, started_at: ago(60 * 26), runtime_seconds: 900, estimated_litres: 225, trigger_source: 'manual' },
  { id: 401, zone_id: 11, started_at: ago(60 * 24 * 4 + 120), runtime_seconds: 3600, estimated_litres: 1500, trigger_source: 'manual' },
];
// The farmer's own entry in the story: they water 1500 L, not the suggested 1750 L.
export const loggedEvent = { id: 403, zone_id: 11, started_at: ago(0), runtime_seconds: 0, estimated_litres: 1500, trigger_source: 'manual' };

// ---- explanations (Explanations.cs templates, filled from scenario_calc.py) ----
const F = (label, value, source) => ({ label, value, source });
export const whyWaterTomato = {
  summary: "Your soil has dried to the point where tomato starts to struggle, and the 2 mm of rain expected today won't cover it.",
  facts: [
    F('Crop', 'Tomato', "this zone's setup"),
    F('Crop stage', 'growing, day 66 of about 145', 'your planting date'),
    F('Soil', 'Loam / garden soil', "this zone's setup"),
    F('How dry the soil is', 'about 35 mm short of full', 'your soil sensor and weather app'),
    F('Watering point', 'about 31.5 mm short of full', 'FAO crop water guide'),
    F('Soil moisture', '41%', 'your soil sensor'),
    F('Watering level', '35', "this zone's setup"),
    F('Rain expected today', '2 mm', 'weather app'),
    F('Water your crop will use today', '6.4 mm', 'weather app and FAO crop water guide'),
    F('How much', 'about 70 min (about 1750 L)', "this zone's setup"),
  ],
  rule: 'We suggest watering once your crop has used about 35% of the water your soil can hold for it.',
  confidence: 'High: your sensor, setup and the weather all agree.',
  whatWouldChangeIt: 'If 6.4 mm of rain or more falls today, you can skip this.',
  technical: 'Dr 35 mm, RAW 31.5 mm, TAW 91 mm, p 0.35, Kc 1.09, ETo 5.8 mm, ETc 6.4 mm. FAO-56 Eq. 58 (p. 103), 82-85 (pp. 162-170). WaterRules.ShouldWaterToday (FAO-56 p. 171): Dr >= RAW.',
};
const setFacts = (flow) => [
  F('Crop', 'set', "this zone's setup"), F('Planting date', 'set', "this zone's setup"), F('Pump flow rate', flow ? 'set' : 'not set yet', "this zone's setup"),
  F('Zone size', 'set', "this zone's setup"), F('Soil type', 'set', "this zone's setup"), F('Sensor wet/dry setup', 'done', "this zone's setup"),
  F('Soil sensor', 'reporting', 'your kit'), F('Weather', 'available', 'weather app'),
];
const confRule = 'High needs every setup detail and a sensor reading from the last 24 hours. Medium is the weather and the crop with up to 2 details missing. Anything less is Low.';
export const confHigh = { level: 'high', reason: 'High: your sensor, setup and the weather all agree.' };
export const confHighWhy = { summary: confHigh.reason, facts: setFacts(true), rule: confRule, confidence: confHigh.reason, whatWouldChangeIt: 'Nothing - this zone is fully set up.', technical: 'ConfidenceRules.For / NextStep (DATA RULES).' };
export const confMaize = { level: 'medium', reason: "Medium: based on the weather; the pump's flow rate is missing." };
export const flowAsk = "Add the pump's flow rate to get watering times in minutes.";
export const confMaizeWhy = { summary: confMaize.reason, facts: setFacts(false), rule: confRule, confidence: confMaize.reason, whatWouldChangeIt: flowAsk, technical: 'ConfidenceRules.For / NextStep (DATA RULES).' };

// Spinach: next watering in 2 days (WaterSoon).
export const whySoonSpinach = {
  summary: 'At the rate spinach is using water, the soil will reach its watering point in about 2 days.',
  facts: [F('Expected watering day', `${weekday(2)} ${new Date(NOW + 2 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg' })}`, 'weather app'),
    F('Crop', 'Spinach', "this zone's setup"), F('Crop stage', 'growing, day 24 of about 60', 'your planting date'), F('Soil', 'Loam / garden soil', "this zone's setup"),
    F('How dry the soil is now', 'about 9 mm short of full', 'weather app')],
  rule: 'We look 2 days ahead using the weather forecast, so you can plan.',
  confidence: confHigh.reason,
  whatWouldChangeIt: `Rain before ${weekday(2)} would push this back.`,
  technical: 'Forecast projection of Eq. 85 to Dr >= RAW.',
};

// Maize: due today, litres only (no flow rate). 15 mm x 60 m2 = 900 L.
export const whyWaterMaize = {
  summary: "Your soil has dried to the point where maize starts to struggle, and the 2 mm of rain expected today won't cover it.",
  facts: [F('Crop', 'Maize', "this zone's setup"), F('Crop stage', 'growing, day 58 of about 140', 'your planting date'), F('Soil', 'Loam / garden soil', "this zone's setup"),
    F('Rain expected today', '2 mm', 'weather app')],
  rule: 'We suggest watering once your crop has used about 40% of the water your soil can hold for it.',
  confidence: confMaize.reason,
  whatWouldChangeIt: 'Rain today would make this unnecessary.',
  technical: 'WaterRules.ShouldWaterToday (FAO-56 p. 171): Dr >= RAW.',
};

const setupAll = { crop: true, plantingDate: true, soil: true, area: true, flowRate: true, calibrated: true, hasKit: true };
export const todayBefore = [
  { zoneId: 11, name: 'Tomato field', action: { kind: 'water', text: 'Water about 70 min this morning (about 1750 L)' }, why: whyWaterTomato, confidence: confHigh, confidenceExplanation: confHighWhy, nextStep: null, setup: setupAll },
  { zoneId: 12, name: 'Spinach beds', action: { kind: 'soon', text: `No watering today; next on ${weekday(2)}` }, why: whySoonSpinach, confidence: confHigh, confidenceExplanation: confHighWhy, nextStep: null, setup: setupAll },
  { zoneId: 13, name: 'Maize block', action: { kind: 'water', text: 'Water about 900 L this morning' }, why: whyWaterMaize, confidence: confMaize, confidenceExplanation: confMaizeWhy, nextStep: { field: 'flow_rate', ask: flowAsk }, setup: { ...setupAll, flowRate: false } },
];
// After the farmer logs 1500 L: Dr 35 - 30 = 5 mm, next watering projected 5 days out.
export const todayAfter = todayBefore.map((z) => z.zoneId === 11 ? { ...z, action: { kind: 'none', text: 'No watering needed today' }, why: null } : z);

export const insights = {
  11: [{ insightType: 'water_now', severity: 'act_now', message: 'Water Tomato field now: about 70 min (~1750 L).', explanation: whyWaterTomato }],
  12: [{ insightType: 'water_soon', severity: 'heads_up', message: `Spinach beds will need water in ~2 days (${weekday(2)}).`, explanation: whySoonSpinach }],
  13: [{ insightType: 'water_now', severity: 'act_now', message: 'Water Maize block now: about 900 L.', explanation: whyWaterMaize }],
};
export const growth = {
  11: { stage: 'Growing', dayOfSeason: 66, totalDays: 145, cropLabel: 'Tomato' },
  12: { stage: 'Growing', dayOfSeason: 24, totalDays: 60, cropLabel: 'Spinach' },
  13: { stage: 'Growing', dayOfSeason: 58, totalDays: 140, cropLabel: 'Maize' },
};

// ---- the week ahead (ForecastOutlook.cs: day 0 = engine, later days = rain-only) ----
// A: the dry week. B: the forecast after the weather update - 22 mm on day 2.
const base = [[13, 27, 2, 52, 'cloud'], [12, 28, 0, 40, 'sun'], [13, 29, 0, 38, 'sun'], [12, 27, 0, 44, 'sun'], [11, 26, 0, 46, 'sun'], [12, 27, 0, 42, 'sun'], [13, 28, 0, 40, 'sun']];
const rainB = { 2: [22, 88, 'rain', 18, 21], 3: [4, 79, 'rain', 12, 23] };
const dayAdvice = (i, rain) => (i === 0 ? 'Water likely needed' : rain >= 1 ? 'Rain should cover it' : 'Check the soil that morning');
export const forecast = (variant) => base.map(([mn, mx, rain, hum, icon], i) => {
  let r = rain, h = hum, ic = icon, lo = mn, hi = mx;
  if (variant === 'B' && rainB[i]) [r, h, ic, lo, hi] = rainB[i];
  return { date: sastDay(i), weekday: weekday(i, 'short'), minC: lo, maxC: hi, rainMm: r, humidityPercent: h, icon: ic, advice: dayAdvice(i, r) };
});

export const currentWeather = { current: { time: ago(10).slice(0, 16), temperature_2m: 26, apparent_temperature: 26, relative_humidity_2m: 41, weather_code: 2, wind_speed_10m: 12 }, daily: { precipitation_probability_max: [35] } };

// A kit that has gone quiet (KitRules.ZoneOfflineHours = 3; Explanations.ZoneOffline).
export const whyKitOffline = {
  summary: "Your kit hasn't sent a reading for 4.5 hours.",
  facts: [F('Last reading', '09:32 on 8 Oct', 'your kit'), F('Time since then', '4.5 hours', 'your kit')],
  rule: 'Kits normally report every 30 seconds. We call a kit offline after 3 hours with no reading.',
  confidence: 'High: this comes straight from your kit\'s own readings.',
  whatWouldChangeIt: 'It clears as soon as the kit sends a reading. Check it has power and WiFi.',
  technical: 'KitRules.IsOffline: 4.5 h >= 3 h (DATA RULE).',
};
export const todayKitOffline = todayBefore.map((z) => z.zoneId === 12 ? { ...z, action: { kind: 'kit', text: 'Check the kit: it has stopped sending readings' }, why: whyKitOffline,
  confidence: { level: 'medium', reason: "Medium: based on the weather; your kit hasn't sent data since 09:32 on 8 Oct." }, confidenceExplanation: confHighWhy } : z);
