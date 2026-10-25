/* Static lookup lists: option sets for filters and forms, not stand-ins for real records.
 * There is no "provinces" table and there should not be one; this is just the valid value
 * set for a dropdown. */

export const PROVINCES = [
  "Western Cape", "Eastern Cape", "Gauteng", "KwaZulu-Natal",
  "Free State", "Limpopo", "Mpumalanga", "North West", "Northern Cape",
] as const;

export const REGIONS = [
  "Ceres", "Stellenbosch", "Paarl", "Robertson", "Oudtshoorn",
  "Polokwane", "Nelspruit", "Bloemfontein", "Rustenburg",
] as const;

export const HARDWARE_TYPES = [
  "ESP32 Controller", "Soil Moisture Sensor", "Weather Station", "Valve Actuator", "Gateway",
] as const;

/* The crops the FAO-56 engine can give advice for. Every value resolves in
 * Fao56EngineReference.TryResolveCrop (see the Aliases table in
 * backend/AgroFlow.Domain/IrrigationControl/Agronomy/Fao56EngineReference.cs); a crop that does not resolve
 * gets no crop coefficient, no stages and no advice. The first six are the ones a farmer
 * can request in the mobile app, so a request and the zone made from it match. */
export const ZONE_CROPS = [
  { value: "maize", label: "Maize" },
  { value: "potato", label: "Potato" },
  { value: "tomato", label: "Tomato" },
  { value: "dry_beans", label: "Dry beans" },
  { value: "citrus", label: "Citrus" },
  { value: "leafy_veg", label: "Leafy vegetables" },
  { value: "cucumber", label: "Cucumber" },
  { value: "spinach", label: "Spinach" },
] as const;

/** The same set as labels, for filter dropdowns. */
export const CROPS = ZONE_CROPS.map((c) => c.label);

