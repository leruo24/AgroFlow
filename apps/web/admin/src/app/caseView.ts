/* The installation case (Part B, AF-09, AF-24, B3-03): one drawer that links the enquiry, the
 * farmer, the farm and its zones, the visits, the installer checklist, the help requests and the
 * service status, with "Where you are now" at the top. Every state comes from the API
 * (GET /api/admin/farms/{id}/case); nothing here works a stage out by itself.
 *
 * Actions are buttons with data-act="case-…"; app/interactions.ts hands them to handleCaseAction. */
import { openDrawer } from "@/lib/drawer";
import { esc, fmtDateTimeSast } from "@/lib/format";
import { toast } from "@/lib/toast";
import { plainError } from "@/lib/plainError";
import { KIT_GUIDE_PATH } from "@/ui/kitSetupCard";
import {
  bookVisit, getCase, recordCheck, resolveHelpRequest, setZoneModeAsStaff, updateCase, updateVisit,
  type JourneyCheck, type ServiceCase,
} from "@/services/agroFlowApi";

const WHO: Record<string, string> = { you: "The farmer", agroflow_staff: "AgroFlow staff", installer: "The installer" };
const TOPIC: Record<string, string> = {
  location: "Farm location", water_source: "Water source", tank_capacity: "Tank size", tank_level: "Tank level",
  crop: "Crop", planting_date: "Planting date", irrigation_type: "Irrigation type", soil_type: "Soil type", area: "Field size", other: "Other",
};
const SERVICE: [string, string][] = [
  ["not_agreed", "Not agreed yet"], ["sponsored", "Sponsored"], ["paying", "Active (paid service)"],
  ["trial", "Trial"], ["paused", "Paused"], ["ended", "Ended"],
];

let openFarmId: number | null = null;
let staffList: { id: string; name: string }[] = [];

/* staff: who can own the case (the console's staff accounts). */
export async function openCaseDrawer(farmId: number, staff?: { id: string; name: string }[]): Promise<void> {
  openFarmId = farmId;
  if (staff) staffList = staff;
  let c: ServiceCase;
  try {
    c = await getCase(farmId);
  } catch (e) {
    toast(plainError(e, "The case could not be loaded."), "warn");
    return;
  }
  if (openFarmId !== farmId) return;
  openDrawer({
    title: `Case · ${c.farmName}`,
    subtitle: "Enquiry, farmer, farm, visits, kits and service in one place.",
    wide: true,
    bodyHtml: caseHtml(c),
  });
}

function section(title: string, body: string, testId?: string): string {
  return `<div class="drawer-section"${testId ? ` data-testid="${testId}"` : ""}><h6>${esc(title)}</h6>${body}</div>`;
}

export function caseHtml(c: ServiceCase): string {
  const w = c.journey.whereYouAreNow;
  const where = `
    <p data-case-stage="${esc(w.stage)}"><b>${esc(w.stageLabel)}</b> <span class="muted">(stage ${w.stageNumber} of ${w.stageCount})</span></p>
    <div class="detail-list">
      <div class="detail-row"><span>Next</span><b data-case-next>${esc(w.nextAction)}</b></div>
      <div class="detail-row"><span>Who acts next</span><b>${esc(WHO[w.whoActsNext] ?? w.whoActsNextLabel)}</b></div>
      <div class="detail-row"><span>Date</span><b data-case-date>${w.knownDate ? esc(fmtDateTimeSast(w.knownDate)) : esc(w.dateLabel)}</b></div>
      <div class="detail-row"><span>Farmer's details</span><b>${esc(c.journey.setupProgress.label)}</b></div>
      <div class="detail-row"><span>Installation</span><b>${esc(c.journey.installation.text)}</b></div>
    </div>
    <ul class="drawer-list">${w.steps.map((s) => `<li>${s.done ? "✓" : "○"} ${esc(s.label)}</li>`).join("")}</ul>`;

  const linked = `
    <div class="detail-list">
      <div class="detail-row"><span>Enquiry</span><b>${c.enquiry ? `#${c.enquiry.id} ${esc(c.enquiry.name ?? "")} · ${esc(c.enquiry.status ?? "")}` : "None linked"}</b></div>
      <div class="detail-row"><span>Farmer</span><b>${c.farmer ? `${esc(c.farmer.name ?? "")}${c.farmer.passwordChanged ? "" : " · still on the temporary password"}` : "No account yet"}</b></div>
      <div class="detail-row"><span>Terms</span><b>${c.journey.terms.accepted.all ? `Accepted ${esc(fmtDateTimeSast(c.journey.terms.accepted.termsAcceptedAt))}` : "Not accepted yet"}</b></div>
    </div>`;

  const owner = `
    <label class="f">Owner (staff)
      <select data-field="caseOwnerId">
        <option value="">Nobody yet</option>
        ${[...staffList, ...(c.owner && !staffList.some((x) => x.id === c.owner!.id) ? [{ id: c.owner.id, name: c.owner.name ?? c.owner.id }] : [])]
          .map((x) => `<option value="${esc(x.id)}"${x.id === c.owner?.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}
      </select>
      <small class="field-note">${c.owner ? "Help requests go to the owner." : "Nobody owns this case yet: help requests go to whoever onboarded the farm."}</small>
    </label>
    <label class="f">Next action<input type="text" maxlength="300" data-field="caseNextAction" value="${esc(c.nextAction ?? "")}" placeholder="e.g. Call to confirm the tank size" /></label>
    <label class="f">Follow up on<input type="datetime-local" data-field="caseFollowUp" value="${esc(localInput(c.followUpAt))}" /></label>
    <label class="f">Service
      <select data-field="caseServiceStatus">${SERVICE.map(([v, l]) => `<option value="${v}"${v === c.service.status ? " selected" : ""}>${l}</option>`).join("")}</select>
    </label>
    <label class="f">Who pays<input type="text" maxlength="120" data-field="casePayer" value="${esc(c.service.payer ?? "")}" placeholder="e.g. Sponsored by the Edge Centre" /></label>
    <label class="f">Plan<input type="text" maxlength="500" data-field="casePlan" value="${esc(c.service.planDescription ?? "")}" placeholder="What the farmer receives" /></label>
    <label class="f"><input type="checkbox" data-field="caseAgreed"${c.service.agreedAt ? " checked" : ""} /> The farmer agreed the service${c.service.agreedAt ? ` (${esc(fmtDateTimeSast(c.service.agreedAt))})` : ""}</label>
    <button class="btn sm" data-act="case-save" data-id="${c.farmId}">Save case</button>`;

  const visits = `
    ${c.visits.length ? `<ul class="drawer-list">${c.visits.map((v) => `<li data-visit="${v.id}">
        <b>${esc(fmtDateTimeSast(v.scheduledFor))}</b> · ${esc(v.installerName)} · ${esc(v.kind.replace("_", " "))} · <b>${esc(v.status.replace("_", " "))}</b>
        ${v.status === "booked" ? ` <button class="btn ghost sm" data-act="case-visit-start" data-id="${v.id}">Start</button> <button class="btn ghost sm" data-act="case-visit-cancel" data-id="${v.id}">Cancel</button>` : ""}
        ${v.status === "in_progress" ? ` <button class="btn ghost sm" data-act="case-visit-done" data-id="${v.id}">Finished</button>` : ""}
      </li>`).join("")}</ul>` : `<p class="muted">No visit booked yet.</p>`}
    <div class="grid split-2">
      <label class="f">Date and time<input type="datetime-local" data-field="visitWhen" /></label>
      <label class="f">Installer's name<input type="text" data-field="visitInstaller" placeholder="Who will visit" /></label>
    </div>
    <label class="f">Notes (optional)<input type="text" data-field="visitNotes" maxlength="1000" /></label>
    <button class="btn sm" data-act="case-book-visit" data-id="${c.farmId}">${c.visits.some((v) => v.kind === "first_installation") ? "Book a visit" : "Book first installation"}</button>
    <p class="muted">A first installation needs no kit: the farm, a date and the installer are enough.</p>`;

  const checklist = (c.journey.zones.map((z) => `
    <div class="drawer-subsection" data-case-zone="${z.zoneId}">
      <p><b>${esc(z.name)}</b> · ${esc(z.commissionState === "legacy" ? "In use before the checklist" : z.commissionState === "commissioned" ? `Commissioned ${esc(fmtDateTimeSast(z.commissionedAt))}` : "Not commissioned yet")}
        · mode <b>${esc(z.irrigationMode)}</b>
        <button class="btn ghost sm" data-act="case-mode" data-id="${z.zoneId}" data-mode="${z.irrigationMode === "manual" ? "automatic" : "manual"}">Switch to ${z.irrigationMode === "manual" ? "automatic" : "manual"}</button></p>
      ${z.commissionState === "legacy" ? "" : `<div class="table-wrap"><table><thead><tr><th>Check</th><th>Status</th><th>Who / when</th><th>Record</th></tr></thead><tbody>
        ${z.installerChecks.map((k) => checkRow(z.zoneId, k)).join("")}
      </tbody></table></div>`}
    </div>`).join("") || `<p class="muted">This farm has no zones.</p>`) +
    `<p class="muted" data-case-kit-help>Changing Wi-Fi later needs no new code: the farmer uses Kit → Change Wi-Fi or switches the kit off and on 3 times. Moving or fully resetting a kit (5 times) needs a new enrollment code. <a href="${KIT_GUIDE_PATH}" target="_blank" rel="noopener">Printable guide: reconnect or reset the kit</a></p>`;

  const help = c.journey.helpRequests.length
    ? `<ul class="drawer-list">${c.journey.helpRequests.map((h) => `<li data-help="${h.id}">
        <b>${esc(TOPIC[h.topic] ?? h.topic)}</b> · ${esc(fmtDateTimeSast(h.createdAt))} · ${h.status === "open" ? `owner: ${esc(h.ownerName ?? "nobody yet")}` : `resolved ${esc(fmtDateTimeSast(h.resolvedAt))}`}
        ${h.note ? `<br><span class="muted">${esc(h.note)}</span>` : ""}
        ${h.status === "open" ? ` <button class="btn ghost sm" data-act="case-help-resolve" data-id="${h.id}">Mark resolved</button>` : ""}
      </li>`).join("")}</ul>`
    : `<p class="muted">The farmer has not asked for help.</p>`;

  return [
    section("Where you are now", where, "case-where"),
    section("Linked records", linked),
    section("Owner, next action and service", owner),
    section("Visits", visits, "case-visits"),
    section("Installer checklist", checklist, "case-checklist"),
    section(`"I don't know – help me" (${c.journey.helpRequests.filter((h) => h.status === "open").length} open)`, help, "case-help"),
  ].join("");
}

function checkRow(zoneId: number, k: JourneyCheck): string {
  const status = k.done ? `✓ ${esc(k.value ?? "Done")}${k.provenance ? ` <span class="muted">(${esc(k.provenance.replace("_", " "))})</span>` : ""}` : "To do";
  const who = k.doneBy ? `${esc(k.doneBy)} · ${esc(fmtDateTimeSast(k.doneAt))}` : k.done ? "From the kit" : "—";
  const input = k.item === "flow_measured"
    ? `<input type="number" step="0.1" min="0.1" data-field="flow_${zoneId}" placeholder="L/min" style="width:6em" />
       <select data-field="flowProv_${zoneId}"><option value="measured">measured</option><option value="estimated">estimated</option></select>`
    : k.item === "run_limit" ? `<input type="number" min="1" max="120" data-field="maxRun_${zoneId}" placeholder="min" style="width:5em" />` : "";
  return `<tr data-check="${zoneId}-${k.item}">
    <td>${esc(k.label)}${k.required ? "" : ` <span class="muted">(not needed to commission)</span>`}</td>
    <td>${status}</td><td>${who}</td>
    <td>${input}<button class="btn ghost sm" data-act="case-check" data-id="${zoneId}" data-item="${k.item}">Record</button></td>
  </tr>`;
}

function localInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function field(name: string): string {
  return document.querySelector<HTMLInputElement | HTMLSelectElement>(`#drawerPanel [data-field="${name}"]`)?.value?.trim() ?? "";
}

/* One case action. Saves first; the drawer is drawn again from the server's answer, so what it
 * shows is always what was saved. A button is disabled while its request is out. */
export async function handleCaseAction(act: string, el: HTMLElement): Promise<void> {
  const id = Number(el.dataset["id"]);
  if (el.dataset["busy"] === "1") return;
  el.dataset["busy"] = "1";
  (el as HTMLButtonElement).disabled = true;
  try {
    let farmId = openFarmId;
    switch (act) {
      case "case-save": {
        const agreed = document.querySelector<HTMLInputElement>('#drawerPanel [data-field="caseAgreed"]')?.checked ?? false;
        const owner = field("caseOwnerId");
        const follow = field("caseFollowUp");
        await updateCase(id, {
          ownerProfileId: owner || null, clearOwner: owner === "",
          nextAction: field("caseNextAction"), followUpAt: follow ? new Date(follow).toISOString() : null, clearFollowUp: follow === "",
          serviceStatus: field("caseServiceStatus"), payer: field("casePayer"), planDescription: field("casePlan"), serviceAgreed: agreed,
        });
        farmId = id;
        toast("Case saved.", "success");
        break;
      }
      case "case-book-visit": {
        const when = field("visitWhen");
        const installer = field("visitInstaller");
        if (!when || installer.length < 2) { toast("Choose the date and name the installer.", "warn"); return; }
        await bookVisit(id, { scheduledFor: new Date(when).toISOString(), installerName: installer, notes: field("visitNotes") || null });
        farmId = id;
        toast("Visit booked. The farmer's app shows the date now.", "success");
        break;
      }
      case "case-visit-start": await updateVisit(id, "in_progress"); toast("Visit started.", "success"); break;
      case "case-visit-done": await updateVisit(id, "done"); toast("Visit finished.", "success"); break;
      case "case-visit-cancel": await updateVisit(id, "cancelled"); toast("Visit cancelled.", "info"); break;
      case "case-check": {
        const item = el.dataset["item"] ?? "";
        const body: Record<string, unknown> = { provenance: item === "kit_linked" || item === "run_limit" ? "confirmed" : "measured" };
        if (item === "flow_measured") {
          body["flowRateLpm"] = Number(field(`flow_${id}`));
          body["provenance"] = field(`flowProv_${id}`) || "measured";
        }
        if (item === "run_limit" && field(`maxRun_${id}`)) body["maxRunMinutes"] = Number(field(`maxRun_${id}`));
        const r = await recordCheck(id, item, body as never);
        toast(r.commissionedNow ? "Recorded. This zone is now commissioned; the farmer is asked about automatic watering." : "Recorded.", "success");
        break;
      }
      case "case-help-resolve": await resolveHelpRequest(id, null); toast("Marked resolved.", "success"); break;
      case "case-mode": {
        const mode = (el.dataset["mode"] ?? "manual") as "automatic" | "manual";
        await setZoneModeAsStaff(id, mode);
        toast(`Zone switched to ${mode}.`, "success");
        break;
      }
      default: return;
    }
    if (farmId) await openCaseDrawer(farmId);
  } catch (e) {
    // The drawer stays as it was, with what was typed; the reason is said plainly.
    toast(plainError(e, "That could not be saved. Nothing was changed."), "warn", 6000);
  } finally {
    el.dataset["busy"] = "";
    (el as HTMLButtonElement).disabled = false;
  }
}
