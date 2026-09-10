/* ============================================================================
   AgroFlow — canonical admin mock dataset.
   Every page currently renders against this data via src/data/api.ts.
   ========================================================================== */

import type {
  User, Farm, Hardware, AdminAlert, MaintenanceJob, IrrigationSchedule,
  IrrigationEvent, ActivityEntry, Kpis, Trends, GrowthSeries, SystemHealth,
  StatusDistribution,
} from "../types/models";

/* ------------------------------ constant lists ------------------------------ */

export const PROVINCES = [
  "Western Cape", "Eastern Cape", "Gauteng", "KwaZulu-Natal",
  "Free State", "Limpopo", "Mpumalanga", "North West", "Northern Cape",
] as const;

export const REGIONS = [
  "Ceres", "Stellenbosch", "Paarl", "Robertson", "Oudtshoorn",
  "Polokwane", "Nelspruit", "Bloemfontein", "Rustenburg",
] as const;

export const FARM_NAMES = [
  "Sunrise Valley Farm", "Highveld Grain Co-op", "Riverbend Orchards",
  "Karoo Sky Ranch", "Greenfields Estate", "Bushveld Agri Partners",
  "Silverleaf Vineyards", "Drakensberg Dairy", "Kalahari Grove",
  "Overberg Wheat Fields",
] as const;

export const ADMINS = ["Aisha Patel", "Thabo Nkosi", "Lerato Mokoena", "Johan van der Merwe"] as const;

export const TECHNICIANS = ["Sipho Dlamini", "Pieter Botha", "Nomvula Zulu", "Retha Steyn"] as const;

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

/* ---------------------------------- users ------------------------------------ */

export const USERS: User[] = [
  {
    id: 1, name: "Thandiwe Nkosi", email: "thandiwe@sunrisevalley.co.za", phone: "+27 82 111 2233",
    farm: "Sunrise Valley Farm", status: "Active", dateJoined: "2026-03-14", lastActive: "2 hours ago",
    hardware: ["ESP32-0091", "SM-0142"], scheduleIds: [1, 2],
    support: [{ id: "T-1042", subject: "Sensor offline in Zone 2", status: "Resolved", when: "2026-06-01 10:12" }],
    notes: [{ id: 1, author: "Aisha Patel", note: "Verified phone number by call.", when: "2026-03-15 09:00" }],
  },
  {
    id: 2, name: "Johan Kruger", email: "johan@highveldgrain.co.za", phone: "+27 83 222 3344",
    farm: "Highveld Grain Co-op", status: "Active", dateJoined: "2026-01-22", lastActive: "1 day ago",
    hardware: ["ESP32-0102"], scheduleIds: [3], support: [], notes: [],
  },
  {
    id: 3, name: "Naledi Dube", email: "naledi@riverbend.co.za", phone: "+27 84 333 4455",
    farm: "Riverbend Orchards", status: "Disabled", dateJoined: "2025-11-09", lastActive: "3 weeks ago",
    hardware: [], scheduleIds: [], support: [{ id: "T-1001", subject: "Billing question", status: "Closed", when: "2026-01-04 14:20" }],
    notes: [{ id: 2, author: "Thabo Nkosi", note: "Disabled after repeated payment failure.", when: "2026-02-01 08:30" }],
  },
  {
    id: 4, name: "Pieter Fourie", email: "pieter@karoosky.co.za", phone: "+27 82 444 5566",
    farm: "Karoo Sky Ranch", status: "Active", dateJoined: "2026-05-30", lastActive: "5 hours ago",
    hardware: ["ESP32-0140", "WS-0011"], scheduleIds: [4], support: [], notes: [],
  },
  {
    id: 5, name: "Zanele Mthembu", email: "zanele@greenfields.co.za", phone: "+27 71 555 6677",
    farm: "Greenfields Estate", status: "Pending", dateJoined: "2026-07-20", lastActive: "just now",
    hardware: [], scheduleIds: [], support: [], notes: [],
  },
];

/* ---------------------------------- farms ------------------------------------- */

export const FARMS: Farm[] = [
  {
    id: 1, name: "Sunrise Valley Farm", owner: "Thandiwe Nkosi", province: "Western Cape", region: "Ceres",
    health: "Healthy", status: "Active", hectares: 120, registered: "2026-03-14", lastActivity: "2 hours ago",
    healthFactors: { deviceConnectivity: 96, gatewayOnline: true, sensorsAvailable: 92, outstandingAlerts: 0, openMaintenance: 0  },
    users: 1, devices: 2,
    zones: [
      { id: 1, name: "North Block", sizeHectares: 45 },
      { id: 2, name: "South Block", sizeHectares: 75 },
    ],
  },
  {
    id: 2, name: "Highveld Grain Co-op", owner: "Johan Kruger", province: "Free State", region: "Bloemfontein",
    health: "Attention Required", status: "Active", hectares: 340, registered: "2026-01-22", lastActivity: "1 day ago",
    healthFactors: { deviceConnectivity: 78, gatewayOnline: true, sensorsAvailable: 70, outstandingAlerts: 1, openMaintenance: 1 },
    users: 1, devices: 1,
    zones: [{ id: 3, name: "Field A", sizeHectares: 340 }],
  },
  {
    id: 3, name: "Riverbend Orchards", owner: "Naledi Dube", province: "Eastern Cape", region: "Oudtshoorn",
    health: "Critical", status: "Inactive", hectares: 65, registered: "2025-11-09", lastActivity: "3 weeks ago",
    healthFactors: { deviceConnectivity: 10, gatewayOnline: false, sensorsAvailable: 5, outstandingAlerts: 2, openMaintenance: 0  },
    users: 1, devices: 0,
  },
  {
    id: 4, name: "Karoo Sky Ranch", owner: "Pieter Fourie", province: "Northern Cape", region: "Oudtshoorn",
    health: "Healthy", status: "Active", hectares: 210, registered: "2026-05-30", lastActivity: "5 hours ago",
    healthFactors: { deviceConnectivity: 99, gatewayOnline: true, sensorsAvailable: 97, outstandingAlerts: 1, openMaintenance: 1  },
    users: 1, devices: 2,
    zones: [
      { id: 4, name: "Zone 1", sizeHectares: 110 },
      { id: 5, name: "Zone 2", sizeHectares: 100 },
    ],
  },
  {
    id: 5, name: "Greenfields Estate", owner: "Zanele Mthembu", province: "Mpumalanga", region: "Nelspruit",
    health: "Attention Required", status: "Pending Approval", hectares: 88, registered: "2026-07-20", lastActivity: "just now",
    healthFactors: { deviceConnectivity: 0, gatewayOnline: false, sensorsAvailable: 0, outstandingAlerts: 0, openMaintenance: 0  },
    users: 1, devices: 0,
  },
];

/* -------------------------------- hardware ------------------------------------- */

export const HARDWARE: Hardware[] = [
  { id: "ESP32-0091", type: "ESP32 Controller", farm: "Sunrise Valley Farm", province: "Western Cape",
    firmware: "v2.3.1", battery: null, uptimePct: 99.2, status: "Online", maintenanceState: "OK",
    installed: "2026-03-16", lastSeen: "just now" },
  { id: "SM-0142", type: "Soil Moisture Sensor", farm: "Sunrise Valley Farm", province: "Western Cape",
    firmware: "v1.8.0", battery: 82, uptimePct: 97.5, status: "Online", maintenanceState: "OK",
    installed: "2026-03-16", lastSeen: "2 min ago" },
  { id: "ESP32-0102", type: "ESP32 Controller", farm: "Highveld Grain Co-op", province: "Free State",
    firmware: "v2.1.0", battery: null, uptimePct: 88.0, status: "Degraded", maintenanceState: "Due",
    installed: "2026-01-25", lastSeen: "40 min ago" },
  { id: "ESP32-0140", type: "ESP32 Controller", farm: "Karoo Sky Ranch", province: "Northern Cape",
    firmware: "v2.3.1", battery: null, uptimePct: 99.8, status: "Online", maintenanceState: "OK",
    installed: "2026-06-01", lastSeen: "just now" },
  { id: "WS-0011", type: "Weather Station", farm: "Karoo Sky Ranch", province: "Northern Cape",
    firmware: "v1.4.2", battery: 64, uptimePct: 95.1, status: "Online", maintenanceState: "Scheduled",
    installed: "2026-06-01", lastSeen: "5 min ago" },
  { id: "GW-0004", type: "Gateway", farm: "Riverbend Orchards", province: "Eastern Cape",
    firmware: "v1.0.9", battery: null, uptimePct: 12.0, status: "Offline", maintenanceState: "Overdue",
    installed: "2025-11-10", lastSeen: "3 weeks ago" },
];

/* --------------------------------- alerts --------------------------------------- */

export const ALERTS: AdminAlert[] = [
  { id: "AL-1001", raised: "2026-07-21 08:14", category: "Hardware", title: "Gateway offline for 20+ hours",
    farm: "Riverbend Orchards", user: "Naledi Dube", assignedTo: "Aisha Patel", priority: "Critical",
    status: "Escalated", notes: [] },
  { id: "AL-1002", raised: "2026-07-20 16:02", category: "Farm Approval", title: "New farm pending review",
    farm: "Greenfields Estate", user: "Zanele Mthembu", assignedTo: null, priority: "Medium",
    status: "New", notes: [] },
  { id: "AL-1003", raised: "2026-07-19 11:47", category: "Connectivity", title: "Intermittent sensor dropout",
    farm: "Highveld Grain Co-op", user: "Johan Kruger", assignedTo: "Thabo Nkosi", priority: "High",
    status: "In Progress", notes: [{ id: 1, author: "Thabo Nkosi", note: "Replacement sensor dispatched.", when: "2026-07-19 14:00" }] },
  { id: "AL-1004", raised: "2026-07-10 09:30", category: "Account", title: "Repeated login failures",
    farm: null, user: "Naledi Dube", assignedTo: "Lerato Mokoena", priority: "Low", status: "Resolved", notes: [] },
];

/* ------------------------------- maintenance ------------------------------------- */

export const MAINTENANCE: MaintenanceJob[] = [
  { id: "MJ-2001", device: "GW-0004", deviceType: "Gateway", farm: "Riverbend Orchards", province: "Eastern Cape",
    issue: "Gateway unresponsive, needs on-site reset", priority: "Critical", technician: "Sipho Dlamini",
    scheduledFor: "2026-07-25", status: "Scheduled", completedOn: null, reportUploaded: false },
  { id: "MJ-2002", device: "ESP32-0102", deviceType: "ESP32 Controller", farm: "Highveld Grain Co-op", province: "Free State",
    issue: "Firmware update required", priority: "Medium", technician: null,
    scheduledFor: "2026-07-18", status: "Overdue", completedOn: null, reportUploaded: false },
  { id: "MJ-2003", device: "SM-0142", deviceType: "Soil Moisture Sensor", farm: "Sunrise Valley Farm", province: "Western Cape",
    issue: "Routine calibration", priority: "Low", technician: "Retha Steyn",
    scheduledFor: "2026-06-15", status: "Completed", completedOn: "2026-06-16", reportUploaded: true },
];

/* ------------------------------- irrigation --------------------------------------- */

export const SCHEDULES: IrrigationSchedule[] = [
  { id: 1, zone: "North Block", farm: "Sunrise Valley Farm", province: "Western Cape", region: "Ceres",
    crop: "Grapes", device: "ESP32-0091", cadence: "Every 2 days, 06:00", durationMin: 45,
    compliancePct: 96, lastRun: "2026-07-22", active: true },
  { id: 2, zone: "South Block", farm: "Sunrise Valley Farm", province: "Western Cape", region: "Ceres",
    crop: "Apples", device: "ESP32-0091", cadence: "Daily, 05:30", durationMin: 30,
    compliancePct: 88, lastRun: "2026-07-22", active: true },
  { id: 3, zone: "Field A", farm: "Highveld Grain Co-op", province: "Free State", region: "Bloemfontein",
    crop: "Maize", device: "ESP32-0102", cadence: "Every 3 days, 07:00", durationMin: 90,
    compliancePct: 71, lastRun: "2026-07-19", active: true },
  { id: 4, zone: "Zone 1", farm: "Karoo Sky Ranch", province: "Northern Cape", region: "Oudtshoorn",
    crop: "Citrus", device: "ESP32-0140", cadence: "Daily, 04:45", durationMin: 60,
    compliancePct: 99, lastRun: "2026-07-22", active: true },
];

export const IRRIGATION_EVENTS: IrrigationEvent[] = [
  { date: "2026-07-22", farm: "Sunrise Valley Farm", zone: "North Block", crop: "Grapes", province: "Western Cape", region: "Ceres", litres: 18400, durationMin: 45, onSchedule: true },
  { date: "2026-07-22", farm: "Karoo Sky Ranch", zone: "Zone 1", crop: "Citrus", province: "Northern Cape", region: "Oudtshoorn", litres: 24100, durationMin: 60, onSchedule: true },
  { date: "2026-07-21", farm: "Highveld Grain Co-op", zone: "Field A", crop: "Maize", province: "Free State", region: "Bloemfontein", litres: 51200, durationMin: 90, onSchedule: false },
  { date: "2026-07-20", farm: "Sunrise Valley Farm", zone: "South Block", crop: "Apples", province: "Western Cape", region: "Ceres", litres: 12300, durationMin: 30, onSchedule: true },
  { date: "2026-06-15", farm: "Karoo Sky Ranch", zone: "Zone 2", crop: "Citrus", province: "Northern Cape", region: "Oudtshoorn", litres: 20200, durationMin: 55, onSchedule: true },
  { date: "2026-05-10", farm: "Highveld Grain Co-op", zone: "Field A", crop: "Maize", province: "Free State", region: "Bloemfontein", litres: 48900, durationMin: 88, onSchedule: true },
];

/* --------------------------------- activity ----------------------------------------- */

export const ACTIVITY: ActivityEntry[] = [
  { id: 100001, timestamp: "2026-07-22 09:10", administrator: "Aisha Patel", farm: "Riverbend Orchards", eventType: "Alert escalated", target: "AL-1001", outcome: "Success" },
  { id: 100002, timestamp: "2026-07-21 16:05", administrator: "Thabo Nkosi", farm: "Highveld Grain Co-op", eventType: "Maintenance scheduled", target: "MJ-2002", outcome: "Success" },
  { id: 100003, timestamp: "2026-07-20 12:44", administrator: "Lerato Mokoena", farm: null, eventType: "User disabled", target: "Naledi Dube", outcome: "Success" },
  { id: 100004, timestamp: "2026-06-16 08:00", administrator: "Retha Steyn", farm: "Sunrise Valley Farm", eventType: "Maintenance completed", target: "MJ-2003", outcome: "Success" },
];

/* ----------------------------------- KPIs -------------------------------------------- */

export const KPIS: Kpis = {
  totalFarms: FARMS.length,
  totalUsers: USERS.length,
  activeUsers: USERS.filter((u) => u.status === "Active").length,
  disabledUsers: USERS.filter((u) => u.status === "Disabled").length,
  connectedHardware: HARDWARE.filter((h) => h.status === "Online").length,
  totalHardware: HARDWARE.length,
  activeAlerts: ALERTS.filter((a) => !["Resolved", "Closed"].includes(a.status)).length,
  openMaintenance: MAINTENANCE.filter((m) => m.status !== "Completed").length,
  systemUptime: 99.4,
  deviceConnectivity: 91.2,
  platformAvailability: 99.97,
  newFarmsThisMonth: 2,
  newUsersThisWeek: 1,
};

export const TRENDS: Trends = {
  totalFarms: { dir: "up", text: "+2 this month" },
  totalUsers: { dir: "up", text: "+1 this week" },
  connectedHardware: { dir: "up", text: "stable" },
  activeAlerts: { dir: "down", text: "-1 vs last week" },
  openMaintenance: { dir: "down", text: "-1 vs last week" },
  systemUptime: { dir: "up", text: "steady" },
  deviceConnectivity: { dir: "down", text: "-3% vs last month" },
  platformAvailability: { dir: "up", text: "within SLA" },
  newFarmsThisMonth: { dir: "up", text: "vs 1 last month" },
  newUsersThisWeek: { dir: "down", text: "vs 3 last week" },
};

export const GROWTH: GrowthSeries = {
  users: [
    { label: "Feb", value: 8 }, { label: "Mar", value: 12 }, { label: "Apr", value: 15 },
    { label: "May", value: 19 }, { label: "Jun", value: 22 }, { label: "Jul", value: 25 },
  ],
  farms: [
    { label: "Feb", value: 2 }, { label: "Mar", value: 3 }, { label: "Apr", value: 3 },
    { label: "May", value: 4 }, { label: "Jun", value: 4 }, { label: "Jul", value: 5 },
  ],
  connectivity: [
    { label: "Feb", value: 90 }, { label: "Mar", value: 92 }, { label: "Apr", value: 89 },
    { label: "May", value: 94 }, { label: "Jun", value: 95 }, { label: "Jul", value: 91 },
  ],
  maintenance: [
    { label: "Feb", value: 4 }, { label: "Mar", value: 6 }, { label: "Apr", value: 3 },
    { label: "May", value: 5 }, { label: "Jun", value: 7 }, { label: "Jul", value: 3 },
  ],
};

export const SYSTEM_HEALTH: SystemHealth = {
  API: { ok: true, status: "Operational", latencyMs: 82 },
  Database: { ok: true, status: "Operational", latencyMs: 14 },
  "Realtime Sync": { ok: true, status: "Operational", latencyMs: 120 },
  "Notification Service": { ok: false, status: "Degraded", latencyMs: 640 },
};

export const FARM_HEALTH_DIST: StatusDistribution = {
  Healthy: FARMS.filter((f) => f.health === "Healthy").length,
  "Attention Required": FARMS.filter((f) => f.health === "Attention Required").length,
  Critical: FARMS.filter((f) => f.health === "Critical").length,
};

export const HARDWARE_STATUS_DIST: StatusDistribution = {
  Online: HARDWARE.filter((h) => h.status === "Online").length,
  Degraded: HARDWARE.filter((h) => h.status === "Degraded").length,
  Offline: HARDWARE.filter((h) => h.status === "Offline").length,
  Fault: HARDWARE.filter((h) => h.status === "Fault").length,
};