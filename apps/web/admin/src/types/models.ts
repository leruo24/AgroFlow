

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
  | "onboarding";

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
  | "General"
  | "Notifications"
  | "Platform Defaults"
  | "Security"
  | "Backup & Recovery";

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
  dateJoined: string;
  lastActive: string;
  hardware: string[];
  scheduleIds: number[];
  support: SupportTicket[];
  notes: Note[];
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
}

/* --------------------------------- alerts --------------------------------------- */

export type AlertPriority = "Critical" | "High" | "Medium" | "Low";
export type AlertStatus =
  | "New" | "Assigned" | "In Progress" | "Escalated" | "Waiting for User" | "Resolved" | "Closed";

export interface AdminAlert {
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

export interface MaintenanceJob {
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
  litres: number;
  durationMin: number;
  onSchedule: boolean;
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