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

export const CROPS = ["Maize", "Grapes", "Citrus", "Wheat", "Potatoes", "Apples"] as const;

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
