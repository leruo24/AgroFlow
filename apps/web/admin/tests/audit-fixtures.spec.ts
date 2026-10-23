/* The audit's shared cases (docs/audit/fixtures): the admin site's phone and area rules give the
 * same answers as the API (AuditFixTests) and the app, from the same files (AF-07, AF-20). */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { normalisePhone } from "../src/lib/phone";
import { formatArea, roughSizeText } from "../src/lib/format";

// Playwright runs from apps/web/admin.
const fixtures = path.resolve(process.cwd(), "..", "..", "..", "docs", "audit", "fixtures");
const cases = (file: string) => JSON.parse(fs.readFileSync(path.join(fixtures, file), "utf8")).cases as any[];

test("phone numbers: the same cases as the server", () => {
  for (const c of cases("phone-cases.json")) {
    expect(normalisePhone(c.phone) !== null, `"${c.phone}"`).toBe(c.ok);
  }
});

test("areas: never 0 ha, square metres under a hectare", () => {
  for (const c of cases("area-cases.json")) {
    expect(formatArea(c.hectares), String(c.hectares)).toBe(c.text);
  }
});

test("request sizes say their unit, or that the farmer did not know (AF-19)", () => {
  expect(roughSizeText(null, "unknown")).toBe("Not known: help the farmer measure at the visit");
  expect(roughSizeText(null, "ha")).toBe("Not stated");
  expect(roughSizeText(2, "unstated")).toContain("the farmer gave no unit");
  expect(roughSizeText(2, "ha")).toBe(formatArea(2));
});
