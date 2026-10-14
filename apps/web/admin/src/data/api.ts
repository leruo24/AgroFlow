/* AgroFlow Admin: API layer
 * The UI talks only to this module. Reads go straight to Supabase, protected by RLS
 * (supabase/migrations/0011_row_level_security.sql). AgroFlow.Api is only for what a client
 * cannot do: device ingestion, MQTT and service_role work.
 * Reads are real for every table that has one (profile, farm, hardware, alert, maintenance,
 * irrigation_event). Tables with no writer yet return empty, shown as an honest empty state.
 * Not real, on purpose:
 * - getTrends() / getGrowth(): need stored history we do not have, so they return flat or empty.
 * - getSystemHealth() / getActivity(): no table to query, so they return a "not implemented"
 * value and the pages show a labelled placeholder.
 * - Irrigation schedules: irrigation_schedule was dropped in 0010 and schedules are columns
 * on zone, so these stay on the local working copy.
 * - Some mutations (setUserStatus, restartDevice, assignTechnician, ...) have no column or RLS
 * grant behind them. They change the in-memory copy for feedback but do not save to Postgres. */

import { navigationAwareFetch } from "@/lib/navigation";
import { supabase } from "@/lib/supabase";
import { asExplanation, type Explanation } from "@/lib/why";
import { getHandling, type HandlingKind, type HandlingState } from "@/services/agroFlowApi";
import {
  getMqttLogins,
  getAdminHardware,
  updateServiceRequestStatusThroughApi,
  errorMessage,
  type AdminHardwareRow,
} from "@/services/agroFlowApi";

import type {
  Kpis, Trends, GrowthSeries, SeriesPoint, SystemHealth, StatusDistribution,
  User, Farm, Hardware, AdminAlert, MaintenanceJob,
  IrrigationSchedule, IrrigationEvent, ActivityEntry,
  Handling, AlertPriority, UserStatus,
  ServiceRequest, ServiceRequestStatus,
} from "@/types/models";

/* real row shapes */


type ZoneRow = { id: number; farm_id: number; name: string | null; crop_type: string | null };
type HardwareRow = {
  hardware_id: number; device_name: string; device_type: string;
  zone_id: number | null; status: string; last_seen: string; created_at: string;
};
type MaintenanceRow = {
  maintenance_id: number; farm_id: number | null; hardware_id: number | null;
  scheduled_date: string | null; description: string; status: string; created_at: string;
};

type ServiceRequestRow = {
  id: number;
  farmer_id: string;
  farm_id: number | null;
  request_type: ServiceRequest["requestType"];
  location: string | null;
  rough_size: number | null;
  crop_type: ServiceRequest["cropType"];
  notes: string | null;
  status: ServiceRequestStatus;
  created_at: string;
  updated_at: string;

  /* Migration 0037. Optional on the type as well as nullable, because without the migration
   * PostgREST does not return them: `undefined` means "no column yet" and `null` means "not
   * done yet". The timeline says something different for each. */
  assigned_to_profile_id?: string | null;
  scheduled_by_profile_id?: string | null;
  scheduled_at?: string | null;
  completed_by_profile_id?: string | null;
  completed_at?: string | null;
};

/**
 * location is one text field ("Region, Province" by convention, as onboardFarmer splits it);
 * farm has no separate province/region column.
 */
function splitLocation(location: string): { province: string; region: string } {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { region: parts[0] ?? location, province: parts[parts.length - 1] ?? location };
  return { region: location, province: location };
}

/* AgroFlow.Api base URL used for backend-only operations. */
const API_BASE = import.meta.env["VITE_AGROFLOW_API_BASE"] ?? "";

async function getAuthorized<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await navigationAwareFetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(errorMessage(await response.text(), response.status));
  }

  return response.json() as Promise<T>;
}
async function fetchFarmNameMap(): Promise<Map<number, string>> {
  const { data, error } = await supabase.from("farm").select("farm_id, name");
  if (error) throw error;
  return new Map((data ?? []).map((f: { farm_id: number; name: string }) => [f.farm_id, f.name]));
}

async function fetchZoneMap(): Promise<Map<number, ZoneRow>> {
  const { data, error } = await supabase.from("zone").select("id, farm_id, name, crop_type");
  if (error) throw error;
  return new Map((data as ZoneRow[] ?? []).map((z) => [z.id, z]));
}


/* Working copies so admin actions last for the session only. Not a replacement for real
 * writes (see the file header). */
let users: User[] = [];
let farms: Farm[] = [];

/* "Show archived" on the Farms page. Archived farms are hidden from the list, reports and
 * automatic reports, but nothing is deleted, so they stay reachable. */
let showArchivedFarms = false;

export function getShowArchivedFarms(): boolean {
  return showArchivedFarms;
}

export function setShowArchivedFarms(value: boolean): void {
  showArchivedFarms = value;
}

/* farm.status has no CHECK constraint and defaults to 'Active' with a capital A, so both
 * spellings exist. We compare case-insensitively instead of rewriting rows (see migration 0036). */
export function isArchived(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "inactive";
}
let hardware: Hardware[] = [];
let alerts: AdminAlert[] = [];
let maintenance: MaintenanceJob[] = [];
let schedules: IrrigationSchedule[] = [];

/**
 * Platform Activity has no table, so this does nothing. Kept so call sites need no change;
 * getActivity() always reports "not implemented".
 */
export function recordActivity(): void {
  // Empty on purpose; see the file header.
}

/* Counts per calendar month for the last twelve months, oldest first, from date strings
 * ("2026-05-14" or a timestamp). Months with none are 0, so a quiet month shows as quiet.
 * Returns [] when no date falls in the window, and the chart says so. */
export function monthlyCounts(dates: (string | null | undefined)[], now = new Date()): SeriesPoint[] {
  const months: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-ZA", { month: "short", timeZone: "UTC" }),
    });
  }
  const counts = new Map(months.map((m) => [m.key, 0]));
  let any = false;
  for (const d of dates) {
    const key = (d ?? "").slice(0, 7);
    if (counts.has(key)) { counts.set(key, (counts.get(key) ?? 0) + 1); any = true; }
  }
  return any ? months.map((m) => ({ label: m.label, value: counts.get(m.key) ?? 0 })) : [];
}

/* Alert severity -> priority. The alert table has no priority column; severity is the
 * honest source. */
function priorityOf(severity: string | null | undefined): AlertPriority {
  switch ((severity ?? "").toLowerCase()) {
    case "critical": return "Critical";
    case "warning": return "High";
    case "info": return "Low";
    default: return "Medium";
  }
}

/* Who is handling what, from the API. An older API or missing migration answers nothing,
 * so every item reads as unclaimed, which is true. */
async function handlingMap(kind: HandlingKind): Promise<Map<string, HandlingState>> {
  try {
    return new Map((await getHandling(kind)).map((h) => [h.id, h]));
  } catch {
    return new Map();
  }
}

function applyHandling(item: Handling, h: HandlingState): void {
  item.handledById = h.handledBy;
  item.handledByName = h.handledByName;
  item.claimedAt = h.claimedAt;
  item.resolvedByName = h.resolvedByName;
  item.resolvedAt = h.resolvedAt;
  item.escalatedAt = h.escalatedAt;
}

export const api = {
  /* reads */
  async getKpis(): Promise<Kpis> {
    const [u, f, h, a, m] = await Promise.all([
      // getFarmerAccounts, not getUsers: "Farmer accounts" must not count the administrators
      // that /api/users also returns.
      api.getFarmerAccounts(), api.getFarms(), api.getHardware(), api.getAlerts(), api.getMaintenance(),
    ]);
    return {
      totalFarms: f.length,
      totalUsers: u.length,
      activeUsers: u.filter((x) => x.status === "Active").length,
      farmersNotReceivingAlerts: u.filter((x) => !x.telegramLinked).length,
      disabledUsers: u.filter((x) => x.status === "Disabled").length,
      connectedHardware: h.filter((x) => x.status === "Online").length,
      totalHardware: h.length,
      activeAlerts: a.filter((x) => !["Resolved", "Closed"].includes(x.status)).length,
      openMaintenance: m.filter((x) => x.status !== "Completed").length,
      // No monitoring table exists for these three (see getSystemHealth()). 0 means "we don't
      // know", not a measurement.
      systemUptime: 0,
      deviceConnectivity: h.length ? Math.round((h.filter((x) => x.status === "Online").length / h.length) * 1000) / 10 : 0,
      platformAvailability: 0,
      newFarmsThisMonth: 0,
      newUsersThisWeek: 0,
    };
  },
  /** No stored history to compare against, so flat, not made up. */
  getTrends(): Promise<Trends> {
    return Promise.resolve({});
  },
  /* New farmers, farms and maintenance jobs per month over the last twelve months, counted
   * from the records. Connectivity stays empty on purpose: kit uptime history is not stored. */
  async getGrowth(): Promise<GrowthSeries> {
    const [users, farmList, jobs] = await Promise.all([
      api.getFarmerAccounts().catch(() => []),
      api.getFarms().catch(() => []),
      api.getMaintenance().catch(() => []),
    ]);
    return {
      users: monthlyCounts(users.map((u) => u.dateJoined)),
      farms: monthlyCounts(farmList.map((f) => f.registered)),
      connectivity: [],
      maintenance: monthlyCounts(jobs.map((m) => m.scheduledFor)),
    };
  },
  /**
   * No monitoring table exists. An empty object means "not implemented"; dashboard.ts shows
   * a labelled placeholder for it.
   */
  getSystemHealth(): Promise<SystemHealth> {
    return Promise.resolve({});
  },
  async getFarmHealthDistribution(): Promise<StatusDistribution> {
    const list = await api.getFarms();
    const dist: StatusDistribution = {};
    for (const f of list) dist[f.health] = (dist[f.health] ?? 0) + 1;
    return dist;
  },
  async getHardwareStatusDistribution(): Promise<StatusDistribution> {
    const list = await api.getHardware();
    const dist: StatusDistribution = {};
    for (const h of list) dist[h.status] = (dist[h.status] ?? 0) + 1;
    return dist;
  },
  /* Farmers only. /api/users also returns administrators for the Assign pickers, but the
   * Farmers page and farmer counts must not include staff. getAdministrators() is the other half. */
  async getFarmerAccounts(): Promise<User[]> {
    return (await api.getUsers()).filter((u) => u.role !== "admin");
  },

  /* The people a request or an alert can be assigned to. */
  async getAdministrators(): Promise<User[]> {
    return (await api.getUsers()).filter((u) => u.role === "admin");
  },

  async getUsers(): Promise<User[]> {
  type ApiUserRow = {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role: string | null;
    created_at: string | null;
    farm_id: number | null;
    farm_name: string | null;
    telegram_linked: boolean;
    telegram_alerts_enabled: boolean;
  };

  const rows = await getAuthorized<ApiUserRow[]>("/api/users");

  users = rows.map((u) => ({
    id: u.id,
    // The email when there is no name: "(no name on file)" does not identify anyone.
    name: u.name || u.email,
    email: u.email,
    role: u.role ?? "farm_user",
    phone: u.phone ?? "",
    farm: u.farm_name ?? "Unassigned",

    // profile has no disabled/status column, so every real account reads as Active. See
    // setUserStatus()'s note.
    status: "Active" as UserStatus,

    /* Real columns, unlike status: a farmer either connected Telegram or did not, which decides
     * whether they get alerts at all. */
    telegramLinked: u.telegram_linked,
    telegramAlerts: u.telegram_alerts_enabled,

    dateJoined: u.created_at?.slice(0, 10) ?? "",

    // auth.users.last_sign_in_at is not exposed through profile/RLS, so there is no real value.
    lastActive: "Unknown",

    hardware: [],
    scheduleIds: [],
    support: [],
    notes: [],
  }));

  return users;
},
  async getFarms(): Promise<Farm[]> {
  type ApiFarmRow = {
    farm_id: number;
    name: string;
    owner_id: string | null;
    owner_name: string | null;
    location: string;
    total_area: number;
    status: string | null;
    updated_at: string | null;
    latitude: number | null;
    longitude: number | null;
  };

  // The API leaves out archived farms unless asked. The toggle is module state, not a filter,
  // because it changes what is fetched: applyFilters cannot bring back rows never sent.
  const rows = await getAuthorized<ApiFarmRow[]>(
    `/api/farms${showArchivedFarms ? "?includeArchived=true" : ""}`,
  );

  farms = rows.map((f) => {
    const { province, region } = splitLocation(f.location);

    return {
      id: f.farm_id,
      name: f.name,
      owner: f.owner_name ?? "Unassigned",
      ownerId: f.owner_id,
      location: f.location,
      latitude: Number.isFinite(f.latitude) ? f.latitude : null,
      longitude: Number.isFinite(f.longitude) ? f.longitude : null,
      province,
      region,
      health: "Attention Required",
      status: (f.status as Farm["status"]) ?? "Active",
      hectares: Number(f.total_area ?? 0),
      registered: f.updated_at?.slice(0, 10) ?? "",
      lastActivity: "Unknown",
      healthFactors: {
        deviceConnectivity: 0,
        gatewayOnline: false,
        sensorsAvailable: 0,
        outstandingAlerts: 0,
        openMaintenance: 0,
      },
      users: 0,
      devices: 0,
    };
  });

  return farms;
},
  async getServiceRequests(): Promise<ServiceRequest[]> {
    const { data, error } = await supabase
      .from("service_request")
      // One string literal on purpose: supabase-js infers the row shape from the select text.
      // The columns after updated_at are the who/when chain from migration 0037.
      .select("id, farmer_id, farm_id, request_type, location, rough_size, crop_type, notes, status, created_at, updated_at, assigned_to_profile_id, scheduled_by_profile_id, scheduled_at, completed_by_profile_id, completed_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as ServiceRequestRow[];
    const farmerIds = [...new Set(rows.map((r) => r.farmer_id))];
    const farmIds = [...new Set(rows.map((r) => r.farm_id).filter((id): id is number => id !== null))];

    const [{ data: farmers, error: farmerError }, { data: farmRows, error: farmError }] =
      await Promise.all([
        farmerIds.length
          ? supabase.from("profile").select("id, name, email, phone").in("id", farmerIds)
          : Promise.resolve({ data: [], error: null }),
        farmIds.length
          ? supabase.from("farm").select("farm_id, name").in("farm_id", farmIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (farmerError) throw farmerError;
    if (farmError) throw farmError;

    /* The admins named in the chain. One `in` query instead of three joins, because the same
     * person usually appears in several columns and rows. */
    const adminIds = [...new Set(
      rows.flatMap((r) => [
        r.assigned_to_profile_id,
        r.scheduled_by_profile_id,
        r.completed_by_profile_id,
      ]).filter((id): id is string => typeof id === "string" && id.length > 0),
    )];

    const adminMap = new Map<string, string>();
    if (adminIds.length > 0) {
      const { data: admins } = await supabase
        .from("profile")
        .select("id, name, email")
        .in("id", adminIds);

      for (const a of (admins ?? []) as { id: string; name: string | null; email: string | null }[]) {
        adminMap.set(a.id, a.name || a.email || "Unknown");
      }
    }

    const farmerMap = new Map(
      (farmers ?? []).map((farmer: { id: string; name: string | null; email: string | null; phone: string | null }) => [
        farmer.id,
        farmer,
      ])
    );

    const farmMap = new Map(
      (farmRows ?? []).map((farm: { farm_id: number; name: string }) => [
        farm.farm_id,
        farm.name,
      ])
    );

    return rows.map((row) => {
      const farmer = farmerMap.get(row.farmer_id);
      const name = farmer?.name?.trim() || "";
      const email = farmer?.email?.trim() || "";
      const phone = farmer?.phone?.trim() || "";

      return {
        id: row.id,
        farmerId: row.farmer_id,
        // The name, else the email, else the phone. With none, the request is named by its id so
        // an admin can see it needs chasing.
        farmerName: name || email || phone || `Request #${row.id}`,
        farmerEmail: email,
        farmerPhone: phone,
        farmerUnidentified: !name && !email && !phone,
        farmId: row.farm_id,
        farmName: row.farm_id === null ? null : farmMap.get(row.farm_id) ?? null,
        requestType: row.request_type,
        location: row.location,
        roughSize: row.rough_size,
        cropType: row.crop_type,
        notes: row.notes,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,

        // The who/when chain. Undefined instead of null when the column is missing (0037 not
        // applied), so the timeline can tell "not recorded" from "not done yet".
        assignedToProfileId: row.assigned_to_profile_id ?? null,
        assignedToName: row.assigned_to_profile_id
          ? adminMap.get(row.assigned_to_profile_id) ?? "Unknown"
          : null,
        scheduledByName: row.scheduled_by_profile_id
          ? adminMap.get(row.scheduled_by_profile_id) ?? "Unknown"
          : null,
        scheduledAt: row.scheduled_at ?? null,
        completedByName: row.completed_by_profile_id
          ? adminMap.get(row.completed_by_profile_id) ?? "Unknown"
          : null,
        completedAt: row.completed_at ?? null,
      };
    });
  },

  /* Through AgroFlow.Api, not straight to Supabase: the server has to know the status
   * changed so it can send the farmer's "your hardware kit is booked" message, and the bot
   * token cannot be in the browser. The RLS policy (0021) and direct route still exist, so an
   * older build of the dashboard keeps working, without the messages. */
  async updateServiceRequestStatus(
    id: number,
    status: ServiceRequestStatus,
    note?: string,
  ): Promise<void> {
    await updateServiceRequestStatusThroughApi(id, status, note);
  },

  async getHardware(): Promise<Hardware[]> {
    // The API adds what RLS cannot: token status and the MQTT login username. It may fail;
    // the table then shows without those columns instead of not at all.
    const [{ data, error }, zoneMap, farmNames, enriched] = await Promise.all([
      supabase.from("hardware").select("hardware_id, device_name, device_type, zone_id, status, last_seen, created_at"),
      fetchZoneMap(),
      fetchFarmNameMap(),
      getAdminHardware().catch((enrichError: unknown) => {
        console.warn("Could not load per-device token / MQTT details:", enrichError);
        return [] as AdminHardwareRow[];
      }),
    ]);
    if (error) throw error;

    const extra = new Map(enriched.map((row) => [String(row.hardwareId), row]));

    hardware = (data as HardwareRow[] ?? []).map((h) => {
      const zone = h.zone_id !== null ? zoneMap.get(h.zone_id) : undefined;
      return {
        id: String(h.hardware_id),
        type: h.device_type,
        farm: zone ? farmNames.get(zone.farm_id) ?? "Unassigned" : "Unassigned",
        province: "",
        // hardware.firmware_version, reported by the board at claim and on every 4-hourly
        // firmware check. Empty until a board on 1.3.0 has called in (column added in 0028).
        firmware: extra.get(String(h.hardware_id))?.firmwareVersion ?? "",
        // No battery/uptime telemetry column exists on hardware.
        battery: null,
        uptimePct: 0,
        status: (h.status as Hardware["status"]) ?? "Offline",
        // enrollment_status is the real lifecycle column. maintenanceState (OK/Due/Overdue/
        // Scheduled) has no real source, so it defaults to OK instead of a made-up signal.
        maintenanceState: "OK",
        installed: h.created_at.slice(0, 10),
        lastSeen: h.last_seen,

        // From the API. Undefined when that call failed; everything treats that as "not known".
        zoneId: h.zone_id,
        deviceId: extra.get(String(h.hardware_id))?.deviceId ?? null,
        zoneName: zone?.name ?? null,
        online: extra.get(String(h.hardware_id))?.online,
        tokenStatus: extra.get(String(h.hardware_id))?.tokenStatus,
        mqttUsername: extra.get(String(h.hardware_id))?.mqttUsername ?? null,
        enrollmentStatus: extra.get(String(h.hardware_id))?.enrollmentStatus,
      };
    });
    return hardware;
  },
  /* Alerts, with the farm and farmer they concern. One query with the zone and farm embedded
   * (two separate selects missed rows past supabase-js's 1000-row cap). The person is the
   * farm's owner from the same join. `raised` stays as the ISO string for sorting and the date
   * filter; the pages format it in SAST. */
  async getAlerts(): Promise<AdminAlert[]> {
    type EmbeddedAlertRow = {
      id: number;
      severity: string;
      message: string;
      status: string | null;
      created_at: string;
      farm: {
        farm_id: number;
        name: string;
        status: string | null;
        owner: { name: string | null; email: string | null } | null;
      } | null;
      zone: {
        id: number;
        name: string | null;
        farm: {
          farm_id: number;
          name: string;
          status: string | null;
          owner: { name: string | null; email: string | null } | null;
        } | null;
      } | null;
    };

    // One string literal: supabase-js infers the row shape from the select text.
    const { data, error } = await supabase
      .from("alert")
      .select("id, severity, message, status, created_at, farm:farm_id(farm_id, name, status, owner:owner_id(name, email)), zone:zone_id(id, name, farm:farm_id(farm_id, name, status, owner:owner_id(name, email)))")
      .order("created_at", { ascending: false });

    if (error) throw error;

    alerts = ((data as unknown as EmbeddedAlertRow[] | null) ?? [])
      // An archived farm's alerts are archived with it, so retired test farms do not raise the
      // Critical and Unassigned counts.
      .filter((a) => !isArchived((a.farm ?? a.zone?.farm)?.status))
      .map((a) => {
        const farm = a.farm ?? a.zone?.farm ?? null;
        const owner = farm?.owner ?? null;

        return {
          id: String(a.id),
          /** ISO, formatted for display by the page; see the note above. */
          raised: a.created_at,
          category: a.severity,
          title: a.message,
          farm: farm?.name ?? null,
          user: owner?.name || owner?.email || null,

          // Who is handling it comes from the API (merged below). Priority comes from the alert's
          // own severity.
          assignedTo: null,
          priority: priorityOf(a.severity),

          status: a.status === "Resolved" ? "Resolved" as const : "New" as const,
          notes: [],
        };
      });

    const handling = await handlingMap("alerts");
    for (const a of alerts) {
      const h = handling.get(a.id);
      if (!h) continue;
      applyHandling(a, h);
      a.assignedTo = h.handledByName;
      if (a.status !== "Resolved") {
        a.status = h.escalatedAt ? "Escalated" : h.handledBy ? "In Progress" : "New";
      }
    }

    return alerts;
  },
  async getMaintenance(): Promise<MaintenanceJob[]> {
    const [{ data, error }, farmNames] = await Promise.all([
      supabase.from("maintenance").select("maintenance_id, farm_id, hardware_id, scheduled_date, description, status, created_at"),
      fetchFarmNameMap(),
    ]);
    if (error) throw error;

    maintenance = (data as MaintenanceRow[] ?? []).map((m) => ({
      id: String(m.maintenance_id),
      device: m.hardware_id !== null ? String(m.hardware_id) : "—",
      deviceType: "",
      farm: m.farm_id !== null ? farmNames.get(m.farm_id) ?? "Unassigned" : "Unassigned",
      province: "",
      issue: m.description,
      priority: "Medium" as AlertPriority,
      technician: null,
      scheduledFor: m.scheduled_date ?? "",
      status: (m.status as MaintenanceJob["status"]) ?? "Pending" as MaintenanceJob["status"],
      completedOn: null,
      reportUploaded: false,
    }));

    // Who is handling each job, and who completed it.
    const handling = await handlingMap("maintenance");
    for (const m of maintenance) {
      const h = handling.get(m.id);
      if (!h) continue;
      applyHandling(m, h);
      m.technician = h.handledByName;
      m.completedOn = h.resolvedAt ? h.resolvedAt.slice(0, 10) : null;
    }
    return maintenance;
  },
  getSchedules(): Promise<IrrigationSchedule[]> {
    // irrigation_schedule was dropped (0010) and schedules are columns on zone, so this stays
    // on the working copy until that redesign is scoped.
    return Promise.resolve(schedules);
  },
  /* Irrigation events, with their farm and an honest volume.
   * 1. One query with the zone and farm embedded, so the farm comes back on the row (separate
   * selects missed rows past supabase-js's 1000-row cap).
   * 2. Litres are runtime_seconds / 60 * flow_rate_lpm (migration 0018), worked out here, not
   * read from estimated_litres. A zone with no flow rate gives null, not 0, so it reads as
   * "no estimate" and not as a pump that delivered nothing.
   * 3. Archived farms are left out of the totals and charts. */
  async getIrrigationEvents(): Promise<IrrigationEvent[]> {
    type EmbeddedRow = {
      id: number;
      started_at: string;
      runtime_seconds: number | null;
      zone: {
        id: number;
        name: string | null;
        crop_type: string | null;
        flow_rate_lpm: number | null;
        status: string | null;
        farm: {
          farm_id: number;
          name: string;
          location: string | null;
          status: string | null;
        } | null;
      } | null;
    };

    // One string literal: supabase-js infers the row shape from the select text.
    const { data, error } = await supabase
      .from("irrigation_event")
      .select("id, started_at, runtime_seconds, zone:zone_id(id, name, crop_type, flow_rate_lpm, status, farm:farm_id(farm_id, name, location, status))")
      .order("started_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    const rows = (data as unknown as EmbeddedRow[] | null) ?? [];

    return rows
      // Archived farms are left out here, not by the page, because applyFilters cannot remove
      // rows from a total the page has already added up.
      .filter((e) => !isArchived(e.zone?.farm?.status))
      .map((e) => {
        const zone = e.zone;
        const farm = zone?.farm ?? null;
        const { province, region } = splitLocation(farm?.location ?? "");

        const runtimeSeconds = Number(e.runtime_seconds ?? 0);
        const flowRate = zone?.flow_rate_lpm;

        return {
          date: e.started_at.slice(0, 10),
          // "No farm on record" instead of "Unassigned": it describes our data and cannot be
          // mistaken for a farm name.
          farm: farm?.name ?? "No farm on record",
          zone: zone?.name ?? (zone ? `Zone ${zone.id}` : "Zone not on record"),
          crop: zone?.crop_type ?? "",
          province,
          region,

          // The formula from 0018, never the stored column. Null when the zone has no flow rate;
          // see the note above.
          litres:
            flowRate === null || flowRate === undefined
              ? null
              : Math.round((runtimeSeconds / 60) * Number(flowRate)),

          durationMin: Math.round(runtimeSeconds / 60),

          // There is no schedule-adherence column, so this cannot be worked out and stays null.
          onSchedule: null,
        };
      });
  },
  /**
   * No activity-log table exists (see recordActivity() above). An empty array means
   * "not implemented".
   */
  getActivity(): Promise<ActivityEntry[]> {
    return Promise.resolve([]);
  },

  /* single lookups */
  findUser(id: string): User | undefined { return users.find((u) => u.id === id); },
  findFarm(id: number): Farm | undefined { return farms.find((f) => f.id === id); },
  findFarmByName(name: string): Farm | undefined { return farms.find((f) => f.name === name); },
  findHardware(id: string): Hardware | undefined { return hardware.find((h) => h.id === id); },
  findAlert(id: string): AdminAlert | undefined { return alerts.find((a) => a.id === id); },

  /* An alert's "Why am I seeing this?" (table explanation, 0039). Null when there is none,
   * including before the migration is applied. */
  async getAlertExplanation(alertId: string): Promise<Explanation | null> {
    const numeric = Number(alertId);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const { data, error } = await supabase
      .from("explanation")
      .select("explanation")
      .eq("alert_id", numeric)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return asExplanation((data as { explanation: unknown }).explanation);
  },
  findMaintenance(id: string): MaintenanceJob | undefined { return maintenance.find((m) => m.id === id); },
  findSchedule(id: number): IrrigationSchedule | undefined { return schedules.find((s) => s.id === id); },

  /* user actions */
  // profile has no "disabled" column, and RLS does not let an admin write other users'
  // profile rows (0011 only grants UPDATE on name/phone to the owner). These change the
  // session-local working copy only; see the file header.
  async setUserStatus(id: string, status: UserStatus): Promise<User[]> {
    const u = users.find((x) => x.id === id);
    if (u) u.status = status;
    return users;
  },
  async updateUser(id: string, patch: Partial<User>): Promise<User[]> {
    const u = users.find((x) => x.id === id);
    if (u) Object.assign(u, patch);
    return users;
  },
  async deleteUser(id: string): Promise<User[]> {
    users = users.filter((x) => x.id !== id);
    return users;
  },
  /* farm actions */
  async approveFarm(id: number): Promise<Farm[]> {
    const f = farms.find((x) => x.id === id);
    if (f) f.status = "Active";
    return farms;
  },
  async setFarmStatus(id: number, status: Farm["status"]): Promise<Farm[]> {
    const f = farms.find((x) => x.id === id);
    if (f) f.status = status;
    return farms;
  },

  /* hardware actions */
  // The real enrollment/claim lifecycle is in
  // backend/AgroFlow.Api/Endpoints/DeviceEnrollmentEndpoints.cs. These change the working
  // copy only: 0011 grants SELECT on hardware, not UPDATE/DELETE.
  async restartDevice(id: string): Promise<Hardware[]> {
    const h = hardware.find((x) => x.id === id);
    if (h) { h.status = "Online"; h.lastSeen = "just now"; }
    return hardware;
  },
  async removeDevice(id: string): Promise<Hardware[]> {
    hardware = hardware.filter((x) => x.id !== id);
    return hardware;
  },
  async replaceDevice(id: string, newId: string): Promise<Hardware[]> {
    const h = hardware.find((x) => x.id === id);
    if (h && newId.trim()) {
      h.id = newId.trim();
      h.status = "Online";
      h.maintenanceState = "OK";
      h.lastSeen = "just now";
    }
    return hardware;
  },

  /* alert actions */
  // 0011 does grant SELECT+UPDATE on alert, and admins have an all-commands policy, so a
  // real write is possible. We keep it on the working copy like the other mutations, because
  // nothing writes real alert rows yet.

  /* maintenance actions */

  /* schedule actions */
  // See getSchedules().
  async updateSchedule(id: number, patch: Partial<IrrigationSchedule>): Promise<IrrigationSchedule[]> {
    const s = schedules.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
    return schedules;
  },
  async deleteSchedule(id: number): Promise<IrrigationSchedule[]> {
    schedules = schedules.filter((s) => s.id !== id);
    return schedules;
  },

  /* reports */
  async logReportGenerated(_name: string): Promise<void> {
    // report/ai_recommendation are not touched here; real report generation is separate.
    return undefined;
  },
};
/* Alert history
 * Every alert and piece of engine advice for one farm's zones, with whether the farmer
 * looked at it. This is how the team checks the alert channel works (read_at, migration 0033).
 * Read-only on purpose: an admin marking a farmer's alert as read would destroy the only
 * evidence of whether the farmer saw it. */

export type AdminAlertHistoryItem = {
  id: string;
  kind: "alert" | "advice";
  zoneName: string;
  message: string;
  severity: string | null;
  createdAt: string;
  /** "New" | "Seen 3 Oct, 14:05" | "Dismissed 3 Oct, 14:05" */
  status: string;
  seen: boolean;
};

function describeSeen(prefix: string, iso: string | null): string {
  if (!iso) return "New";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return prefix;
  return `${prefix} ${d.toLocaleString("en-ZA", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  })}`;
}

export async function getFarmAlertHistory(farmId: number): Promise<AdminAlertHistoryItem[]> {
  const zoneMap = await fetchZoneMap();
  const zoneIds = [...zoneMap.entries()]
    .filter(([, z]) => z.farm_id === farmId)
    .map(([id]) => id);

  if (zoneIds.length === 0) return [];

  const zoneName = (id: number | null): string =>
    id === null ? "Unassigned" : zoneMap.get(id)?.name ?? `Zone ${id}`;

  const items: AdminAlertHistoryItem[] = [];

  // read_at may not exist if 0033 is not applied. A missing column comes back as an error,
  // not an exception, so we fall back to the older columns: the team still sees the alerts,
  // just without the status.
  const withRead = await supabase
    .from("alert")
    .select("id, zone_id, severity, message, status, created_at, read_at")
    .in("zone_id", zoneIds)
    .order("created_at", { ascending: false })
    .limit(200);

  const alertRows = withRead.error
    ? (await supabase
        .from("alert")
        .select("id, zone_id, severity, message, status, created_at")
        .in("zone_id", zoneIds)
        .order("created_at", { ascending: false })
        .limit(200)).data
    : withRead.data;

  for (const a of (alertRows ?? []) as {
    id: number; zone_id: number | null; severity: string | null;
    message: string | null; created_at: string | null; read_at?: string | null;
  }[]) {
    items.push({
      id: `alert-${a.id}`,
      kind: "alert",
      zoneName: zoneName(a.zone_id),
      message: a.message ?? "",
      severity: a.severity,
      createdAt: a.created_at ?? "",
      status: describeSeen("Seen", a.read_at ?? null),
      seen: Boolean(a.read_at),
    });
  }

  const { data: insightRows } = await supabase
    .from("ai_recommendation")
    .select("recommendation_id, zone_id, message, severity, created_at, dismissed_at")
    .in("zone_id", zoneIds)
    .order("created_at", { ascending: false })
    .limit(200);

  for (const r of (insightRows ?? []) as {
    recommendation_id: number; zone_id: number | null; message: string | null;
    severity: string | null; created_at: string | null; dismissed_at: string | null;
  }[]) {
    if (!r.message) continue;
    items.push({
      id: `advice-${r.recommendation_id}`,
      kind: "advice",
      zoneName: zoneName(r.zone_id),
      message: r.message,
      severity: r.severity,
      createdAt: r.created_at ?? "",
      // An insight has no "read": the farmer dismisses it or it expires with the day. Showing
      // "Seen" for an undismissed one would be made up.
      status: describeSeen("Dismissed", r.dismissed_at),
      seen: Boolean(r.dismissed_at),
    });
  }

  return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/* Home's attention queue
 * Each of these fills one card on Home. Separate calls, not one endpoint, so one failing
 * queue leaves the rest of Home working (dashboard.ts catches each one). */

export type ZoneNeedingSetup = {
  zoneId: number;
  zoneName: string;
  farmId: number;
  farmName: string;
  /** Which fields are missing, in plain words. */
  missing: string[];
};

/* Zones the FAO-56 engine cannot fully advise on. Here the farmer gets less than the
 * system can give, and nothing raises it on its own. Read straight from Supabase under RLS,
 * like the rest of the farm data. */
export async function getFarmsNeedingSetup(): Promise<ZoneNeedingSetup[]> {
  const [{ data: zones, error }, farmNames] = await Promise.all([
    supabase
      .from("zone")
      .select("id, name, farm_id, crop_type, planting_date, area_m2, flow_rate_lpm, status"),
    fetchFarmNameMap(),
  ]);

  if (error) throw error;

  const farmCoords = new Map<number, boolean>();
  try {
    const { data } = await supabase.from("farm").select("farm_id, latitude, longitude, status");
    for (const f of (data ?? []) as { farm_id: number; latitude: number | null; longitude: number | null; status: string | null }[]) {
      // Archived farms are not outstanding work.
      if (isArchived(f.status)) continue;
      farmCoords.set(f.farm_id, f.latitude !== null && f.longitude !== null);
    }
  } catch {
    // Coordinates unknown; the other checks below still apply.
  }

  const out: ZoneNeedingSetup[] = [];

  for (const z of (zones ?? []) as {
    id: number; name: string | null; farm_id: number; crop_type: string | null;
    planting_date: string | null; area_m2: number | null; flow_rate_lpm: number | null;
    status: string | null;
  }[]) {
    if (isArchived(z.status)) continue;
    // A zone on a farm that is archived (or that we could not read) is not
    // outstanding work either.
    if (!farmCoords.has(z.farm_id)) continue;

    const missing: string[] = [];
    if (!z.crop_type) missing.push("crop");
    if (!z.planting_date) missing.push("planting date");
    if (z.area_m2 === null) missing.push("area");
    if (z.flow_rate_lpm === null) missing.push("flow rate");
    if (!farmCoords.get(z.farm_id)) missing.push("farm location");

    if (missing.length > 0) {
      out.push({
        zoneId: z.id,
        zoneName: z.name ?? `Zone ${z.id}`,
        farmId: z.farm_id,
        farmName: farmNames.get(z.farm_id) ?? "Unassigned",
        missing,
      });
    }
  }

  return out;
}

export async function getMqttPoolHealth(): Promise<{ freeCount: number; runningLow: boolean }> {
  const pool = await getMqttLogins();
  return { freeCount: pool.freeCount, runningLow: pool.runningLow };
}

/* Reports a farmer asked for that could not be made. The farmer sees "try again later",
 * and without this the team never hears. */
export async function getFailedReportCount(): Promise<number> {
  const { count, error } = await supabase
    .from("report_request")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");

  if (error) throw error;
  return count ?? 0;
}

/* Farms needing attention this week
 * Built from the same stored insights the farmers see (ai_recommendation, explanations
 * included), grouped into a few things an admin acts on. A farm is counted once per group,
 * however many zones or days raised it. */

export type AttentionItem = {
  farmId: number;
  farm: string;
  zone: string;
  message: string;
  day: string;
  explanation: Explanation | null;
};

export type AttentionGroup = {
  key: string;
  label: string;
  farms: number;
  items: AttentionItem[];
};

export const ATTENTION_GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "dry", label: "farms with crops short of water", types: ["water_now", "stress_days"] },
  { key: "over", label: "farms over-watering", types: ["overwatering"] },
  { key: "kits", label: "farms with a kit offline or faulty", types: ["zone_offline", "sensor_stuck", "dht_offline", "sensor_drift"] },
  { key: "pumps", label: "farms where a pump ran with no effect", types: ["watering_failed"] },
  { key: "level", label: "farms with a zone set to water too late", types: ["threshold_unsafe"] },
  { key: "setup", label: "farms with setup to finish", types: ["setup_missing"] },
];

let attentionCache: AttentionGroup[] = [];

export function findAttentionGroup(key: string): AttentionGroup | undefined {
  return attentionCache.find((g) => g.key === key);
}

export async function getAttentionThisWeek(): Promise<AttentionGroup[]> {
  const since = new Date(Date.now() + 2 * 3600_000 - 6 * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("ai_recommendation")
    .select("insight_type, message, data, valid_for, zone:zone_id(name, farm:farm_id(farm_id, name, status))")
    .gte("valid_for", since)
    .is("dismissed_at", null)
    .order("valid_for", { ascending: false });

  if (error) throw error;

  type Row = {
    insight_type: string | null;
    message: string | null;
    data: { explanation?: unknown } | null;
    valid_for: string;
    zone: { name: string | null; farm: { farm_id: number; name: string; status: string | null } | null } | null;
  };

  const rows = ((data as unknown as Row[] | null) ?? [])
    .filter((r) => r.insight_type && r.zone?.farm && !isArchived(r.zone.farm.status));

  attentionCache = ATTENTION_GROUPS.map((g) => {
    const seen = new Set<string>();
    const items: AttentionItem[] = [];
    for (const r of rows) {
      if (!g.types.includes(r.insight_type!)) continue;
      // Newest first, so the first row per zone is the latest one.
      const key = `${r.zone!.farm!.farm_id}:${r.zone!.name}:${r.insight_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        farmId: r.zone!.farm!.farm_id,
        farm: r.zone!.farm!.name,
        zone: r.zone!.name ?? "Zone",
        message: r.message ?? "",
        day: r.valid_for,
        explanation: asExplanation(r.data?.explanation),
      });
    }
    return { key: g.key, label: g.label, farms: new Set(items.map((i) => i.farmId)).size, items };
  });

  return attentionCache;
}
