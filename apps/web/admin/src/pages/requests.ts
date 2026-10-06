import { getAdminProfile } from "@/app/auth";
import { handlingCell, errorState } from "@/ui/patterns";
import { getHandling, getEnquiries, type Enquiry } from "@/services/agroFlowApi";
import { enquiriesTable, isCallbackDue } from "@/pages/enquiries";
import { api } from "@/data/api";
import { badge, pageHeader, panel, resultCount } from "@/ui/components";
import { esc, fmtDateTimeSast } from "@/lib/format";
import type { ServiceRequest, ServiceRequestStatus } from "@/types/models";

function formatRequestType(type: ServiceRequest["requestType"]): string {
  return type === "new_farm" ? "New farm" : "New zone";
}

export function formatCrop(crop: ServiceRequest["cropType"]): string {
  return crop.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusTone(status: ServiceRequestStatus): "good" | "warn" | "neutral" {
  if (status === "completed") return "good";
  if (status === "scheduled") return "warn";
  return "neutral";
}

/* The who/when chain as a timeline.
 *
 * Built from service_request's own columns rather than from the audit log,
 * because this is the CURRENT state of one request - "scheduled by Leruo on
 * Tuesday" - and the audit log is the history of changes to it. Both exist;
 * they answer different questions, and reading the chain off the row is one
 * query instead of one per request.
 *
 * Steps that have not happened yet are still shown, greyed, so the shape of
 * the whole process is visible rather than only the parts already done. */
export function requestTimeline(r: ServiceRequest): string {
  const step = (
    label: string,
    who: string | null | undefined,
    when: string | null | undefined,
    done: boolean,
  ): string => `
    <li class="timeline-item${done ? "" : " is-pending"}">
      <span class="timeline-dot" aria-hidden="true"></span>
      <div>
        <b>${esc(label)}${who ? ` by ${esc(who)}` : ""}</b>
        <span class="timeline-when">${
          when ? esc(fmtDateTimeSast(when)) : done ? "time not recorded" : "not yet"
        }</span>
      </div>
    </li>`;

  return `<ol class="timeline">
    ${step("Submitted", r.farmerName, r.createdAt, true)}
    ${r.assignedToName ? step("Assigned", r.assignedToName, null, true) : ""}
    ${step("Scheduled", r.scheduledByName, r.scheduledAt, r.status !== "pending")}
    ${step("Completed", r.completedByName, r.completedAt, r.status === "completed")}
  </ol>`;
}

/* Item 6c: what can be done next, in one place - the row and the side panel
   both use it. [I'll handle this] lives in the Handled by cell; once it is
   yours, this offers [Mark complete] and the step that carries the request
   out: the register-farm wizard for a new farm, Add zones for a new zone
   (each prefilled from the request, and saving it completes the request). */
export function requestActions(request: ServiceRequest, myId: string | undefined): string {
  if (request.status === "completed") {
    return `<span class="muted">Completed${request.completedByName ? ` by ${esc(request.completedByName)}` : ""}${
      request.completedAt ? `, ${esc(fmtDateTimeSast(request.completedAt))}` : ""}</span>`;
  }
  if (!myId || request.handledById !== myId) {
    return `<span class="muted">${request.handledByName ? "—" : "Take it on first"}</span>`;
  }

  const setUp = request.requestType === "new_farm"
    ? `<a href="#" class="row-act" data-act="request-setup" data-id="${request.id}">Set up the farm</a>`
    : request.farmId !== null
      ? `<a href="#" class="row-act" data-act="request-setup" data-id="${request.id}">Add the zone</a>`
      : "";

  // A kit can only be enrolled onto a zone that exists, so only once the
  // request has a farm.
  const code = request.farmId !== null
    ? `<a href="#" class="row-act" data-act="create-enrollment-code" data-id="${request.id}">Create enrollment code</a>`
    : "";

  return `<div class="row-actions">
    <button type="button" class="btn ghost" data-act="request-complete" data-id="${request.id}">Mark complete</button>
    ${setUp}${code}
  </div>`;
}

function requestRow(request: ServiceRequest, myId: string | undefined): string {
  const size = request.roughSize !== null ? `${request.roughSize} ha` : null;
  const what = [formatCrop(request.cropType), size, request.location].filter(Boolean).join(" · ");

  return `
    <tr>
      <td>
        <a href="#" class="cell-link" data-act="view-request" data-id="${request.id}">
          <strong>${esc(request.farmerName)}</strong>
        </a>
        ${
          request.farmerEmail && request.farmerEmail !== request.farmerName
            ? `<div class="muted">${esc(request.farmerEmail)}</div>`
            : ""
        }
      </td>
      <td>
        ${badge(formatRequestType(request.requestType), "neutral")}
        <div class="muted">${esc(what)}</div>
      </td>
      <td>${request.farmName ? esc(request.farmName) : `<span class="muted">—</span>`}</td>
      <td>${esc(formatDate(request.createdAt))}</td>
      <td>${badge(request.status, statusTone(request.status))}</td>
      <td>${handlingCell("requests", request, myId, request.status === "completed")}</td>
      <td>${requestActions(request, myId)}</td>
    </tr>
  `;
}

/* Item 6c: two tabs - the farmers' own requests, and enquiries from people
   who are not on AgroFlow yet. Remembered for the session, not stored. */
let activeTab: "requests" | "enquiries" = "requests";

export function setRequestsTab(tab: string): void {
  activeTab = tab === "enquiries" ? "enquiries" : "requests";
}

/* What needs a person on the Enquiries tab: nobody has it yet, or a
   call-back is due. The same count as the sidebar badge. */
export function enquiriesNeedingAction(rows: Enquiry[], now = Date.now()): number {
  return rows.filter((e) => e.status === "new" || isCallbackDue(e, now)).length;
}

export async function requestsPage(): Promise<string> {
  try {
    const [requests, enquiries] = await Promise.all([
      api.getServiceRequests(),
      // Allowed to fail: without migration 0044 there are simply none.
      getEnquiries().catch(() => [] as Enquiry[]),
    ]);
    const myId = getAdminProfile()?.id;
    const pending = requests.filter((r) => r.status === "pending").length;
    const needing = enquiriesNeedingAction(enquiries);

    const tabs = `<div class="req-tabs" role="tablist" aria-label="Requests">
      <button type="button" role="tab" class="req-tab${activeTab === "requests" ? " active" : ""}"
        aria-selected="${activeTab === "requests"}" data-act="requests-tab" data-tab="requests">
        Farm and zone requests${pending ? ` <span class="nav-badge">${pending}</span>` : ""}
      </button>
      <button type="button" role="tab" class="req-tab${activeTab === "enquiries" ? " active" : ""}"
        aria-selected="${activeTab === "enquiries"}" data-act="requests-tab" data-tab="enquiries">
        Enquiries${needing ? ` <span class="nav-badge">${needing}</span>` : ""}
      </button>
    </div>`;

    if (activeTab === "enquiries") {
      return `
        ${pageHeader("Requests", "Farmers' requests, and people asking about AgroFlow.")}
        ${tabs}
        ${panel(
          "Enquiries",
          `${enquiries.length} enquir${enquiries.length === 1 ? "y" : "ies"} - from the website and the app's login screen`,
          resultCount(enquiries.length, enquiries.length, "enquiries"),
          enquiriesTable(enquiries, myId),
        )}`;
    }

    // Item 5: who is handling each request (from the API; nothing if 0041
    // is not applied, which is true - nobody can have claimed one).
    const handling = await getHandling("requests").catch(() => []);
    for (const h of handling) {
      const r = requests.find((x) => String(x.id) === h.id);
      if (!r) continue;
      r.handledById = h.handledBy;
      r.handledByName = h.handledByName;
      r.claimedAt = h.claimedAt;
    }

    return `
      ${pageHeader("Requests", "Farmers' requests, and people asking about AgroFlow.")}
      ${tabs}

      ${panel(
        "Service requests",
        `${requests.length} request${requests.length === 1 ? "" : "s"} submitted`,
        resultCount(requests.length, requests.length, "requests"),
        `
          <div class="table-wrap">
            <table class="requests-table">
              <thead>
                <tr>
                  <th>Farmer</th>
                  <th>Request</th>
                  <th>Farm</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Handled by</th>
                  <th>Next</th>
                </tr>
              </thead>
              <tbody>
                ${
                  requests.length
                    ? requests.map((r) => requestRow(r, myId)).join("")
                    : `
                      <tr>
                        <td colspan="7" class="muted">
                          No farm requests have been submitted yet.
                        </td>
                      </tr>
                    `
                }
              </tbody>
            </table>
          </div>
        `,
      )}
    `;
  } catch (error) {
    console.error("Failed to load farm requests:", error);

    return `
      ${pageHeader("Requests", "Farmers' requests, and people asking about AgroFlow.")}

      ${errorState({
        title: "Requests could not be loaded",
        detail: error instanceof Error ? error.message : "The request list could not be retrieved.",
      })}
    `;
  }
}
