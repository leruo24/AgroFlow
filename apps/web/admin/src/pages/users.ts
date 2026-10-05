import { api } from "@/data/api";
import { esc, fmtDate } from "@/lib/format";
import { getFilter } from "@/lib/filters";
import { applyFilters } from "@/lib/filters";
import {
  badge, kpiCard, panel, table, pageHeader, filterBar, resultCount,
} from "@/ui/components";
import { Icon } from "@/lib/icons";
import type { User } from "@/types/models";

/** One label per farmer, used by the column, the filter and the CSV so the
    three can never disagree about what "connected" means. */
export function telegramState(u: User): string {
  if (!u.telegramLinked) return "Not connected";
  return u.telegramAlerts ? "Connected" : "Connected, alerts off";
}

/* Deliberately not a subtle icon. A farmer with no Telegram receives nothing
   at all - no weather warning, no equipment failure, no password reset - and
   that is a "somebody has to go and fix this" state, not a decoration. It gets
   the same red treatment the rest of the dashboard uses for faults. */
function telegramCell(u: User): string {
  if (!u.telegramLinked) {
    return `<span class="badge bad" title="This farmer receives no alerts at all until they connect Telegram.">Not connected</span>`;
  }

  if (!u.telegramAlerts) {
    return `<span class="badge warn" title="Connected, but they have muted weather and equipment alerts.">Alerts off</span>`;
  }

  return `<span class="badge good">Connected</span>`;
}

export async function usersPage(): Promise<string> {
  const users = await api.getFarmerAccounts();
  const f = getFilter("users");

  const filtered = applyFilters(users, f, {
    search: (u) => `${u.name} ${u.email} ${u.farm}`,
    date: (u) => u.dateJoined,
    farm: (u) => u.farm,
    status: (u) => u.status,
    telegram: (u) => telegramState(u),
  });

  const total = users.length;
  const active = users.filter((u) => u.status === "Active").length;
  const disabled = users.filter((u) => u.status === "Disabled").length;
  const recent = users.filter((u) => u.dateJoined >= "2026-06-01").length;
  const unlinked = users.filter((u) => !u.telegramLinked).length;

  return `
  ${pageHeader("Users", "Manage platform accounts, access and farm assignment.",
    `<a href="#onboarding" class="btn" data-go="onboarding">+ Onboard Farmer</a>
     <button class="btn ghost" data-act="create-farmer-direct">+ Create Farmer</button>
     <button class="btn ghost" data-act="invite-farmer">+ Invite Farmer</button>`)}

  <div class="grid kpis four">
    ${kpiCard({ label: "Total Users", value: total, icon: Icon.users })}
    ${kpiCard({ label: "New Users", value: recent, trend: { dir: "up", text: "since 1 June" }, icon: Icon.sparkles })}
    ${kpiCard({ label: "Active Users", value: active, icon: Icon.circleCheck })}
    ${unlinked > 0
      ? kpiCard({
          label: "Not Receiving Alerts",
          value: unlinked,
          trend: { dir: "down", text: "Telegram not connected" },
          icon: Icon.userX,
        })
      : kpiCard({ label: "Disabled Users", value: disabled, icon: Icon.userX })}
  </div>

  ${filterBar({
    page: "users",
    filter: f,
    showDateRange: true,
    searchPlaceholder: "Search by name, email or farm…",
    selects: [
      { key: "farm", label: "Assigned farm", options: [...new Set(users.map((u) => u.farm))] },
      { key: "status", label: "Status", options: ["Active", "Disabled", "Pending"] },
      {
        key: "telegram",
        label: "Alerts",
        options: ["Not connected", "Connected", "Connected, alerts off"],
      },
    ],
    rightHtml: `<button class="btn ghost sm" data-act="export-users">Export CSV</button>`,
  })}

  ${panel("User Accounts", "Click a user to open their full profile", resultCount(filtered.length, total, "users"),
    table(["Name", "Email", "Assigned Farm", "Status", "Alerts", "Date Joined", "Actions"], filtered, (u) => [
      `<a href="#" class="row-link" data-act="view-user" data-id="${u.id}">${esc(u.name)}</a>`,
      `<span class="muted">${esc(u.email)}</span>`,
      esc(u.farm),
      badge(u.status),
      telegramCell(u),
      fmtDate(u.dateJoined),
      `<span class="row-act">
        <a href="#" data-act="view-user" data-id="${u.id}">View</a>
        <a href="#" data-act="edit-user" data-id="${u.id}">Edit</a>
        ${u.status === "Disabled"
          ? `<a href="#" data-act="enable-user" data-id="${u.id}">Enable</a>`
          : `<a href="#" data-act="disable-user" data-id="${u.id}">Disable</a>`}
        <a href="#" data-act="reset-password" data-id="${u.id}">Reset</a>
        ${u.telegramLinked
          ? ""
          : `<a href="#" data-act="send-link-code" data-id="${u.id}">Connect</a>`}
        <a href="#" class="danger" data-act="delete-user" data-id="${u.id}">Delete</a>
      </span>`,
    ], "No users match the current filters."))}
  `;
}
