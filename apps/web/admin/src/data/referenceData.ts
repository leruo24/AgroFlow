/* Static reference/lookup lists - option sets for filters and forms, not
   records standing in for real data. Kept separate from the deleted
   data/mock.ts (which held fake USERS/FARMS/HARDWARE/etc. arrays) because
   these aren't fake versions of anything real: there is no "provinces"
   table, and there shouldn't be one - this is just the valid value set for
   a dropdown. */

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

/* The crops the FAO-56 engine can actually give advice for.
 *
 * THIS LIST USED TO BE WRONG, AND SILENTLY SO
 * It offered Grapes, Wheat and Apples. None of them resolve in
 * Fao56EngineReference.TryResolveCrop, so a zone created with one of them
 * got no crop coefficient, no season stages and therefore no irrigation
 * advice at all - and nothing anywhere said so. The farmer just never
 * received a recommendation for that zone.
 *
 * Every value here resolves (see the Aliases table in
 * backend/AgroFlow.Domain/Agronomy/Fao56EngineReference.cs). The first six
 * are also the six the farmer can request in the mobile app, so a request
 * and the zone an admin creates from it speak the same language. */
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

export const EVENT_TYPE_OPTIONS = [
  "User created", "User edited", "User disabled", "User enabled", "User deleted",
  "Password reset", "Farm registered", "Farm approved", "Farm deactivated",
  "Hardware replaced", "Hardware removed", "Alert assigned", "Alert escalated",
  "Alert resolved", "Alert closed", "Maintenance scheduled", "Maintenance completed",
  "Schedule edited", "Schedule deleted", "Report generated",
] as const;

/** No technician/staff-roster table exists anywhere in the schema - this
    is a genuine gap, not a query I can point at something real. Kept as a
    static placeholder list purely so the "assign technician" text field
    has autocomplete-style suggestions; it is not a source of truth about
    who your technicians actually are. */
export const TECHNICIANS = ["Sipho Dlamini", "Pieter Botha", "Nomvula Zulu", "Retha Steyn"] as const;
