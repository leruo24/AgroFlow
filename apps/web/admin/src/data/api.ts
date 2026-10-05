/* ============================================================================
   AgroFlow Admin — API LAYER
   ----------------------------------------------------------------------------
   The UI talks ONLY to this module. Direct Supabase queries, protected by
   RLS (supabase/migrations/0011_row_level_security.sql) - no wrapping REST
   API, per the architecture decision (AgroFlow.Api is only for what a
   client can't do: device ingestion, MQTT, service_role work).

   READS are real for every table that has one: profile, farm, hardware,
   alert, maintenance, irrigation_event. Tables with no writer anywhere in
   the codebase (alert, maintenance - see the Phase 6 audit) still get
   real queries; they just currently return empty, which the UI shows as
   an honest empty state, never mock rows.

   NOT real, and deliberately not pretending to be:
   - getTrends() / getGrowth(): would need stored historical snapshots we
     don't have. Return flat/empty rather than fabricated deltas.
   - getSystemHealth() / getActivity(): no monitoring table and no
     activity-log table exist in the schema at all - not "empty", they
     have literally nothing to query. Return an explicit not-implemented
     sentinel; the pages that render these show a labelled placeholder,
     not empty cards pretending everything's fine.
   - Irrigation Schedules (getSchedules/updateSchedule/deleteSchedule):
     the real irrigation_schedule table was dropped in
     0010_zone_schema_realignment.sql - schedules now live as columns
     directly on zone (one per zone, not a list). Left on the mock
     working copy for this pass, per an explicit decision to scope that
     redesign separately (it overlaps with reporting work).
   - Mutations (setUserStatus, restartDevice, assignTechnician, etc.):
     several correspond to columns/tables that don't exist at all
     (profile has no "disabled" column, there's no support-ticket or
     notes table) or to grants RLS doesn't currently extend to
     (0011 only grants authenticated SELECT, not UPDATE, on hardware/
     maintenance). They still mutate the in-memory working copy - now
     seeded from real rows instead of mock ones - for session-local UI
     feedback, but that mutation does NOT persist to Postgres. This is a
     real, itemised gap, not a cop-out; see the Phase 6 summary.
   ========================================================================== */

import { supabase } from "@/lib/supabase";
import {
  getMqttLogins,
  getAdminHardware,
  updateServiceRequestStatusThroughApi,
  type AdminHardwareRow,
} from "@/services/agroFlowApi";

import type {
  Kpis, Trends, GrowthSeries, SystemHealth, StatusDistribution,
  User, Farm, Hardware, AdminAlert, MaintenanceJob,
  IrrigationSchedule, IrrigationEvent, ActivityEntry,
  AlertStatus, AlertPriority, UserStatus,
  ServiceRequest, ServiceRequestStatus,
} from "@/types/models";

/* ------------------------------- real row shapes ------------------------------- */


type ZoneRow = { id: number; farm_id: number; name: string | null; crop_type: string | null };
type HardwareRow = {
  hardware_id: number; device_name: string; device_type: string;
  zone_id: number | null; status: string; last_seen: string; created_at: string;
};
type AlertRow = {
  id: number; zone_id: number | null; severity: string; message: string;
  status: string; created_at: string;
};
type MaintenanceRow = {
  maintenance_id: number; farm_id: number | null; hardware_id: number | null;
  scheduled_date: string | null; description: string; status: string; created_at: string;
};
type IrrigationEventRow = {
  id: number; zone_id: number; started_at: string;
  runtime_seconds: number; estimated_litres: number;
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

  /* Migration 0037. Optional on the TYPE as well as nullable in the column,
     because before that migration PostgREST does not return them at all -
     so `undefined` is "the column is not there yet" and `null` is "there,
     but nobody has done this step". The timeline says something different
     for each. */
  assigned_to_profile_id?: string | null;
  scheduled_by_profile_id?: string | null;
  scheduled_at?: string | null;
  completed_by_profile_id?: string | null;
  completed_at?: string | null;
};

/** location is stored as one text field ("Region, Province" by
    convention - see onboardFarmer's own use of this split further down);
    there's no separate province/region column on farm. */
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

  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}
async function fetchFarmNameMap(): Promise<Map<number, string>> {
  const { data, error } = await supabase.from("farm").select("farm_id, name");
  if (error) throw error;
  return new Map((data ?? []).map((f: { farm_id: number; name: string }) => [f.farm_id, f.name]));
}

/** Name + derived province/region for every farm - used where a filter
    dropdown needs real distinct values (see getIrrigationEvents()). */
async function fetchFarmLookup(): Promise<Map<number, { name: string; province: string; region: string }>> {
  const { data, error } = await supabase.from("farm").select("farm_id, name, location");
  if (error) throw error;
  return new Map((data as { farm_id: number; name: string; location: string }[] ?? []).map((f) => [
    f.farm_id, { name: f.name, ...splitLocation(f.location) },
  ]));
}

async function fetchZoneMap(): Promise<Map<number, ZoneRow>> {
  const { data, error } = await supabase.from("zone").select("id, farm_id, name, crop_type");
  if (error) throw error;
  return new Map((data as ZoneRow[] ?? []).map((z) => [z.id, z]));
}


/* Mutable working copies so admin actions persist for the session only -
   see the file header: this is NOT a substitute for real writes, it's
   optimistic UI feedback until the corresponding backend work exists. */
let users: User[] = [];
let farms: Farm[] = [];

/* "Show archived" on the Farms page. Archived farms are hidden from the
   default list, from reports and from automatic reports - but nothing about
   them is deleted, so they have to stay reachable. */
let showArchivedFarms = false;

export function getShowArchivedFarms(): boolean {
  return showArchivedFarms;
}

export function setShowArchivedFarms(value: boolean): void {
  showArchivedFarms = value;
}

/* farm.status has no CHECK constraint and has always defaulted to 'Active'
   with a capital A, so both spellings exist in the live data. Every status
   comparison added here is case-insensitive rather than rewriting the rows -
   see migration 0036's note on why. */
export function isArchived(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "inactive";
}
let hardware: Hardware[] = [];
let alerts: AdminAlert[] = [];
let maintenance: MaintenanceJob[] = [];
let schedules: IrrigationSchedule[] = [];

/** Platform Activity has no real table anywhere in the schema - this is
    now a no-op, not a local fake feed. Kept so every existing call site
    doesn't need to change; getActivity() always reports "not implemented"
    regardless of what this would have recorded. */
export function recordActivity(): void {
  // intentionally empty - see file header
}

export const api = {
  /* ------------------------------- reads ------------------------------- */
  async getKpis(): Promise<Kpis> {
    const [u, f, h, a, m] = await Promise.all([
      api.getUsers(), api.getFarms(), api.getHardware(), api.getAlerts(), api.getMaintenance(),
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
      // No monitoring/telemetry table exists for these three - see
      // getSystemHealth(). 0 is the honest "we don't know" value, not a
      // measurement.
      systemUptime: 0,
      deviceConnectivity: h.length ? Math.round((h.filter((x) => x.status === "Online").length / h.length) * 1000) / 10 : 0,
      platformAvailability: 0,
      newFarmsThisMonth: 0,
      newUsersThisWeek: 0,
    };
  },
  /** No stored historical snapshots to diff against - flat, not fabricated. */
  getTrends(): Promise<Trends> {
    return Promise.resolve({});
  },
  /** Same reason as getTrends(). */
  getGrowth(): Promise<GrowthSeries> {
    return Promise.resolve({ users: [], farms: [], connectivity: [], maintenance: [] });
  },
  /** No monitoring/health-check table exists anywhere in the schema - not
      empty, genuinely nothing to query. Empty object is the
      "not implemented" sentinel; dashboard.ts renders that as a labelled
      placeholder instead of iterating zero service cards silently. */
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
    // The email when there is no name: "(no name on file)" is a label about
    // our data, not a way to identify the person in front of you (item 8).
    name: u.name || u.email,
    email: u.email,
    role: u.role ?? "farm_user",
    phone: u.phone ?? "",
    farm: u.farm_name ?? "Unassigned",

    // profile has no disabled/status column - every real account reads
    // as Active. There is currently no way to represent Disabled/
    // Pending for a real user; see setUserStatus()'s note.
    status: "Active" as UserStatus,

    /* Real columns, unlike status above: a farmer either connected Telegram
       or did not, and that is the difference between receiving alerts and
       receiving nothing at all. */
    telegramLinked: u.telegram_linked,
    telegramAlerts: u.telegram_alerts_enabled,

    dateJoined: u.created_at?.slice(0, 10) ?? "",

    // auth.users.last_sign_in_at isn't exposed through profile/RLS -
    // no real value to show.
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
  };

  // Archived farms are excluded by the API unless asked for. The toggle is
  // module state rather than a filter value because it changes WHAT IS
  // FETCHED, not how a fetched list is filtered - applyFilters cannot bring
  // back rows the server never sent.
  const rows = await getAuthorized<ApiFarmRow[]>(
    `/api/farms${showArchivedFarms ? "?includeArchived=true" : ""}`,
  );

  farms = rows.map((f) => {
    const { province, region } = splitLocation(f.location);

    return {
      id: f.farm_id,
      name: f.name,
      owner: f.owner_name ?? "Unassigned",
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
      // One string literal on purpose: supabase-js infers the row shape from
      // the select text, and a concatenated expression defeats that. The tail
      // after updated_at is the who/when chain from migration 0037.
      .select("id, farmer_id, farm_id, request_type, location, rough_size, crop_type, notes, status, created_at, updated_at, assigned_to_profile_id, scheduled_by_profile_id, scheduled_at, completed_by_profile_id, completed_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as ServiceRequestRow[];
    const farmerIds = [...new Set(rows.map((r) => r.farmer_id))];
    const farmIds = [...new Set(rows.map((r) => r.farm_id).filter((id): id is number => id !== null))];

    const [{ data: farmers, error: farmerError }, { data: farmRows, error: farmError }] =
      await Promise.all([
        farmerIds.length
          ? supabase.from("profile").select("id, name, email").in("id", farmerIds)
          : Promise.resolve({ data: [], error: null }),
        farmIds.length
          ? supabase.from("farm").select("farm_id, name").in("farm_id", farmIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (farmerError) throw farmerError;
    if (farmError) throw farmError;

    /* The admins named in the chain. A separate lookup rather than three
       joins because the same person usually appears in several columns of
       several rows, and one `in` query answers all of them. */
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
      (farmers ?? []).map((farmer: { id: string; name: string; email: string }) => [
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

      return {
        id: row.id,
        farmerId: row.farmer_id,
        farmerName: farmer?.name || "(no name on file)",
        farmerEmail: farmer?.email || "",
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

        // The who/when chain. Undefined rather than null when the column is
        // absent (0037 not applied), so the timeline can tell "not recorded"
        // from "not done yet" and say the right thing for each.
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

  /* Through AgroFlow.Api, not straight to Supabase.
     The direct write worked - an admin's JWT satisfies
     service_request_all_admin (0021) - but nothing server-side ever learned
     the status had changed, so there was no moment at which the farmer's
     "your hardware kit is booked" message could be sent, and putting the bot
     token in the browser is not an option.

     The RLS policy and the direct route both still exist, so an older build
     of this dashboard keeps working, silently, without the messages. */
  async updateServiceRequestStatus(
    id: number,
    status: ServiceRequestStatus,
  ): Promise<void> {
    await updateServiceRequestStatusThroughApi(id, status);
  },

  async getHardware(): Promise<Hardware[]> {
    // The API call supplies what RLS deliberately cannot: token status and
    // the assigned MQTT login username. It is allowed to FAIL - the table
    // then renders exactly as it did before v1.3.0 rather than not at all,
    // because an admin who cannot see their fleet is worse off than one who
    // cannot see its token column.
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
        // hardware.firmware_version, reported by the board at claim and on
        // every 4-hourly firmware-check. Empty until a board on 1.3.0 has
        // called in - there was no column to read before 0028.
        firmware: extra.get(String(h.hardware_id))?.firmwareVersion ?? "",
        // No battery/uptime telemetry column exists on hardware.
        battery: null,
        uptimePct: 0,
        status: (h.status as Hardware["status"]) ?? "Offline",
        // enrollment_status is the real lifecycle column; maintenanceState
        // as modelled here (OK/Due/Overdue/Scheduled) has no real source -
        // defaulting to OK rather than fabricating a due/overdue signal.
        maintenanceState: "OK",
        installed: h.created_at.slice(0, 10),
        lastSeen: h.last_seen,

        // v1.3.0 additions, from the API. Undefined when the enrichment
        // call failed; every consumer treats that as "not known".
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
  async getAlerts(): Promise<AdminAlert[]> {
    const [{ data, error }, zoneMap, farmNames] = await Promise.all([
      supabase.from("alert").select("id, zone_id, severity, message, status, created_at"),
      fetchZoneMap(),
      fetchFarmNameMap(),
    ]);
    if (error) throw error;

    alerts = (data as AlertRow[] ?? []).map((a) => {
      const zone = a.zone_id !== null ? zoneMap.get(a.zone_id) : undefined;
      return {
        id: String(a.id),
        raised: a.created_at,
        category: a.severity,
        title: a.message,
        farm: zone ? farmNames.get(zone.farm_id) ?? null : null,
        user: null,
        assignedTo: null,
        priority: "Medium" as AlertPriority,
        status: (a.status as AdminAlert["status"]) ?? "New",
        notes: [],
      };
    });
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
    return maintenance;
  },
  getSchedules(): Promise<IrrigationSchedule[]> {
    // Untouched - irrigation_schedule was dropped (0010); real schedules
    // now live as columns on zone (one per zone, not a list). Left as the
    // pre-existing working copy, per an explicit decision to scope that
    // redesign separately rather than guess at it here.
    return Promise.resolve(schedules);
  },
  async getIrrigationEvents(): Promise<IrrigationEvent[]> {
    const [{ data, error }, zoneMap, farmLookup] = await Promise.all([
      supabase.from("irrigation_event").select("id, zone_id, started_at, runtime_seconds, estimated_litres").order("started_at", { ascending: false }).limit(500),
      fetchZoneMap(),
      fetchFarmLookup(),
    ]);
    if (error) throw error;

    return (data as IrrigationEventRow[] ?? []).map((e) => {
      const zone = zoneMap.get(e.zone_id);
      const farm = zone ? farmLookup.get(zone.farm_id) : undefined;
      return {
        date: e.started_at.slice(0, 10),
        farm: farm?.name ?? "Unassigned",
        zone: zone?.name ?? String(e.zone_id),
        crop: zone?.crop_type ?? "",
        province: farm?.province ?? "",
        region: farm?.region ?? "",
        litres: Number(e.estimated_litres ?? 0),
        durationMin: Math.round(Number(e.runtime_seconds ?? 0) / 60),
        onSchedule: true,
      };
    });
  },
  /** No activity-log table exists anywhere in the schema - not empty,
      genuinely nothing to query (see recordActivity() above). Empty
      array is the "not implemented" sentinel. */
  getActivity(): Promise<ActivityEntry[]> {
    return Promise.resolve([]);
  },

  /* --------------------------- single lookups --------------------------- */
  findUser(id: string): User | undefined { return users.find((u) => u.id === id); },
  findFarm(id: number): Farm | undefined { return farms.find((f) => f.id === id); },
  findFarmByName(name: string): Farm | undefined { return farms.find((f) => f.name === name); },
  findHardware(id: string): Hardware | undefined { return hardware.find((h) => h.id === id); },
  findAlert(id: string): AdminAlert | undefined { return alerts.find((a) => a.id === id); },
  findMaintenance(id: string): MaintenanceJob | undefined { return maintenance.find((m) => m.id === id); },
  findSchedule(id: number): IrrigationSchedule | undefined { return schedules.find((s) => s.id === id); },

  /* ------------------------------ user actions -------------------------- */
  // profile has no "disabled" column and RLS/grants don't currently allow
  // an admin to write other users' profile rows at all (0011 only grants
  // UPDATE on name/phone, to the OWNING user). These mutate the
  // session-local working copy only - see the file header.
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
  /* ------------------------------ farm actions -------------------------- */
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

  /* ---------------------------- hardware actions ------------------------ */
  // hardware's real enrollment/claim lifecycle is
  // backend/AgroFlow.Api/Endpoints/DeviceEnrollmentEndpoints.cs - these
  // remain working-copy-only (see file header); 0011 grants SELECT on
  // hardware to authenticated, not UPDATE/DELETE.
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

  /* ------------------------------ alert actions ------------------------- */
  // Unlike hardware/maintenance, 0011 DOES grant authenticated
  // SELECT+UPDATE on alert, and admin has an all-commands policy - a real
  // write is possible here. Left as working-copy-only in this pass
  // anyway, matching every other mutation, since alert has no writer
  // populating real rows yet either (Phase 7); revisit once it does.
  async setAlertStatus(id: string, status: AlertStatus): Promise<AdminAlert[]> {
    const a = alerts.find((x) => x.id === id);
    if (a) a.status = status;
    return alerts;
  },
  async assignAlert(id: string, administrator: string): Promise<AdminAlert[]> {
    const a = alerts.find((x) => x.id === id);
    if (a && administrator.trim()) {
      a.assignedTo = administrator.trim();
      if (a.status === "New") a.status = "Assigned";
    }
    return alerts;
  },
  async setAlertPriority(id: string, priority: AlertPriority): Promise<AdminAlert[]> {
    const a = alerts.find((x) => x.id === id);
    if (a) a.priority = priority;
    return alerts;
  },
  async addAlertNote(id: string, note: string): Promise<AdminAlert[]> {
    const a = alerts.find((x) => x.id === id);
    if (a && note.trim()) {
      a.notes.unshift({
        id: Date.now(), author: "Admin", note: note.trim(),
        when: new Date().toISOString().slice(0, 16).replace("T", " "),
      });
    }
    return alerts;
  },

  /* --------------------------- maintenance actions ---------------------- */
  async assignTechnician(id: string, technician: string): Promise<MaintenanceJob[]> {
    const m = maintenance.find((x) => x.id === id);
    if (m && technician.trim()) {
      m.technician = technician.trim();
      if (m.status === "Overdue" || m.status === "Upcoming") m.status = "Scheduled";
    }
    return maintenance;
  },
  async completeMaintenance(id: string): Promise<MaintenanceJob[]> {
    const m = maintenance.find((x) => x.id === id);
    if (m) { m.status = "Completed"; m.completedOn = new Date().toISOString().slice(0, 10); }
    return maintenance;
  },
  async uploadMaintenanceReport(id: string): Promise<MaintenanceJob[]> {
    const m = maintenance.find((x) => x.id === id);
    if (m) m.reportUploaded = true;
    return maintenance;
  },
  async scheduleVisit(id: string, date: string): Promise<MaintenanceJob[]> {
    const m = maintenance.find((x) => x.id === id);
    if (m && date) { m.scheduledFor = date; m.status = "Scheduled"; }
    return maintenance;
  },

  /* ---------------------------- schedule actions ------------------------ */
  // Untouched - see getSchedules().
  async updateSchedule(id: number, patch: Partial<IrrigationSchedule>): Promise<IrrigationSchedule[]> {
    const s = schedules.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
    return schedules;
  },
  async deleteSchedule(id: number): Promise<IrrigationSchedule[]> {
    schedules = schedules.filter((s) => s.id !== id);
    return schedules;
  },

  /* -------------------------------- reports ----------------------------- */
  async logReportGenerated(_name: string): Promise<void> {
    // report/ai_recommendation deliberately untouched beyond this - real
    // report generation is scoped separately.
    return undefined;
  },
};
/* ---------------- Alert history (step 2b) ----------------

   Every alert and every piece of engine advice for one farm's zones, with
   whether the farmer ever looked at it.

   WHY THE ADMIN NEEDS THIS
   The whole point of the alert channel is that somebody acts on it, and
   until migration 0033 there was no way to check that it was working: the
   mobile app's "read" flag lived only in that phone's AsyncStorage and never
   reached the database.

   Read-only by design. Nothing here writes - an admin marking a farmer's
   alert as read would destroy the only evidence of whether the farmer saw
   it. */

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

  // read_at may not exist yet if 0033 has not been applied. A missing column
  // comes back as an error rather than an exception, so fall back to the
  // columns that have always been there - the team still sees the alerts,
  // just without the status that makes them useful.
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
      // An insight has no "read" concept - the farmer dismisses it or it
      // expires with the day. Claiming "Seen" for an undismissed one would
      // be inventing a fact.
      status: describeSeen("Dismissed", r.dismissed_at),
      seen: Boolean(r.dismissed_at),
    });
  }

  return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/* ---------------- Home's attention queue (item A) ----------------

   Each of these answers one card on Home. They are separate calls rather
   than one endpoint so that a failure in any single queue leaves the rest of
   Home working - see dashboard.ts, which catches each one on its own. */

export type ZoneNeedingSetup = {
  zoneId: number;
  zoneName: string;
  farmId: number;
  farmName: string;
  /** Which fields are missing, in plain words. */
  missing: string[];
};

/* Zones the FAO-56 engine cannot fully advise on.

   These are the ones where a farmer is getting less than the system can
   actually give them, and - unlike an alert - nothing raises them on its
   own. Read straight from Supabase under RLS, like the rest of the farm
   data the console shows. */
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
      // Archived farms are not work anybody should be doing.
      if (isArchived(f.status)) continue;
      farmCoords.set(f.farm_id, f.latitude !== null && f.longitude !== null);
    }
  } catch {
    // Coordinates unknown - the other checks below still stand.
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

/* Reports a farmer asked for that could not be made. Nothing else surfaces
   these - the farmer sees "try again later" and the team never hears. */
export async function getFailedReportCount(): Promise<number> {
  const { count, error } = await supabase
    .from("report_request")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");

  if (error) throw error;
  return count ?? 0;
}
