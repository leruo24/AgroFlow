import { getAdminProfile } from "@/app/auth";
import { handlingCell } from "@/ui/patterns";
import { getHandling } from "@/services/agroFlowApi";
import { api } from "@/data/api";
import { badge, pageHeader, panel, resultCount } from "@/ui/components";
import { esc, fmtDateTimeSast } from "@/lib/format";
import type { ServiceRequest, ServiceRequestStatus } from "@/types/models";

const statusOptions: ServiceRequestStatus[] = [
  "pending",
  "scheduled",
  "completed",
];

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

function requestRow(request: ServiceRequest): string {
  const statusSelect = statusOptions
    .map(
      (status) =>
        `<option value="${status}" ${
          request.status === status ? "selected" : ""
        }>${status.charAt(0).toUpperCase()}${status.slice(1)}</option>`,
    )
    .join("");

  return `
    <tr>
      <td>
        <a href="#" class="cell-link" data-act="view-request" data-id="${request.id}">
          <strong>${esc(request.farmerName)}</strong>
        </a>
        ${
          request.farmerEmail
            ? `<div class="muted">${esc(request.farmerEmail)}</div>`
            : ""
        }
      </td>
      <td>${esc(request.farmName ?? "New farm request")}</td>
      <td>${esc(formatRequestType(request.requestType))}</td>
      <td>${esc(formatCrop(request.cropType))}</td>
      <td>${request.roughSize !== null ? `${request.roughSize} ha` : "—"}</td>
      <td>${esc(request.location ?? "—")}</td>
      <td class="cell-clip" title="${esc(request.notes ?? "")}">${esc(request.notes ?? "—")}</td>
      <td>${esc(formatDate(request.createdAt))}</td>
      <td>
        <select
          class="request-status-select"
          data-request-id="${request.id}"
          aria-label="Update request status"
        >
          ${statusSelect}
        </select>
        <div class="request-status-badge">
          ${badge(request.status, statusTone(request.status))}
        </div>
      </td>
      <td>${requestTimeline(request)}</td>
      <td>${handlingCell("requests", request, getAdminProfile()?.id, request.status === "completed")}</td>
      <td>
        ${
          // Only for a SCHEDULED request. Before that there is nothing to
          // install, and afterwards the kit is already claimed - a second
          // code would just be a live credential sitting unused.
          request.status === "scheduled"
            ? request.farmId !== null
              ? `<a href="#" class="row-act" data-act="create-enrollment-code"
                    data-id="${request.id}">Create enrollment code</a>`
              // A new_farm request has no farm, so it has no zone to enrol a
              // kit onto. The existing zone setup flow has to run first; this
              // links there rather than offering an action that cannot work.
              : `<a href="#" class="row-act" data-act="go-onboarding"
                    data-id="${request.id}">Set up the farm and zone first</a>`
            : `<span class="muted">—</span>`
        }
      </td>
    </tr>
  `;
}

export async function requestsPage(): Promise<string> {
  try {
    const requests = await api.getServiceRequests();

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
      ${pageHeader(
        "Farm Requests",
        "Review farmer requests for new farms and irrigation zones.",
      )}

      ${panel(
        "Service requests",
        `${requests.length} request${requests.length === 1 ? "" : "s"} submitted`,
        resultCount(requests.length, requests.length, "requests"),
        `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Farmer</th>
                  <th>Farm</th>
                  <th>Request</th>
                  <th>Crop</th>
                  <th>Size</th>
                  <th>Location</th>
                  <th>Notes</th>
                  <th>Date submitted</th>
                  <th>Status</th>
                  <th>Who and when</th>
                  <th>Handled by</th>
                  <th>Hardware</th>
                </tr>
              </thead>
              <tbody>
                ${
                  requests.length
                    ? requests.map(requestRow).join("")
                    : `
                      <tr>
                        <td colspan="12" class="muted">
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
      ${pageHeader(
        "Farm Requests",
        "Review farmer requests for new farms and irrigation zones.",
      )}

      ${panel(
        "Unable to load requests",
        "The request list could not be retrieved.",
        "",
        `<div class="muted">Please refresh the page and try again.</div>`,
      )}
    `;
  }
}
