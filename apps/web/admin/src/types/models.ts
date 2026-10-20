

/* pages */

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
  /* One tab. See settingsTabBody. */
  "My account";

/* UI bits */

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

/* filter engine */

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

  /**
   * Telegram status on the users page: "Connected", "Connected, alerts off" or "Not
   * connected". The team works from the list of everyone not connected.
   */
  telegram: string;
}

/* users */

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
  /** profile.id is a Supabase Auth uuid, not a number like the Farm/Hardware ids. */
  id: string;
  name: string;
  email: string;
  phone: string;
  farm: string;
  status: UserStatus;

  /**
   * profile.role, to tell an admin from a farmer: the Assign picker offers only people who
   * can handle a request.
   */
  role: string;

  /**
   * Whether this farmer connected Telegram (profile.telegram_chat_id is not null). False
   * means they get nothing (no weather warnings, equipment failures or password resets).
   */
  telegramLinked: boolean;

  /**
   * profile.telegram_alerts_enabled. Only means something when telegramLinked is true: a
   * farmer who muted alerts chose to, which is different from one who never connected.
   */
  telegramAlerts: boolean;

  dateJoined: string;
  lastActive: string;
  hardware: string[];
  scheduleIds: number[];
  support: SupportTicket[];
  notes: Note[];
}

/* service requests */

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
  /* Shown when there is no name or email. */
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

  /* The who/when chain (migration 0037). All optional: rows created before that migration
   * have nulls, which correctly read as "we do not know who did this". */
  assignedToProfileId?: string | null;
  assignedToName?: string | null;
  scheduledByName?: string | null;
  scheduledAt?: string | null;
  completedByName?: string | null;
  completedAt?: string | null;
}

/* farms */

export type FarmHealth = "Healthy" | "Attention Required" | "Critical";
export type FarmStatus = "Active" | "Inactive" | "Pending Approval";

export interface FarmHealthFactors {
  deviceConnectivity: number;
  gatewayOnline: boolean;
  sensorsAvailable: number;
  outstandingAlerts: number;
  openMaintenance: number;
}

/** An irrigation zone within a farm, used by farmer onboarding. */
export interface Zone {
  id: number;
  name: string;
  sizeHectares: number;
}

export interface Farm {
  id: number;
  name: string;
  owner: string;

  /**
   * farm.owner_id. The name is not an identifier: two farmers can share one, and filtering by
   * name would show one farmer another's farms. Null for a farm with no owner on file.
   */
  ownerId: string | null;
  location: string;
  latitude: number | null;
  longitude: number | null;
  isSimulated?: boolean;
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
  /** Irrigation zones on this farm. Optional: a farm may have none. */
  zones?: Zone[];
}

/* hardware */

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

  /* All optional, so a row that could not be enriched from GET /api/admin/hardware still
   * renders. zoneId is what every device action uses: irrigation_commands is keyed on zone,
   * not hardware_id. */
  zoneId?: number | null;
  /** hardware.device_id: the ESP32 efuse ID the firmware reads from the chip. */
  deviceId?: string | null;
  zoneName?: string | null;
  /**
   * Heard from within the last 5 minutes, by any route. Different from `status`, which
   * DeviceStatusMonitorService writes on a 30-minute rule.
   */
  online?: boolean;
  /**
   * active / revoked / legacy key / no device. Cannot be worked out in the browser; see
   * 0028's column grants.
   */
  tokenStatus?: string;
  /** The board's assigned pool login. Username only; the password is never
      returned to any admin screen. */
  mqttUsername?: string | null;
  enrollmentStatus?: string;
}

/* alerts */

export type AlertPriority = "Critical" | "High" | "Medium" | "Low";
export type AlertStatus =
  | "New" | "Assigned" | "In Progress" | "Escalated" | "Waiting for User" | "Resolved" | "Closed";

/* Who is handling an item, and who closed it, from the API
 * (GET /api/admin/handling/{kind}). Optional: older APIs send nothing. */
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

/* maintenance */

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

/* irrigation */

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

  /**
   * Estimated litres: runtime_seconds / 60 * zone.flow_rate_lpm (migration 0018). No node
   * has a flow meter, so this is never measured, and anything showing it must say so.
   * Null when the zone has no flow rate, so no estimate can be made. Never show it as 0: a
   * zero reads as a pump that ran and delivered nothing.
   */
  litres: number | null;

  durationMin: number;

  /** No schedule-adherence column exists, so this cannot be worked out and is always null. */
  onSchedule: boolean | null;
}

/* activity */

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

/* KPIs */

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

  /**
   * Farmers with no Telegram connected. They get no weather warnings, equipment failures or
   * password resets, and nothing else on the dashboard would show it.
   */
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
