

/* --------------------------------- pages ---------------------------------- */

export type PageId =
  | "dashboard"
  | "users"
  | "farms"
  | "hardware"
  | "alerts"
  | "maintenance"
  | "reports"
  | "irrigation"
  | "activity"
  | "settings"
  | "onboarding"
  | "requests"
  | "mqttLogins";

export interface NavItem {
  id: PageId;
  label: string;
  icon: string;
}

/** Options passed into a page renderer (e.g. a specific record to open). */
export interface PageOptions {
  id?: string | number;
  [key: string]: unknown;
}

export type PageRenderer = (opts?: PageOptions) => Promise<string>;

export type SettingsTab =
  /* One. "Platform thresholds" and "Backup & Recovery" were removed in the
     admin polish (item 6): neither was something an admin could act on here.
     See settingsTabBody. */
  "My account";

/* -------------------------------- UI bits ---------------------------------- */

export type BadgeTone = "good" | "warn" | "bad" | "info" | "neutral";
export type TrendDirection = "up" | "down";

export interface Trend {
  dir: TrendDirection;
  text: string;
}

export interface SeriesPoint {
  label: string;
  value: number;
}

/** Generic named distribution used by the donut chart (status -> count). */
export type StatusDistribution = Record<string, number>;

/* ------------------------------ filter engine ------------------------------ */

export type DateRangePreset =
  | "7d" | "30d" | "90d" | "month" | "quarter" | "year" | "all" | "custom";

export interface FilterState {
  search: string;
  from: string;
  to: string;
  preset: DateRangePreset;
  farm: string;
  province: string;
  region: string;
  eventType: string;
  administrator: string;
  status: string;
  priority: string;
  deviceType: string;
  maintenanceState: string;
  crop: string;

  /** Telegram reachability on the users page: "Connected",
      "Connected, alerts off", or "Not connected". Chasing up everyone who
      never connected is the view the team actually works from. */
  telegram: string;
}

/* ---------------------------------- users ----------------------------------- */

export type UserStatus = "Active" | "Disabled" | "Pending";

export interface SupportTicket {
  id: string;
  subject: string;
  status: string;
  when: string;
}

export interface Note {
  id: number;
  author: string;
  note: string;
  when: string;
}

export interface User {
  /** profile.id is a Supabase Auth uuid, not a numeric id - unlike Farm/
      Hardware/etc., which map onto real bigint/generated ids. */
  id: string;
  name: string;
  email: string;
  phone: string;
  farm: string;
  status: UserStatus;

  /** profile.role. Needed to tell an administrator from a farmer - the
      Assign picker must offer only people who can actually attend to a
      request, and a list of every farmer would be hundreds long. */
  role: string;

  /** Whether this farmer has actually connected Telegram (profile.
      telegram_chat_id is not null). False means they receive NOTHING -
      no weather warnings, no equipment failures, no password resets -
      and nobody finds out until something urgent fails to arrive. */
  telegramLinked: boolean;

  /** profile.telegram_alerts_enabled. Only meaningful when telegramLinked
      is true: a farmer who muted their alerts is a deliberate choice, which
      is a different situation from one who never connected at all. */
  telegramAlerts: boolean;

  dateJoined: string;
  lastActive: string;
  hardware: string[];
  scheduleIds: number[];
  support: SupportTicket[];
  notes: Note[];
}

/* ---------------------------- service requests -------------------------------- */

export type ServiceRequestType = "new_farm" | "new_zone";
export type ServiceRequestStatus = "pending" | "scheduled" | "completed";
export type ServiceRequestCrop =
  | "potato"
  | "tomato"
  | "citrus"
  | "leafy_veg"
  | "maize"
  | "dry_beans";

export interface ServiceRequest extends Handling {
  id: number;
  farmerId: string;
  farmerName: string;
  farmerEmail: string;
  /* Admin polish, item 2: shown when there is no name or email. */
  farmerPhone?: string;
  /* No name, email or phone on the profile: farmerName is "Request #id". */
  farmerUnidentified?: boolean;
  farmId: number | null;
  farmName: string | null;
  requestType: ServiceRequestType;
  location: string | null;
  roughSize: number | null;
  cropType: ServiceRequestCrop;
  notes: string | null;
  status: ServiceRequestStatus;
  createdAt: string;
  updatedAt: string;

  /* The accountability chain (migration 0037). All optional: rows created
     before that migration have nulls, which read correctly as "we do not
     know who did this" - because we genuinely do not. */
  assignedToProfileId?: string | null;
  assignedToName?: string | null;
  scheduledByName?: string | null;
  scheduledAt?: string | null;
  completedByName?: string | null;
  completedAt?: string | null;
}

/* ---------------------------------- farms ------------------------------------ */

export type FarmHealth = "Healthy" | "Attention Required" | "Critical";
export type FarmStatus = "Active" | "Inactive" | "Pending Approval";

export interface FarmHealthFactors {
  deviceConnectivity: number;
  gatewayOnline: boolean;
  sensorsAvailable: number;
  outstandingAlerts: number;
  openMaintenance: number;
}

/** An irrigation zone within a farm. Added to support farmer onboarding. */
export interface Zone {
  id: number;
  name: string;
  sizeHectares: number;
}

export interface Farm {
  id: number;
  name: string;
  owner: string;

  /** farm.owner_id. The NAME is not an identifier: two farmers can share
      one, and a dependent picker that filtered farms by owner name would
      show one farmer another's farms. Null for a farm with no owner on
      file. */
  ownerId: string | null;
  location: string;
  latitude: number | null;
  longitude: number | null;
  province: string;
  region: string;
  health: FarmHealth;
  status: FarmStatus;
  hectares: number;
  registered: string;
  lastActivity: string;
  healthFactors: FarmHealthFactors;
  /** Counts, used in list/export views. */
  users: number;
  devices: number;
  /** Irrigation zones on this farm. Optional — older mock farms may have none. */
  zones?: Zone[];
}

/* -------------------------------- hardware ------------------------------------ */

export type HardwareStatus = "Online" | "Offline" | "Degraded" | "Fault";
export type MaintenanceState = "OK" | "Due" | "Overdue" | "Scheduled";

export interface Hardware {
  id: string;
  type: string;
  farm: string;
  province: string;
  firmware: string;
  battery: number | null;
  uptimePct: number;
  status: HardwareStatus;
  maintenanceState: MaintenanceState;
  installed: string;
  lastSeen: string;

  /* --- firmware v1.3.0 ---------------------------------------------------
     All optional, so a row that could not be enriched from
     GET /api/admin/hardware still renders everything it always did.

     zoneId is what every device action is addressed by: the commands go into
     irrigation_commands, which is keyed on zone, not on hardware_id. */
  zoneId?: number | null;
  /** hardware.device_id - the ESP32 efuse ID the firmware derives from the chip. */
  deviceId?: string | null;
  zoneName?: string | null;
  /** Heard from within the last 5 minutes, by any route. Distinct from
      `status`, which DeviceStatusMonitorService writes on a 30-minute rule. */
  online?: boolean;
  /** active / revoked / legacy key / no device. Cannot be derived in the
      browser - see 0028's column grants. */
  tokenStatus?: string;
  /** The board's assigned pool login. Username only; the password is never
      returned to any admin screen. */
  mqttUsername?: string | null;
  enrollmentStatus?: string;
}

/* --------------------------------- alerts --------------------------------------- */

export type AlertPriority = "Critical" | "High" | "Medium" | "Low";
export type AlertStatus =
  | "New" | "Assigned" | "In Progress" | "Escalated" | "Waiting for User" | "Resolved" | "Closed";

/* Item 5: who is handling an item, and who closed it - from the API
   (GET /api/admin/handling/{kind}). Optional: older APIs send nothing. */
export interface Handling {
  handledById?: string | null;
  handledByName?: string | null;
  claimedAt?: string | null;
  resolvedByName?: string | null;
  resolvedAt?: string | null;
  escalatedAt?: string | null;
}

export interface AdminAlert extends Handling {
  id: string;
  raised: string;
  category: string;
  title: string;
  farm: string | null;
  user: string | null;
  assignedTo: string | null;
  priority: AlertPriority;
  status: AlertStatus;
  notes: Note[];
}

/* ------------------------------- maintenance ------------------------------------- */

export type MaintenanceStatus = "Scheduled" | "Overdue" | "In Progress" | "Upcoming" | "Completed";

export interface MaintenanceJob extends Handling {
  id: string;
  device: string;
  deviceType: string;
  farm: string;
  province: string;
  issue: string;
  priority: AlertPriority;
  technician: string | null;
  scheduledFor: string;
  status: MaintenanceStatus;
  completedOn: string | null;
  reportUploaded: boolean;
}

/* ------------------------------- irrigation --------------------------------------- */

export interface IrrigationSchedule {
  id: number;
  zone: string;
  farm: string;
  province: string;
  region: string;
  crop: string;
  device: string;
  cadence: string;
  durationMin: number;
  compliancePct: number;
  lastRun: string;
  active: boolean;
}

export interface IrrigationEvent {
  date: string;
  farm: string;
  zone: string;
  crop: string;
  province: string;
  region: string;

  /** ESTIMATED litres: runtime_seconds / 60 * zone.flow_rate_lpm (migration
      0018). There is no flow meter on any AgroFlow node, so this is inferred,
      never measured, and anything rendering it must say so.

      NULL when the zone has no flow rate on file - which means no estimate
      can be made. That is not the same as 0, and must never be shown as 0: a
      zero would read as a pump that ran and delivered nothing. */
  litres: number | null;

  durationMin: number;

  /** No schedule-adherence column exists anywhere in the schema, so this
      cannot be computed and is always null. It was previously hardcoded
      true, which rendered as "every irrigation ran on schedule" - a claim
      nothing in the data supports. */
  onSchedule: boolean | null;
}

/* --------------------------------- activity ----------------------------------------- */

export type ActivityEventType =
  | "User created" | "User edited" | "User disabled" | "User enabled" | "User deleted"
  | "Password reset" | "Farm registered" | "Farm approved" | "Farm deactivated"
  | "Hardware replaced" | "Hardware removed" | "Alert assigned" | "Alert escalated"
  | "Alert resolved" | "Alert closed" | "Maintenance scheduled" | "Maintenance completed"
  | "Schedule edited" | "Schedule deleted" | "Report generated";

export interface ActivityEntry {
  id: number;
  timestamp: string;
  administrator: string;
  farm: string | null;
  eventType: ActivityEventType;
  target: string | null;
  outcome: "Success" | "Failed" | "Pending";
}

/* ----------------------------------- KPIs -------------------------------------------- */

export interface Kpis {
  totalFarms: number;
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  connectedHardware: number;
  totalHardware: number;
  activeAlerts: number;
  openMaintenance: number;
  systemUptime: number;
  deviceConnectivity: number;
  platformAvailability: number;
  newFarmsThisMonth: number;
  newUsersThisWeek: number;

  /** Farmers with no Telegram connected. They receive no weather warnings,
      no equipment failures and no password resets, and nothing else in the
      dashboard would reveal that until an urgent message failed to arrive. */
  farmersNotReceivingAlerts: number;
}

/** Trend per KPI key (dashboard looks these up by string key, so keep it a map). */
export type Trends = Partial<Record<keyof Kpis, Trend>>;

export interface GrowthSeries {
  users: SeriesPoint[];
  farms: SeriesPoint[];
  connectivity: SeriesPoint[];
  maintenance: SeriesPoint[];
}

export interface ServiceHealth {
  ok: boolean;
  status: string;
  latencyMs: number | null;
}

export type SystemHealth = Record<string, ServiceHealth>;
