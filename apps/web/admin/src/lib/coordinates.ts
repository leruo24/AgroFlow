export type Coordinates = { latitude: number; longitude: number };

const DECIMAL_PAIR = /^\s*([+-]?\d+(?:\.\d+)?)\s*[,;]\s*([+-]?\d+(?:\.\d+)?)\s*$/;
const DMS_PART = /^(\d{1,3})(?:°|\s)\s*(\d{1,2})(?:['′]|\s)\s*(\d{1,2}(?:\.\d+)?)(?:["″])?\s*([NSEW])$/i;

export function validCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function parseDmsPart(value: string, latitude: boolean): number | null {
  const match = value.trim().replace(/\s+/g, " ").match(DMS_PART);
  if (!match) return null;
  const degrees = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const direction = match[4].toUpperCase();
  if (minutes >= 60 || seconds >= 60) return null;
  if (latitude ? !["N", "S"].includes(direction) : !["E", "W"].includes(direction)) return null;
  const decimal = degrees + minutes / 60 + seconds / 3600;
  const signed = ["S", "W"].includes(direction) ? -decimal : decimal;
  return latitude
    ? (degrees <= 90 ? signed : null)
    : (degrees <= 180 ? signed : null);
}

/** Parses either "-25.037, 26.434" or a latitude/longitude DMS pair. */
export function parseCoordinatePair(value: string): Coordinates | null {
  const decimal = value.match(DECIMAL_PAIR);
  if (decimal) {
    const latitude = Number(decimal[1]);
    const longitude = Number(decimal[2]);
    return validCoordinates(latitude, longitude) ? { latitude, longitude } : null;
  }

  const normalised = value
    .replace(/[º˚]/g, "°")
    .replace(/[’']/g, "′")
    .replace(/[“”"]/g, "″")
    .trim();
  const divider = normalised.match(/^(.+?[NS])\s*[,;]?\s*(.+?[EW])$/i);
  if (!divider) return null;
  const latitude = parseDmsPart(divider[1], true);
  const longitude = parseDmsPart(divider[2], false);
  if (latitude === null || longitude === null || !validCoordinates(latitude, longitude)) return null;
  return { latitude, longitude };
}

function dms(value: number, latitude: boolean): string {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minuteFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minuteFloat);
  let seconds = Math.round((minuteFloat - minutes) * 60);
  let adjustedMinutes = minutes;
  let adjustedDegrees = degrees;
  if (seconds === 60) {
    seconds = 0;
    adjustedMinutes += 1;
  }
  if (adjustedMinutes === 60) {
    adjustedMinutes = 0;
    adjustedDegrees += 1;
  }
  const direction = latitude ? (value < 0 ? "S" : "N") : (value < 0 ? "W" : "E");
  return `${adjustedDegrees}° ${String(adjustedMinutes).padStart(2, "0")}′ ${String(seconds).padStart(2, "0")}″ ${direction}`;
}

export function formatDms(latitude: number, longitude: number): string {
  return `${dms(latitude, true)}, ${dms(longitude, false)}`;
}

export function formatDecimal(latitude: number, longitude: number, precision = 5): string {
  return `${latitude.toFixed(precision)}, ${longitude.toFixed(precision)}`;
}

/* South Africa, as the API checks it (AgroFlow.Domain LocationRules): a box around the country.
 * It only catches typing mistakes such as a swapped sign or latitude and longitude the wrong
 * way round; a few neighbouring places also fall inside it. */
export const SA_BOUNDS = { minLat: -35, maxLat: -22, minLon: 16, maxLon: 33 } as const;

export function insideSouthAfrica(latitude: number, longitude: number): boolean {
  return validCoordinates(latitude, longitude) &&
    latitude >= SA_BOUNDS.minLat && latitude <= SA_BOUNDS.maxLat &&
    longitude >= SA_BOUNDS.minLon && longitude <= SA_BOUNDS.maxLon;
}

export const OUTSIDE_SA = "That point is outside South Africa. Latitude is between -35 and -22, longitude between 16 and 33.";

export const PROVINCES = [
  "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
  "Mpumalanga", "North West", "Northern Cape", "Western Cape",
] as const;
