import { api } from "@/data/api";
import { esc, fmtDate } from "@/lib/format";
import { getFilter } from "@/lib/filters";
import { applyFilters } from "@/lib/filters";
import { FARM_NAMES } from "@/data/mock";
import {
  badge, kpiCard, panel, table, pageHeader, filterBar, resultCount,
} from "@/ui/components";

export async function usersPage(): Promise<string> {
  const users = await api.getUsers();
  const f = getFilter("users");

  const filtered = applyFilters(users, f, {
    search: (u) => `${u.name} ${u.email} ${u.farm}`,
    date: (u) => u.dateJoined,
    farm: (u) => u.farm,
    status: (u) => u.status,
  });

  const total = users.length;
  const active = users.filter((u) => u.status === "Active").length;
  const disabled = users.filter((u) => u.status === "Disabled").length;
  const recent = users.filter((u) => u.dateJoined >= "2026-06-01").length;

  return `
  ${pageHeader("Users", "Manage platform accounts, access and farm assignment.",
    `<button class="btn" data-act="add-user">+ Add User</button>
     <button class="btn ghost" data-act="create-farmer-direct">+ Create Farmer</button>
     <button class="btn ghost" data-act="invite-farmer">+ Invite Farmer</button>`)}

  <div class="grid kpis four">
    ${kpiCard({ label: "Total Users", value: total, icon: "👥" })}
    ${kpiCard({ label: "New Users", value: recent, trend: { dir: "up", text: "since 1 June" }, icon: "✨" })}
    ${kpiCard({ label: "Active Users", value: active, icon: "✅" })}
    ${kpiCard({ label: "Disabled Users", value: disabled, icon: "🚫" })}
  </div>

  ${filterBar({
    page: "users",
    filter: f,
    showDateRange: true,
    searchPlaceholder: "Search by name, email or farm…",
    selects: [
      { key: "farm", label: "Assigned farm", options: [...FARM_NAMES, "All Farms"] },
      { key: "status", label: "Status", options: ["Active", "Disabled", "Pending"] },
    ],
    rightHtml: `<button class="btn ghost sm" data-act="export-users">Export CSV</button>`,
  })}

  ${panel("User Accounts", "Click a user to open their full profile", resultCount(filtered.length, total, "users"),
    table(["Name", "Email", "Assigned Farm", "Status", "Date Joined", "Actions"], filtered, (u) => [
      `<a href="#" class="row-link" data-act="view-user" data-id="${u.id}">${esc(u.name)}</a>`,
      `<span class="muted">${esc(u.email)}</span>`,
      esc(u.farm),
      badge(u.status),
      fmtDate(u.dateJoined),
      `<span class="row-act">
        <a href="#" data-act="view-user" data-id="${u.id}">View</a>
        <a href="#" data-act="edit-user" data-id="${u.id}">Edit</a>
        ${u.status === "Disabled"
          ? `<a href="#" data-act="enable-user" data-id="${u.id}">Enable</a>`
          : `<a href="#" data-act="disable-user" data-id="${u.id}">Disable</a>`}
        <a href="#" data-act="reset-password" data-id="${u.id}">Reset</a>
        <a href="#" class="danger" data-act="delete-user" data-id="${u.id}">Delete</a>
      </span>`,
    ], "No users match the current filters."))}
  `;
}
