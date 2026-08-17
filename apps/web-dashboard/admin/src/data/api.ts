/* ============================================================================
   AgroFlow Admin — API LAYER
   ----------------------------------------------------------------------------
   The UI talks ONLY to this module. Every method is async and returns typed
   data, so swapping mock → real HTTP requires no changes anywhere else.

   ---- CONNECTING A REAL BACKEND --------------------------------------------
   1. Create .env with:  VITE_API_BASE=https://your-server.com/api
      The layer auto-switches off mock data as soon as this is set.
   2. Each method already has its real request<T>() call written next to the
      mock branch — adjust endpoint paths to match your routes.
   3. Make your JSON match src/types/models.ts. Run `npm run typecheck` to
      surface any mismatch at compile time.
   4. Delete src/data/mock.ts once nothing imports it.
   ========================================================================== */

import {
  KPIS, TRENDS, GROWTH, SYSTEM_HEALTH, FARM_HEALTH_DIST, HARDWARE_STATUS_DIST,
  USERS, FARMS, HARDWARE, ALERTS, MAINTENANCE, SCHEDULES,
  IRRIGATION_EVENTS, ACTIVITY,
} from "@/data/mock";
import type {
  Kpis, Trends, GrowthSeries, SystemHealth, StatusDistribution,
  User, Farm, Hardware, AdminAlert, MaintenanceJob,
  IrrigationSchedule, IrrigationEvent, ActivityEntry,
  AlertStatus, AlertPriority, MaintenanceStatus, UserStatus,
} from "@/types/models";

const API_BASE: string = import.meta.env["VITE_API_BASE"] ?? "";
const USE_MOCK = API_BASE === "";

const mockDelay = <T>(value: T, ms = 160): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText} — ${path}`);
  return (await res.json()) as T;
}

/* Mutable working copies so admin actions persist for the session. */
let users = [...USERS];
let farms = [...FARMS];
let hardware = [...HARDWARE];
let alerts = [...ALERTS];
let maintenance = [...MAINTENANCE];
let schedules = [...SCHEDULES];
let activity = [...ACTIVITY];

let activitySeq = 100000;

/** Records an administrator action into Platform Activity. */
export function recordActivity(
  eventType: ActivityEntry["eventType"],
  target: string | null,
  farm: string | null = null,
  administrator = "Aisha Patel",
): void {
  activity.unshift({
    id: activitySeq++,
    timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
    administrator,
    farm,
    eventType,
    target,
    outcome: "Success",
  });
}

export const api = {
  /* ------------------------------- reads ------------------------------- */
  getKpis(): Promise<Kpis> {
    return USE_MOCK ? mockDelay(KPIS) : request<Kpis>("/kpis");
  },
  getTrends(): Promise<Trends> {
    return USE_MOCK ? mockDelay(TRENDS) : request<Trends>("/trends");
  },
  getGrowth(): Promise<GrowthSeries> {
    return USE_MOCK ? mockDelay(GROWTH) : request<GrowthSeries>("/metrics/growth");
  },
  getSystemHealth(): Promise<SystemHealth> {
    return USE_MOCK ? mockDelay(SYSTEM_HEALTH) : request<SystemHealth>("/health/services");
  },
  getFarmHealthDistribution(): Promise<StatusDistribution> {
    return USE_MOCK ? mockDelay(FARM_HEALTH_DIST) : request<StatusDistribution>("/farms/health-distribution");
  },
  getHardwareStatusDistribution(): Promise<StatusDistribution> {
    return USE_MOCK ? mockDelay(HARDWARE_STATUS_DIST) : request<StatusDistribution>("/hardware/status-distribution");
  },
  getUsers(): Promise<User[]> {
    return USE_MOCK ? mockDelay(users) : request<User[]>("/users");
  },
  getFarms(): Promise<Farm[]> {
    return USE_MOCK ? mockDelay(farms) : request<Farm[]>("/farms");
  },
  getHardware(): Promise<Hardware[]> {
    return USE_MOCK ? mockDelay(hardware) : request<Hardware[]>("/hardware");
  },
  getAlerts(): Promise<AdminAlert[]> {
    return USE_MOCK ? mockDelay(alerts) : request<AdminAlert[]>("/alerts");
  },
  getMaintenance(): Promise<MaintenanceJob[]> {
    return USE_MOCK ? mockDelay(maintenance) : request<MaintenanceJob[]>("/maintenance");
  },
  getSchedules(): Promise<IrrigationSchedule[]> {
    return USE_MOCK ? mockDelay(schedules) : request<IrrigationSchedule[]>("/irrigation/schedules");
  },
  getIrrigationEvents(): Promise<IrrigationEvent[]> {
    return USE_MOCK ? mockDelay(IRRIGATION_EVENTS, 220) : request<IrrigationEvent[]>("/irrigation/events");
  },
  getActivity(): Promise<ActivityEntry[]> {
    return USE_MOCK ? mockDelay(activity, 200) : request<ActivityEntry[]>("/activity");
  },

  /* --------------------------- single lookups --------------------------- */
  findUser(id: number): User | undefined { return users.find((u) => u.id === id); },
  findFarm(id: number): Farm | undefined { return farms.find((f) => f.id === id); },
  findFarmByName(name: string): Farm | undefined { return farms.find((f) => f.name === name); },
  findHardware(id: string): Hardware | undefined { return hardware.find((h) => h.id === id); },
  findAlert(id: string): AdminAlert | undefined { return alerts.find((a) => a.id === id); },
  findMaintenance(id: string): MaintenanceJob | undefined { return maintenance.find((m) => m.id === id); },
  findSchedule(id: number): IrrigationSchedule | undefined { return schedules.find((s) => s.id === id); },

  /* ------------------------------ user actions -------------------------- */
  async setUserStatus(id: number, status: UserStatus): Promise<User[]> {
    if (!USE_MOCK) return request<User[]>(`/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    const u = users.find((x) => x.id === id);
    if (u) {
      u.status = status;
      recordActivity(status === "Disabled" ? "User disabled" : "User enabled", u.name, u.farm);
    }
    return mockDelay(users);
  },
  async updateUser(id: number, patch: Partial<User>): Promise<User[]> {
    if (!USE_MOCK) return request<User[]>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    const u = users.find((x) => x.id === id);
    if (u) {
      Object.assign(u, patch);
      recordActivity("User edited", u.name, u.farm);
    }
    return mockDelay(users);
  },
  async deleteUser(id: number): Promise<User[]> {
    if (!USE_MOCK) return request<User[]>(`/users/${id}`, { method: "DELETE" });
    const u = users.find((x) => x.id === id);
    users = users.filter((x) => x.id !== id);
    if (u) recordActivity("User deleted", u.name, u.farm);
    return mockDelay(users);
  },
  async resetPassword(id: number): Promise<void> {
    const u = users.find((x) => x.id === id);
    if (u) recordActivity("Password reset", u.name, u.farm);
    return mockDelay(undefined);
  },

  /* ------------------------------ farm actions -------------------------- */
  async approveFarm(id: number): Promise<Farm[]> {
    if (!USE_MOCK) return request<Farm[]>(`/farms/${id}/approve`, { method: "POST" });
    const f = farms.find((x) => x.id === id);
    if (f) {
      f.status = "Active";
      recordActivity("Farm approved", f.name, f.name);
    }
    return mockDelay(farms);
  },
  async setFarmStatus(id: number, status: Farm["status"]): Promise<Farm[]> {
    const f = farms.find((x) => x.id === id);
    if (f) {
      f.status = status;
      recordActivity(status === "Inactive" ? "Farm deactivated" : "Farm approved", f.name, f.name);
    }
    return mockDelay(farms);
  },

  /* ---------------------------- hardware actions ------------------------ */
  async restartDevice(id: string): Promise<Hardware[]> {
    if (!USE_MOCK) return request<Hardware[]>(`/hardware/${id}/restart`, { method: "POST" });
    const h = hardware.find((x) => x.id === id);
    if (h) {
      h.status = "Online";
      h.lastSeen = "just now";
      recordActivity("Hardware replaced", h.id, h.farm);
    }
    return mockDelay(hardware);
  },
  async removeDevice(id: string): Promise<Hardware[]> {
    if (!USE_MOCK) return request<Hardware[]>(`/hardware/${id}`, { method: "DELETE" });
    const h = hardware.find((x) => x.id === id);
    hardware = hardware.filter((x) => x.id !== id);
    if (h) recordActivity("Hardware removed", h.id, h.farm);
    return mockDelay(hardware);
  },
  async replaceDevice(id: string, newId: string): Promise<Hardware[]> {
    const h = hardware.find((x) => x.id === id);
    if (h && newId.trim()) {
      recordActivity("Hardware replaced", `${h.id} → ${newId}`, h.farm);
      h.id = newId.trim();
      h.status = "Online";
      h.maintenanceState = "OK";
      h.lastSeen = "just now";
    }
    return mockDelay(hardware);
  },

  /* ------------------------------ alert actions ------------------------- */
  async setAlertStatus(id: string, status: AlertStatus): Promise<AdminAlert[]> {
    if (!USE_MOCK) return request<AdminAlert[]>(`/alerts/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    const a = alerts.find((x) => x.id === id);
    if (a) {
      a.status = status;
      const map: Partial<Record<AlertStatus, ActivityEntry["eventType"]>> = {
        Escalated: "Alert escalated", Resolved: "Alert resolved", Closed: "Alert closed",
      };
      recordActivity(map[status] ?? "Alert assigned", a.id, a.farm);
    }
    return mockDelay(alerts);
  },
  async assignAlert(id: string, administrator: string): Promise<AdminAlert[]> {
    const a = alerts.find((x) => x.id === id);
    if (a && administrator.trim()) {
      a.assignedTo = administrator.trim();
      if (a.status === "New") a.status = "Assigned";
      recordActivity("Alert assigned", `${a.id} → ${a.assignedTo}`, a.farm);
    }
    return mockDelay(alerts);
  },
  async setAlertPriority(id: string, priority: AlertPriority): Promise<AdminAlert[]> {
    const a = alerts.find((x) => x.id === id);
    if (a) a.priority = priority;
    return mockDelay(alerts);
  },
  async addAlertNote(id: string, note: string): Promise<AdminAlert[]> {
    const a = alerts.find((x) => x.id === id);
    if (a && note.trim()) {
      a.notes.unshift({
        id: Date.now(), author: "Aisha Patel", note: note.trim(),
        when: new Date().toISOString().slice(0, 16).replace("T", " "),
      });
    }
    return mockDelay(alerts);
  },

  /* --------------------------- maintenance actions ---------------------- */
  async assignTechnician(id: string, technician: string): Promise<MaintenanceJob[]> {
    const m = maintenance.find((x) => x.id === id);
    if (m && technician.trim()) {
      m.technician = technician.trim();
      if (m.status === "Overdue" || m.status === "Upcoming") m.status = "Scheduled";
      recordActivity("Maintenance scheduled", `${m.device} → ${m.technician}`, m.farm);
    }
    return mockDelay(maintenance);
  },
  async completeMaintenance(id: string): Promise<MaintenanceJob[]> {
    const m = maintenance.find((x) => x.id === id);
    if (m) {
      m.status = "Completed";
      m.completedOn = new Date().toISOString().slice(0, 10);
      recordActivity("Maintenance completed", m.device, m.farm);
    }
    return mockDelay(maintenance);
  },
  async uploadMaintenanceReport(id: string): Promise<MaintenanceJob[]> {
    const m = maintenance.find((x) => x.id === id);
    if (m) m.reportUploaded = true;
    return mockDelay(maintenance);
  },
  async scheduleVisit(id: string, date: string): Promise<MaintenanceJob[]> {
    const m = maintenance.find((x) => x.id === id);
    if (m && date) {
      m.scheduledFor = date;
      m.status = "Scheduled";
      recordActivity("Maintenance scheduled", `${m.device} @ ${date}`, m.farm);
    }
    return mockDelay(maintenance);
  },

  /* ---------------------------- schedule actions ------------------------ */
  async updateSchedule(id: number, patch: Partial<IrrigationSchedule>): Promise<IrrigationSchedule[]> {
    const s = schedules.find((x) => x.id === id);
    if (s) {
      Object.assign(s, patch);
      recordActivity("Schedule edited", `${s.zone} · ${s.farm}`, s.farm);
    }
    return mockDelay(schedules);
  },
  async deleteSchedule(id: number): Promise<IrrigationSchedule[]> {
    const s = schedules.find((x) => x.id === id);
    schedules = schedules.filter((x) => x.id !== id);
    if (s) recordActivity("Schedule deleted", `${s.zone} · ${s.farm}`, s.farm);
    return mockDelay(schedules);
  },

  /* -------------------------------- reports ----------------------------- */
  async logReportGenerated(name: string): Promise<void> {
    recordActivity("Report generated", name);
    return mockDelay(undefined);
  },
};

/* Re-export for pages that need the raw statuses. */
export type { MaintenanceStatus };
