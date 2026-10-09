import { errorState } from "@/ui/patterns";
import { esc, fmtDate } from "@/lib/format";
import { badge, kpiCard, pageHeader, panel, resultCount, table } from "@/ui/components";
import { Icon } from "@/lib/icons";
import { getMqttLogins } from "@/services/agroFlowApi";
import { plainError } from "@/lib/plainError";

/* MQTT LOGINS
 * Each board gets its own HiveMQ login, so the broker can tell kits apart and one leaked
 * password cannot publish for every farm. HiveMQ Cloud's credential API needs the paid plan
 * and we are on the free tier, so logins are made by hand in the HiveMQ console in batches,
 * pasted in here, and handed out one per board in the claim transaction. The board asks the
 * API for its login on every boot.
 * Security: passwords are never shown here. No endpoint returns one and the list query does
 * not select the encrypted column. A password only goes to the device that owns it, which
 * proves ownership with its device token. */

export async function mqttLoginsPage(): Promise<string> {
  let pool;

  try {
    pool = await getMqttLogins();
  } catch (error) {
    console.error("Failed to load the MQTT login pool:", error);

    return `
      ${pageHeader("MQTT logins", "Per-kit broker logins, created by hand in HiveMQ and handed out automatically.")}
      ${errorState({
        title: "The MQTT login pool could not be loaded",
        // The same error panel, with Retry, as every other page.
        detail: `${plainError(error, "The login list could not be retrieved.")} ` +
          "If this keeps happening, check that Mqtt__PoolEncryptionKey is set on the server - " +
          "pooled passwords are encrypted at rest, so the pool cannot be read without it.",
      })}
    `;
  }

  const total = pool.entries.length;

  return `
  ${pageHeader(
    "MQTT logins",
    "Per-kit broker logins. HiveMQ's credential API needs the paid Starter plan, so these are created by hand and handed out automatically at claim.",
  )}

  ${pool.warning ? `<div class="muted" style="margin:0 0 16px">⚠ ${esc(pool.warning)}</div>` : ""}

  <div class="grid kpis four">
    ${kpiCard({ label: "Free", value: pool.freeCount, icon: Icon.circleCheck, why: { counts: "broker logins are free", rule: "Logins in the pool not yet handed to a kit.", highlighted: "New kits take one of these when they are claimed.", query: "mqtt_credential_pool: unassigned, not burned" } })}
    ${kpiCard({ label: "Assigned to a kit", value: pool.assignedCount, icon: Icon.radio, why: { counts: "broker logins are in use", rule: "Logins handed to a kit at claim.", query: "mqtt_credential_pool: assigned" } })}
    ${kpiCard({ label: "Burned", value: pool.burnedCount, icon: Icon.circleX, why: { counts: "broker logins are burned", rule: "Logins retired and never handed out again.", query: "mqtt_credential_pool: burned" } })}
    ${kpiCard({ label: "Total", value: total, icon: Icon.radio, why: { counts: "broker logins are in the pool", rule: "Every login in the pool.", query: "mqtt_credential_pool" } })}
  </div>

  ${panel(
    "Add logins",
    "Create them in the HiveMQ console → your cluster → Access Management, then paste them here",
    "",
    `
      <p class="muted" style="margin-top:0">
        One per line: username then password, separated by a space, tab, comma or colon.
        Lines starting with <span class="mono sm">#</span> are ignored, so you can label a batch.
        Pasting the same batch twice is safe - duplicates are counted, not stored again.
      </p>

      <textarea
        id="mqttPasteBox"
        class="input"
        rows="6"
        spellcheck="false"
        style="width:100%;font-family:ui-monospace,monospace"
        placeholder="agroflow-kit-01 S0meL0ngPassword&#10;agroflow-kit-02 An0therPassword"
        aria-label="Paste username and password pairs"
      ></textarea>

      <div style="margin-top:12px">
        <button class="btn" data-act="add-mqtt-logins">Add to pool</button>
      </div>

      <p class="muted" style="margin-bottom:0">
        Passwords are encrypted before they are stored and are never shown again on this page.
        They are only ever sent to the one kit each login is assigned to.
      </p>
    `,
  )}

  ${panel(
    "The pool",
    "Free logins are handed out oldest first, inside the claim transaction",
    resultCount(total, total, "logins"),
    table(
      ["Username", "Status", "Kit", "Assigned", "Burned", "Added"],
      pool.entries,
      (e) => [
        `<span class="mono">${esc(e.username)}</span>`,
        // "assigned to <kit>" comes as one phrase from the server, which already prefers the zone
        // or device name over the raw efuse ID.
        badge(
          e.status.startsWith("assigned") ? "assigned" : e.status,
          e.status === "free" ? "good" : e.status === "burned" ? "warn" : "neutral",
        ),
        e.status.startsWith("assigned")
          ? esc(e.status.replace(/^assigned to /, ""))
          : `<span class="muted">—</span>`,
        e.assignedAt ? esc(fmtDate(e.assignedAt)) : `<span class="muted">—</span>`,
        e.burnedAt ? esc(fmtDate(e.burnedAt)) : `<span class="muted">—</span>`,
        esc(fmtDate(e.createdAt)),
      ],
      "No logins in the pool yet. Create some in the HiveMQ console and paste them in above.",
    ),
  )}

  ${panel(
    "About burned logins",
    "Why a revoked kit's login is not simply reused",
    "",
    `<div class="muted">
       When a kit is revoked, the board that held its password was usually lost or stolen - so the
       password has to be treated as known to whoever has the board. Handing it to the next kit
       would re-expose the broker. A burned login is therefore never reassigned: change the
       password in the HiveMQ console, then paste it back in above as a new entry.
     </div>`,
  )}
  `;
}
