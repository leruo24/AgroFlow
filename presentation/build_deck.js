// AgroFlow showcase introduction deck generator (pptxgenjs).
// Run: npm i pptxgenjs react react-dom react-icons sharp; PPTX_SKILL=<pptx skill dir> node build_deck.js
// Every claim on these slides is traced in AgroFlow_Slide_Source_Audit.md.
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");
const { applyTheme } = require(process.env.PPTX_SKILL + "/scripts/apply_theme.js");

const OUT_DIR = "/home/user/AgroFlow/presentation";
const A = (p) => path.join(OUT_DIR, "presentation-assets", p);
const OUT = path.join(OUT_DIR, "AgroFlow_Showcase_Intro_2026.pptx");

// ---- Palette (from apps/web/admin/src/styles + apps/mobile/src/constants/colors.ts) ----
const NAVY = "0F2A36", FOREST = "184D35", GREEN = "2F6B4B", TEAL = "168F99", AQUA = "42C3C7",
  BLUE = "1E88E5", AMBER = "C98A00", GREY = "5B6B73", LIGHT = "F2F7F6", LINE = "C9D6D9", WHITE = "FFFFFF",
  TEAL_T = "E3F4F5", GREEN_T = "E6F0EA", BLUE_T = "E5F0FC", AMBER_T = "FBF1DC";

const THEME = {
  name: "AgroFlow",
  headFontFace: "Calibri",
  bodyFontFace: "Calibri",
  colors: {
    dk1: NAVY, lt1: WHITE, dk2: FOREST, lt2: LIGHT,
    accent1: TEAL, accent2: GREEN, accent3: BLUE, accent4: AQUA, accent5: AMBER, accent6: GREY,
    hlink: TEAL, folHlink: GREEN,
  },
};

async function icon(Comp, color, px = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: px }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

const shadow = () => ({ type: "outer", color: "0F2A36", blur: 8, offset: 2, angle: 90, opacity: 0.12 });

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
  pres.title = "AgroFlow — Showcase Introduction 2026";
  pres.author = "Team 2, INF3003W, University of Cape Town";
  pres.company = "University of Cape Town";
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };

  // Speaker notes: spoken text comes from AgroFlow_Intro_Script.md so slides and script never drift.
  const fs = require("fs");
  const script = fs.readFileSync(path.join(OUT_DIR, "AgroFlow_Intro_Script.md"), "utf8");
  const spoken = {};
  script.split(/\n### Slide (\d+)[^\n]*\n/).forEach((chunk, i, arr) => {
    if (i % 2 === 1) spoken[Number(chunk)] = arr[i + 1].split("\n---")[0].split("\n## ")[0].trim().replace(/\*Handover:\*\s*/g, "Handover: ").replace(/\*\(([^)]*)\)\*/g, "[$1]");
  });
  let slideNo = 0;
  const origAddSlide = pres.addSlide.bind(pres);
  pres.addSlide = (o) => {
    const sl = origAddSlide(o); const n = ++slideNo; const orig = sl.addNotes.bind(sl);
    sl.addNotes = (t) => { const head = t.split("\n")[0]; const src = t.slice(t.indexOf("\n\n") + 2); return orig(head + "\n" + spoken[n] + "\n\n" + src); };
    return sl;
  };
  const logo = A("brand/agroflow-icon.png");

  // ---------- Layouts ----------
  pres.defineSlideMaster({
    title: "AF_CONTENT",
    background: { color: WHITE },
    objects: [
      { image: { path: logo, x: 0.55, y: 6.98, w: 0.3, h: 0.3 } },
      { text: { text: "AgroFlow · Team 2 · INF3003W · UCT 2026", options: { x: 0.92, y: 6.98, w: 6, h: 0.3, fontSize: 10, color: GREY, margin: 0, valign: "middle" } } },
      { placeholder: { options: { name: "title", type: "title", x: 0.55, y: 0.38, w: 10.2, h: 0.8, fontSize: 34, bold: true, color: NAVY, valign: "middle", align: "left", margin: 0 }, text: "" } },
    ],
    slideNumber: { x: 12.35, y: 6.98, w: 0.45, h: 0.3, fontSize: 10, color: GREY, align: "right" },
  });
  pres.defineSlideMaster({
    title: "AF_DARK",
    background: { color: NAVY },
    objects: [],
  });

  // Small pill naming who presents the slide.
  function speaker(slide, name, dark = false) {
    slide.addText(name, {
      shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.15, x: 10.95, y: 0.5, w: 1.85, h: 0.36,
      fill: { color: dark ? "1D3F4D" : TEAL_T }, line: { color: dark ? "1D3F4D" : TEAL_T },
      fontSize: 11, color: dark ? AQUA : TEAL, bold: true, align: "center", valign: "middle", margin: 0,
      objectName: "Speaker tag", isTextBox: true,
    });
  }
  function card(slide, x, y, w, h, fill = WHITE, line = LINE, name = "Card") {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: line, width: 0.75 }, shadow: shadow(), objectName: name });
  }
  function txt(slide, text, o) {
    slide.addText(text, Object.assign({ margin: 0, fontSize: 14, color: NAVY, valign: "top", isTextBox: true }, o));
  }
  function arrow(slide, x1, y1, x2, y2, color = GREY, o = {}) {
    const flipH = x2 < x1, flipV = y2 < y1;
    slide.addShape(pres.shapes.LINE, Object.assign({
      x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001),
      flipH, flipV, line: { color, width: 1.5, endArrowType: "triangle" },
    }, o));
  }
  async function iconCircle(slide, Comp, x, y, d, bg, fg) {
    slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: bg }, line: { color: bg }, objectName: "Icon circle" });
    const p = d * 0.25;
    slide.addImage({ data: await icon(Comp, fg), x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p, objectName: "Icon" });
  }
  // phone frames are 1238 x 2600 px
  const PH = 2600 / 1238;
  function phone(slide, file, x, y, h, name) {
    slide.addImage({ path: A("ui/" + file), x, y, w: h / PH, h, objectName: name });
  }
  function caption(slide, text, x, y, w, o = {}) {
    txt(slide, text, Object.assign({ x, y, w, h: 0.3, fontSize: 10, color: GREY, italic: true }, o));
  }

  // =====================================================================
  // 1. TITLE
  // =====================================================================
  pres.addSection({ title: "Introduction" });
  let s = pres.addSlide({ masterName: "AF_DARK", sectionTitle: "Introduction" });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.75, y: 0.7, w: 1.35, h: 1.35, rectRadius: 0.25, fill: { color: WHITE }, line: { color: WHITE }, objectName: "Logo plate" });
  s.addImage({ path: logo, x: 0.8, y: 0.75, w: 1.25, h: 1.25, objectName: "AgroFlow logo" });
  txt(s, "AGROFLOW", { x: 0.75, y: 2.25, w: 7.2, h: 1.1, fontSize: 66, bold: true, color: WHITE, charSpacing: 4 });
  txt(s, "Smart Irrigation Management System", { x: 0.75, y: 3.35, w: 7.2, h: 0.6, fontSize: 28, color: AQUA });
  // Four-part identity strip: agriculture + IoT + irrigation + software
  const strip = [[fa.FaSeedling, "Agriculture"], [fa.FaMicrochip, "IoT"], [fa.FaTint, "Irrigation"], [fa.FaMobileAlt, "Software"]];
  const stripX = [0.75, 2.85, 4.15, 6.1];
  for (let i = 0; i < strip.length; i++) {
    const x = stripX[i];
    await iconCircle(s, strip[i][0], x, 4.35, 0.62, "1D3F4D", AQUA);
    txt(s, strip[i][1], { x: x + 0.72, y: 4.35, w: 1.2, h: 0.62, fontSize: 14, color: WHITE, valign: "middle" });
  }
  txt(s, [
    { text: "INF3003W · Systems Development Project I", options: { breakLine: true } },
    { text: "Team 2 · University of Cape Town · 2026", options: { breakLine: true } },
    { text: "Sponsor: Mafikeng Cisco Edge Centre (MDiHub)", options: { color: "9FB6BF" } },
  ], { x: 0.75, y: 5.4, w: 7.2, h: 1.2, fontSize: 16, color: WHITE, paraSpaceAfter: 4 });
  phone(s, "mobile-zone-manual-run.png", 8.2, 1.05, 5.85, "Farmer app — zone irrigation control");
  phone(s, "mobile-reports.png", 10.55, 1.55, 5.35, "Farmer app — reports");
  txt(s, "Real AgroFlow farmer app, running from the current repository", { x: 8.25, y: 7.05, w: 4.8, h: 0.3, fontSize: 10, color: "9FB6BF", italic: true });
  speaker(s, "Lubaelihle", true);
  s.addNotes(
    "SPEAKER 1 — Lubaelihle Msuku (Project Manager). ~20 s.\n" +
    "Good morning. We're Team 2, and this is AgroFlow, a smart irrigation management system. " +
    "It brings together four things: agriculture, IoT hardware in the field, irrigation control, and the software farmers and administrators use. " +
    "On the right is our actual farmer app — not a mock-up. The project was sponsored by the Mafikeng Cisco Edge Centre, MDiHub.\n\n" +
    "Source: Milestone 2/3 cover pages; app screens captured from apps/mobile (see source audit)."
  );

  // =====================================================================
  // 2. TEAM
  // =====================================================================
  s = pres.addSlide({ masterName: "AF_CONTENT", sectionTitle: "Introduction" });
  s.addText("Meet Team 2", { placeholder: "title" });
  speaker(s, "Lubaelihle");
  const team = [
    ["Lubaelihle Msuku", "Project Manager", "LM", "Slides 1–3", GREEN],
    ["Leruo Matlhatsi", "Software Developer", "LM", "Slides 4–5", TEAL],
    ["Philisile Tyobeka", "Business Analyst", "PT", "Slides 6–7", BLUE],
    ["Olwethu Nkabinde", "Soft Skills Specialist", "ON", "Slides 8–10", FOREST],
  ];
  for (let i = 0; i < 4; i++) {
    const x = 0.55 + i * 3.1, y = 1.55;
    card(s, x, y, 2.85, 3.85, WHITE, LINE, "Team card " + (i + 1));
    // Editable photo placeholder: no team photos were supplied.
    s.addText([{ text: team[i][2], options: { fontSize: 30, bold: true, breakLine: true } }, { text: "add photo", options: { fontSize: 10 } }], {
      shape: pres.shapes.OVAL, x: x + 0.7, y: y + 0.3, w: 1.45, h: 1.45, fill: { color: LIGHT }, line: { color: team[i][4], width: 2.5, dashType: "dash" },
      color: team[i][4], align: "center", valign: "middle", margin: 0, objectName: "PHOTO PLACEHOLDER — replace with team photo", isTextBox: true,
    });
    txt(s, team[i][0], { x: x + 0.15, y: y + 2.0, w: 2.55, h: 0.45, fontSize: 18, bold: true, align: "center" });
    txt(s, team[i][1], { x: x + 0.15, y: y + 2.45, w: 2.55, h: 0.35, fontSize: 14, color: team[i][4], bold: true, align: "center" });
    txt(s, team[i][3], { x: x + 0.15, y: y + 3.15, w: 2.55, h: 0.3, fontSize: 12, color: GREY, align: "center" });
  }
  card(s, 0.55, 5.75, 12.2, 0.9, LIGHT, LIGHT, "Project context");
  txt(s, [
    { text: "Sponsor  ", options: { bold: true, color: TEAL } }, { text: "Boingotlo Molefhe · Mafikeng Cisco Edge Centre (MDiHub)      " },
    { text: "Tutor  ", options: { bold: true, color: TEAL } }, { text: "Nazreen Ryklief      " },
    { text: "Mentor  ", options: { bold: true, color: TEAL } }, { text: "Jodie Thorburn" },
  ], { x: 0.85, y: 5.75, w: 11.6, h: 0.9, fontSize: 14, valign: "middle" });
  s.addNotes(
    "SPEAKER 1 — Lubaelihle. ~20 s.\n" +
    "I'm Lubaelihle, the project manager. Leruo is our software developer, Philisile is our business analyst, and Olwethu is our soft-skills specialist. " +
    "Each of us will take part of this introduction. Our sponsor is Boingotlo Molefhe from the Mafikeng Cisco Edge Centre, which supports small businesses and digital skills, " +
    "and we were guided by our tutor Nazreen Ryklief and mentor Jodie Thorburn.\n\n" +
    "Roles: Milestone 1, Table 14 (Summary of roles). Names: Milestone 1 cover / repo landing page.\n" +
    "ACTION: the circles are editable placeholders — no team photos were supplied. Replace each with a real photo (Insert > Picture, crop to circle)."
  );

  // =====================================================================
  // 3. CHALLENGE
  // =====================================================================
  s = pres.addSlide({ masterName: "AF_CONTENT", sectionTitle: "Introduction" });
  s.addText("The irrigation challenge", { placeholder: "title" });
  speaker(s, "Lubaelihle");
  txt(s, "Farmers have to decide when and how much to water without reliable, real-time visibility of their fields.", {
    x: 0.55, y: 1.35, w: 12.2, h: 0.85, fontSize: 22, color: FOREST, bold: true, valign: "middle",
  });
  const probs = [
    [fa.FaWalking, "Manual checks", "Walking zone to zone to judge the soil", "Time and labour"],
    [fa.FaClock, "Fixed timers", "Schedules ignore soil and weather", "Over- and under-watering"],
    [fa.FaEyeSlash, "Little visibility", "No record of the water actually used", "Decisions without data"],
    [fa.FaSignal, "Rural conditions", "Weak signal and load-shedding", "Must keep working offline"],
  ];
  for (let i = 0; i < 4; i++) {
    const y = 2.45 + i * 1.08;
    card(s, 0.55, y, 6.6, 0.9, WHITE, LINE, "Problem " + (i + 1));
    await iconCircle(s, probs[i][0], 0.72, y + 0.14, 0.62, TEAL_T, TEAL);
    txt(s, probs[i][1], { x: 1.5, y: y + 0.1, w: 5.5, h: 0.36, fontSize: 16, bold: true });
    txt(s, probs[i][2], { x: 1.5, y: y + 0.46, w: 5.5, h: 0.34, fontSize: 14, color: GREY });
    arrow(s, 7.3, y + 0.45, 7.95, y + 0.45, TEAL);
    s.addText(probs[i][3], { shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.1, x: 8.05, y: y + 0.12, w: 2.75, h: 0.66, fill: { color: AMBER_T }, line: { color: AMBER_T }, fontSize: 14, bold: true, color: "7A5300", align: "center", valign: "middle", margin: 0, objectName: "Consequence " + (i + 1), isTextBox: true });
  }
  // Persona
  card(s, 11.05, 2.45, 1.7, 4.14, GREEN_T, GREEN_T, "Persona");
  await iconCircle(s, fa.FaUserAlt, 11.5, 3.0, 0.8, WHITE, GREEN);
  txt(s, [
    { text: "Sipho Dlamini", options: { bold: true, breakLine: true } },
    { text: "Small-farm owner (persona)", options: { fontSize: 11, color: GREY, breakLine: true } },
    { text: " ", options: { fontSize: 6, breakLine: true } },
    { text: "“Check soil conditions without walking to every zone.”", options: { italic: true, fontSize: 12, color: FOREST } },
  ], { x: 11.15, y: 3.95, w: 1.5, h: 2.4, fontSize: 14, align: "center" });
  s.addNotes(
    "SPEAKER 1 — Lubaelihle. ~40 s.\n" +
    "The problem our sponsor brought us is simple to state: farmers have to make irrigation decisions without reliable, real-time visibility of their fields. " +
    "Today that means walking from zone to zone to judge the soil, or relying on fixed timers that water whether it rained yesterday or not. " +
    "That leads to over- and under-watering, extra labour, and no real record of how much water was used. " +
    "On top of that, rural sites have weak signal and load-shedding, so whatever we build has to keep working when the connection drops. " +
    "Our farmer persona, Sipho Dlamini, put it well: he wants to check soil conditions without walking to every zone. " +
    "I'll hand over to Leruo to show how AgroFlow answers that.\n\n" +
    "Sources: Milestone 3 §1.1 Business Case Summary; Milestone 3 §2 (R10 connectivity, R14 load shedding); persona Figure 7.1 (goal: 'ability to check soil conditions without having to walk to every zone'). " +
    "No yield or water-saving percentages are claimed — none were measured."
  );

  // =====================================================================
  // 4. SOLUTION
  // =====================================================================
  pres.addSection({ title: "Solution" });
  s = pres.addSlide({ masterName: "AF_CONTENT", sectionTitle: "Solution" });
  s.addText("From field conditions to informed irrigation", { placeholder: "title" });
  speaker(s, "Leruo");
  const cols = [
    [fa.FaSeedling, "FIELD", GREEN, GREEN_T, ["ESP32 kit in every zone", "Soil moisture, temperature and humidity every 30 s", "Relay switches the pump"]],
    [fa.FaCloud, "CONNECTED PLATFORM", TEAL, TEAL_T, ["Stores readings, checks each zone", "FAO-56 advice from crop stage + forecast", "Telegram alerts when action is needed"]],
    [fa.FaUserAlt, "FARMER & ADMIN", BLUE, BLUE_T, ["Every zone on the farmer's phone", "Automatic, scheduled or manual watering", "Admins register farms and kits"]],
  ];
  for (let i = 0; i < 3; i++) {
    const x = 0.55 + i * 2.95;
    card(s, x, 1.5, 2.6, 4.35, cols[i][3], cols[i][3], cols[i][1]);
    await iconCircle(s, cols[i][0], x + 0.95, 1.7, 0.7, WHITE, cols[i][2]);
    txt(s, cols[i][1], { x: x + 0.1, y: 2.5, w: 2.4, h: 0.4, fontSize: 15, bold: true, color: cols[i][2], align: "center" });
    txt(s, cols[i][4].map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < 2 } })), { x: x + 0.2, y: 3.0, w: 2.25, h: 2.7, fontSize: 14, paraSpaceAfter: 8 });
    if (i < 2) arrow(s, x + 2.62, 3.65, x + 2.93, 3.65, cols[i][2], { line: { color: cols[i][2], width: 2.25, endArrowType: "triangle" } });
  }
  txt(s, [
    { text: "Rule-based and sourced, not a black box: ", options: { bold: true, color: TEAL } },
    { text: "every advice figure traces to a sensor reading, a weather row or a cited FAO-56 value." },
  ], { x: 0.55, y: 6.05, w: 8.5, h: 0.65, fontSize: 14, valign: "middle" });
  phone(s, "mobile-irrigation.png", 9.65, 1.3, 5.45, "Farmer app — Irrigation");
  caption(s, "Farmer app · Irrigation", 9.65, 6.78, 2.6, { align: "center" });
  s.addNotes(
    "SPEAKER 2 — Leruo Matlhatsi (Software Developer). ~35 s.\n" +
    "Thanks, Luba. AgroFlow works as one connected system. In the field, every zone has an ESP32 kit that reads soil moisture, temperature and humidity every thirty seconds, and a relay that switches the pump. " +
    "The platform stores those readings, checks each zone against the thresholds the farmer set, and our advice engine uses the FAO-56 method — the crop's growth stage and the local forecast — to say how much water the zone needs. " +
    "When something needs a person, it sends a Telegram alert. The farmer sees all of it on their phone and can leave a zone on automatic, put it on a schedule, or water it manually. " +
    "One thing we want to be clear about: the advice is rule-based and sourced, not an AI model.\n\n" +
    "Sources: firmware SENSOR_REPORT_INTERVAL_MS = 30000 (AgroFlowIrrigationNode.ino:98); IrrigationMode.cs (automatic/scheduled/manual); " +
    "Agronomy/IrrigationAdvisor.cs header ('This is NOT a language model'); TelegramNotificationService.cs."
  );

  // =====================================================================
  // 5. ARCHITECTURE
  // =====================================================================
  s = pres.addSlide({ masterName: "AF_CONTENT", sectionTitle: "Solution" });
  s.addText("How AgroFlow works", { placeholder: "title" });
  speaker(s, "Leruo");
  const colY = 1.75, colH = 3.65;
  const heads = [["FIELD HARDWARE", GREEN, 0.55, 2.3], ["COMMUNICATION", AQUA, 3.1, 2.05], ["PLATFORM", TEAL, 5.4, 2.75], ["DATABASE", FOREST, 8.4, 1.9], ["APPS", BLUE, 10.55, 2.2]];
  heads.forEach(([t, c, x, w]) => txt(s, t, { x, y: 1.35, w, h: 0.3, fontSize: 12, bold: true, color: c, charSpacing: 1 }));
  function box(x, y, w, h, title, sub, color, tint, name) {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: tint }, line: { color, width: 1 }, objectName: name || title });
    const runs = [{ text: title, options: { bold: true, fontSize: 13, color: NAVY, breakLine: !!sub } }];
    if (sub) runs.push({ text: sub, options: { fontSize: 11, color: GREY } });
    s.addText(runs, { x: x + 0.08, y, w: w - 0.16, h, valign: "middle", align: "center", margin: 0, isTextBox: true, objectName: (name || title) + " label" });
  }
  // Field kit
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.55, y: colY, w: 2.3, h: colH, rectRadius: 0.1, fill: { color: WHITE }, line: { color: GREEN, width: 1.25, dashType: "dash" }, objectName: "Zone kit boundary" });
  txt(s, "Zone kit · one per zone", { x: 0.65, y: colY + 0.08, w: 2.1, h: 0.28, fontSize: 11, color: GREEN, bold: true, align: "center" });
  box(0.7, 2.2, 0.95, 0.9, "Soil probe", "moisture", GREEN, GREEN_T);
  box(1.75, 2.2, 0.95, 0.9, "DHT11", "temp · humidity", GREEN, GREEN_T);
  box(0.7, 3.35, 2.0, 0.7, "ESP32", "firmware v1.4.0", GREEN, WHITE);
  box(0.7, 4.35, 0.92, 0.75, "Relay", null, GREEN, GREEN_T);
  box(1.78, 4.35, 0.92, 0.75, "Pump", null, GREEN, GREEN_T);
  arrow(s, 1.17, 3.1, 1.17, 3.35, GREEN); arrow(s, 2.22, 3.1, 2.22, 3.35, GREEN);
  arrow(s, 1.16, 4.05, 1.16, 4.35, BLUE); arrow(s, 1.62, 4.72, 1.78, 4.72, BLUE);
  // Communication
  box(3.1, 1.75, 2.05, 0.75, "Wi-Fi", "site router / hotspot", AQUA, TEAL_T);
  box(3.1, 2.75, 2.05, 1.2, "HiveMQ Cloud", "MQTT over TLS · readings in, commands out", AQUA, WHITE);
  box(3.1, 4.15, 2.05, 1.25, "HTTPS", "enrol kit · log irrigation events · confirm commands", AQUA, TEAL_T);
  // Platform
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.4, y: colY, w: 2.75, h: colH, rectRadius: 0.1, fill: { color: WHITE }, line: { color: TEAL, width: 1.25 }, objectName: "AgroFlow.Api boundary" });
  txt(s, [{ text: "AgroFlow.Api", options: { bold: true, breakLine: true } }, { text: "ASP.NET Core (.NET 8) · Docker on Railway", options: { fontSize: 10, color: GREY } }], { x: 5.5, y: colY + 0.08, w: 2.55, h: 0.55, fontSize: 13, align: "center" });
  ["Sensor ingestion + zone health", "Auto-irrigation decision", "FAO-56 advice engine", "Command bridge → MQTT", "Telegram notifications"].forEach((t, i) =>
    box(5.55, 2.4 + i * 0.58, 2.45, 0.48, t, null, TEAL, TEAL_T, "API: " + t));
  // externals
  box(5.4, 5.6, 1.3, 0.6, "Open-Meteo", "weather", GREY, LIGHT);
  box(6.85, 5.6, 1.3, 0.6, "Telegram", "Bot API", GREY, LIGHT);
  arrow(s, 6.05, 5.6, 6.05, 5.42, GREY); arrow(s, 7.5, 5.42, 7.5, 5.6, GREY);
  // Database
  box(8.4, 1.75, 1.9, 3.65, "Supabase", "PostgreSQL\nAuth\nRow Level Security", FOREST, GREEN_T, "Supabase");
  // Apps
  box(10.55, 1.75, 2.2, 1.6, "Farmer app", "Expo / React Native · Android APK", BLUE, BLUE_T);
  box(10.55, 3.8, 2.2, 1.6, "Admin console", "TypeScript + Vite · web", BLUE, BLUE_T);
  // Data flow arrows (readings: left to right)
  arrow(s, 2.85, 3.45, 3.1, 3.45, GREEN); arrow(s, 3.1, 3.75, 2.85, 3.75, BLUE);
  arrow(s, 2.85, 4.75, 3.1, 4.75, GREEN);
  arrow(s, 5.15, 3.05, 5.4, 3.05, TEAL); arrow(s, 5.4, 3.35, 5.15, 3.35, BLUE);
  arrow(s, 5.15, 4.75, 5.4, 4.75, AQUA);
  arrow(s, 8.15, 2.7, 8.4, 2.7, FOREST); arrow(s, 8.4, 3.0, 8.15, 3.0, FOREST);
  arrow(s, 10.55, 2.55, 10.3, 2.55, BLUE); arrow(s, 10.3, 2.85, 10.55, 2.85, BLUE);
  arrow(s, 10.55, 4.6, 10.3, 4.6, BLUE); arrow(s, 10.3, 4.9, 10.55, 4.9, BLUE);
  // Command return path
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.55, y: 6.32, w: 12.2, h: 0.52, rectRadius: 0.1, fill: { color: BLUE_T }, line: { color: BLUE_T }, objectName: "Command path band" });
  txt(s, [
    { text: "Irrigation command  ", options: { bold: true, color: BLUE } },
    { text: "App → API → database queue → LISTEN/NOTIFY → MQTT → ESP32 → relay → pump → event logged" },
  ], { x: 0.8, y: 6.32, w: 11.8, h: 0.52, fontSize: 14, valign: "middle" });
  s.addNotes(
    "SPEAKER 2 — Leruo. ~50 s.\n" +
    "This is the system as it's built today, traced from the code. On the left is one zone kit: a soil-moisture probe and a DHT11 feed an ESP32, and the ESP32 drives a relay that switches the pump. " +
    "The kit joins the site's Wi-Fi and publishes its readings over MQTT, encrypted with TLS, to HiveMQ Cloud. Things that only happen occasionally — enrolling the kit, logging a pump run, confirming a command — go over HTTPS. " +
    "Our API is an ASP.NET Core service in Docker on Railway. It stores each reading in Supabase, works out the zone's health, decides whether an automatic zone needs water, runs the FAO-56 advice engine with Open-Meteo weather, and sends Telegram alerts. " +
    "The farmer app and the admin console read their own data straight from Supabase, where row-level security makes sure a farmer only ever sees their own farm. " +
    "Along the bottom is the path back to the hardware: a command is queued in the database, Postgres notifies the API, the API publishes it over MQTT, and the ESP32 switches the relay. " +
    "Philisile will now walk through the process this supports.\n\n" +
    "Sources: README.md Architecture; hardware/shared/MQTT_TOPICS.md; Mqtt/IrrigationCommandNotifyService.cs; Services/SensorReadingProcessor.cs; WeatherCollectionService.cs (Open-Meteo); migration 0011_row_level_security.sql; Dockerfile; Milestone 3 §2.1.4. " +
    "NOTE: Milestone 3 describes an ESP-NOW gateway between boards and OpenWeatherMap; neither is in the final code — each board connects directly over Wi-Fi, and weather comes from Open-Meteo."
  );

  // =====================================================================
  // 6. TO-BE PROCESS
  // =====================================================================
  pres.addSection({ title: "Design" });
  s = pres.addSlide({ masterName: "AF_CONTENT", sectionTitle: "Design" });
  s.addText("From monitoring to irrigation", { placeholder: "title" });
  speaker(s, "Philisile");
  const lanes = [["FARMER", BLUE, BLUE_T, 1.35, 1.5], ["AGROFLOW PLATFORM", TEAL, TEAL_T, 2.9, 2.15], ["FIELD HARDWARE", GREEN, GREEN_T, 5.1, 1.5]];
  lanes.forEach(([t, c, tint, y, h]) => {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.55, y, w: 12.2, h, fill: { color: tint }, line: { color: WHITE, width: 2 }, objectName: "Lane " + t });
    s.addText(t, { x: 0.775 - h / 2, y: y + h / 2 - 0.2, w: h, h: 0.4, fontSize: 11, bold: true, color: c, rotate: 270, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: "Lane label " + t });
  });
  const colX = (i) => 1.2 + i * 1.66, BW = 1.5;
  function step(i, y, h, text, color, name) {
    s.addText(text, { shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.08, x: colX(i), y, w: BW, h, fill: { color: WHITE }, line: { color, width: 1.25 }, fontSize: 12, color: NAVY, align: "center", valign: "middle", margin: 0.04, objectName: name, isTextBox: true });
  }
  // Hardware lane (y 5.05..6.6)
  step(0, 5.45, 0.8, "Read soil, temp and humidity every 30 s", GREEN, "HW read");
  step(5, 5.35, 1.0, "Relay on → pump runs, stops on time, stop or safety cap", GREEN, "HW pump");
  // Platform lane (y 3.0..4.95)
  step(1, 3.95, 0.8, "Store reading, update zone health", TEAL, "SYS store");
  step(2, 3.0, 0.72, "FAO-56 advice from forecast + crop stage", TEAL, "SYS advice");
  s.addText("Automatic and below threshold?", { shape: pres.shapes.DIAMOND, x: colX(3) - 0.05, y: 3.72, w: BW + 0.1, h: 1.15, fill: { color: WHITE }, line: { color: TEAL, width: 1.25 }, fontSize: 11, color: NAVY, align: "center", valign: "middle", margin: 0, objectName: "SYS decision", isTextBox: true });
  step(4, 3.95, 0.8, "Queue command, publish over MQTT", TEAL, "SYS command");
  step(6, 3.95, 0.8, "Log event and litres used", TEAL, "SYS log");
  // Farmer lane (y 1.35..2.9)
  step(2, 1.7, 0.8, "Review conditions and advice", BLUE, "F review");
  step(3, 1.7, 0.8, "Start a manual run (choose minutes)", BLUE, "F manual");
  step(6, 1.7, 0.8, "See history and reports", BLUE, "F history");
  // Flow arrows
  arrow(s, colX(0) + BW / 2, 5.45, colX(1) + 0.3, 4.75, GREEN);        // read -> store
  arrow(s, colX(1) + BW, 4.25, colX(3) - 0.05, 4.3, TEAL);              // store -> decision
  arrow(s, colX(1) + BW, 4.1, colX(2), 3.5, TEAL);                      // store -> advice
  arrow(s, colX(2) + BW / 2, 3.0, colX(2) + BW / 2, 2.5, TEAL);         // advice -> review
  arrow(s, colX(2) + BW, 2.1, colX(3), 2.1, BLUE);                      // review -> manual
  arrow(s, colX(3) + BW, 2.25, colX(4) + 0.3, 3.95, BLUE);              // manual -> command
  arrow(s, colX(3) + BW + 0.05, 4.3, colX(4), 4.3, TEAL);               // decision yes -> command
  txt(s, "yes", { x: colX(4) - 0.3, y: 3.98, w: 0.35, h: 0.22, fontSize: 10, color: TEAL, bold: true });
  txt(s, "no: keep monitoring", { x: colX(3) - 0.1, y: 4.86, w: 1.7, h: 0.22, fontSize: 10, color: GREY, align: "center" });
  arrow(s, colX(4) + BW / 2, 4.75, colX(5) + 0.3, 5.35, TEAL);          // command -> pump
  arrow(s, colX(5) + BW - 0.3, 5.35, colX(6) + BW / 2, 4.75, GREEN);    // pump -> log
  arrow(s, colX(6) + BW / 2, 3.95, colX(6) + BW / 2, 2.5, TEAL);        // log -> history
  caption(s, "Redrawn from the Milestone 2 To-Be activity diagram and updated to the implemented flow (SensorReadingProcessor.cs, FarmerEndpoints.cs, ESP32 firmware).", 0.55, 6.7, 11.0, { h: 0.25 });
  s.addNotes(
    "SPEAKER 3 — Philisile Tyobeka (Business Analyst). ~45 s.\n" +
    "Thank you, Leruo. This is our To-Be process, with three lanes: the farmer, the AgroFlow platform, and the field hardware. " +
    "It starts at the bottom: the kit reads the soil, temperature and humidity every thirty seconds. The platform stores each reading and updates the zone's health. " +
    "If the zone is on automatic and the soil is below the threshold the farmer set, the platform queues a start command on its own. Otherwise it keeps monitoring. " +
    "At the same time the platform works out FAO-56 advice from the forecast and the crop's growth stage, and the farmer reviews that on their phone. " +
    "The farmer can also start a manual run and choose how many minutes. Either way, the command goes out over MQTT, the relay switches on and the pump runs. " +
    "It stops when the time is up, when it's told to stop, or at a built-in safety limit. The kit then logs the event, and the farmer sees it in their history and reports.\n\n" +
    "Sources: Milestone 2 §3 To-Be Activity Diagram — Farmer (original: view conditions → initiate irrigation → check hardware → assess → irrigate loop → record). " +
    "Updated because the implemented system adds automatic mode decisions (Zone.ShouldStartIrrigation), FAO-56 advice, and duration-limited manual runs (FarmerEndpoints.CreateManualCommandAsync). " +
    "Safety cap: firmware SAFETY_MAX_RUN_MS = 5 minutes on every run (AgroFlowIrrigationNode.ino:105)."
  );

  // =====================================================================
  // 7. SYSTEM DESIGN
  // =====================================================================
  s = pres.addSlide({ masterName: "AF_CONTENT", sectionTitle: "Design" });
  s.addText("Designed as a connected system", { placeholder: "title" });
  speaker(s, "Philisile");
  function cls(x, y, w, title, attrs, color, name, stereo) {
    const h = 0.42 + attrs.length * 0.24 + (stereo ? 0.2 : 0);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: WHITE }, line: { color, width: 1.25 }, objectName: "Class " + name });
    const head = (stereo ? 0.2 : 0) + 0.36;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h: head, fill: { color }, line: { color, width: 1.25 }, objectName: "Class header " + name });
    const runs = [];
    if (stereo) runs.push({ text: stereo, options: { fontSize: 9, breakLine: true, italic: true } });
    runs.push({ text: title, options: { fontSize: 13, bold: true } });
    s.addText(runs, { x, y, w, h: head, color: WHITE, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: "Class name " + name });
    if (attrs.length) s.addText(attrs.map((a, i) => ({ text: a, options: { breakLine: i < attrs.length - 1 } })), { x: x + 0.08, y: y + head + 0.02, w: w - 0.16, h: h - head - 0.04, fontSize: 10.5, color: NAVY, fontFace: "Consolas", valign: "top", margin: 0, isTextBox: true, objectName: "Class attrs " + name });
    return { x, y, w, h };
  }
  function rel(x1, y1, x2, y2, label, lx, ly, inherit) {
    s.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001), flipH: x2 < x1, flipV: y2 < y1, line: { color: GREY, width: 1.25, endArrowType: inherit ? "triangle" : "none" } });
    if (label) txt(s, label, { x: lx, y: ly, w: 0.8, h: 0.2, fontSize: 10, color: GREY });
  }
  const user = cls(0.55, 1.4, 1.95, "User", ["+ login()"], GREY, "User", "«abstract»");
  const ad = cls(0.55, 2.75, 0.92, "Admin", [], GREY, "Admin");
  const fu = cls(1.58, 2.75, 0.92, "FarmUser", [], GREY, "FarmUser");
  rel(1.01, 2.75, 1.3, 2.36, null, 0, 0, true); rel(2.04, 2.75, 1.75, 2.36, null, 0, 0, true);
  const farm = cls(3.0, 1.4, 2.35, "Farm", ["farmName", "location", "+ AddZone()"], FOREST, "Farm");
  rel(2.5, 2.95, 3.0, 2.3, "owns", 2.45, 2.42);
  const zone = cls(3.0, 3.15, 2.35, "Zone", ["cropType", "moistureThreshold", "+ ShouldStartIrrigation()"], TEAL, "Zone");
  rel(4.17, 2.54, 4.17, 3.15, "1..*", 4.25, 2.72);
  const wth = cls(5.85, 1.4, 1.75, "Weather", ["temperature", "windSpeed"], GREY, "Weather");
  rel(5.35, 1.85, 5.85, 1.85, "1..*", 5.4, 1.6);
  const hw = cls(5.85, 3.15, 1.75, "Hardware", ["status", "lastSeen"], GREEN, "Hardware");
  rel(5.35, 3.6, 5.85, 3.6, "0..*", 5.4, 3.35);
  const e1 = cls(5.4, 4.75, 0.82, "ESP32", [], GREEN, "ESP32");
  const e2 = cls(6.32, 4.75, 0.82, "Sensor", [], GREEN, "Sensor");
  const e3 = cls(7.24, 4.75, 0.82, "Pump", [], GREEN, "Pump");
  [e1, e2, e3].forEach((c) => rel(c.x + c.w / 2, 4.75, 6.72, 3.15 + hw.h, null, 0, 0, true));
  const log = cls(0.55, 4.6, 1.75, "IrrigationLog", ["runtimeSeconds", "estimatedLitres"], BLUE, "IrrigationLog");
  const al = cls(2.45, 4.75, 1.25, "Alert", ["severity"], AMBER, "Alert");
  const rec = cls(3.85, 4.75, 1.25, "Advice", ["message"], TEAL, "AIRecommendation", null);
  rel(3.4, 3.15 + zone.h, 1.43, 4.6, "0..*", 1.75, 4.38);
  rel(3.9, 3.15 + zone.h, 3.07, 4.75, "0..*", 2.75, 4.48);
  rel(4.45, 3.15 + zone.h, 4.47, 4.75, "0..*", 4.52, 4.4);
  txt(s, "Advice = class AIRecommendation in code: written by the rule-based FAO-56 engine, not an AI model.", { x: 0.55, y: 5.95, w: 7.5, h: 0.45, fontSize: 11, color: GREY, italic: true });
  // code evidence
  const cw = 4.6, chh = cw * 1766 / 2640;
  s.addImage({ path: A("code/zone-cs-irrigation-decision.png"), x: 8.2, y: 1.45, w: cw, h: chh, objectName: "Code: Zone.cs" });
  txt(s, [{ text: "Implemented in the current AgroFlow codebase", options: { bold: true, breakLine: true } }, { text: "The same Zone class decides when an automatic zone starts and stops watering.", options: { color: GREY } }], { x: 8.2, y: 1.6 + chh, w: cw, h: 0.85, fontSize: 13 });
  s.addNotes(
    "SPEAKER 3 — Philisile. ~35 s.\n" +
    "Here is the domain model, simplified to the classes that matter. A farm user owns a farm; a farm has one or more zones; and the zone is the centre of the design. " +
    "Each zone has its hardware — the ESP32, its sensors and its pump all inherit from one Hardware class — and each zone builds up irrigation logs, alerts and advice. Weather belongs to the farm, because it's the same for every zone on it. " +
    "On the right is the real Zone class from our code. CalculateHealthStatus turns readings into Healthy, Warning or Critical, and ShouldStartIrrigation only returns true when the farmer has actually set a threshold — it never guesses. " +
    "Olwethu will now show what we built.\n\n" +
    "Sources: backend/AgroFlow.Domain/*.cs (User abstract; FarmUser : User; Admin : User; ESP32/Sensor/Pump : Hardware; Farm.Zones collection); supabase/migrations (farm.owner_id, zone.farm_id, hardware.zone_id, alert/irrigation_event/ai_recommendation.zone_id, weather.farm_id). " +
    "Changed since the Milestone 3 DCD: Admin extends User (not FarmUser); RelaySwitch, WeatherService, DashboardService and NotificationService are not domain classes — that work lives in API services. Maintenance (→ Hardware) and Report exist but are omitted here for readability."
  );

  // =====================================================================
  // 8. EVIDENCE
  // =====================================================================
  pres.addSection({ title: "Implementation" });
  s = pres.addSlide({ masterName: "AF_CONTENT", sectionTitle: "Implementation" });
  s.addText("From design to implementation", { placeholder: "title" });
  speaker(s, "Olwethu");
  const tiles = [[0.55, 1.35, "MOBILE EXPERIENCE", "Expo / React Native farmer app", BLUE], [6.75, 1.35, "PLATFORM OVERSIGHT", "Admin console (TypeScript + Vite)", TEAL], [0.55, 4.15, "CONNECTED HARDWARE", "ESP32 kit · soil probe · DHT11 · relay · pump", GREEN], [6.75, 4.15, "IRRIGATION LOGIC", "ESP32 firmware acting on MQTT commands", FOREST]];
  tiles.forEach(([x, y, t, sub, c], i) => {
    card(s, x, y, 6.0, 2.62, LIGHT, LIGHT, "Evidence tile " + (i + 1));
    txt(s, t, { x: x + 0.2, y: y + 0.2, w: 2.15, h: 0.55, fontSize: 13, bold: true, color: c });
    txt(s, sub, { x: x + 0.2, y: y + 0.8, w: 2.1, h: 1.2, fontSize: 12, color: GREY });
  });
  phone(s, "mobile-zone-manual-run.png", 3.0, 1.47, 2.38, "Mobile — zone control");
  phone(s, "mobile-reports.png", 4.25, 1.47, 2.38, "Mobile — reports");
  s.addImage({ path: A("ui/admin-home.png"), x: 9.2, y: 1.55, w: 3.4, h: 3.4 / 1.6, objectName: "Admin console — Home" });
  // Hardware photo: none exists in any supplied source. Editable placeholder.
  s.addText([{ text: "INSERT REAL KIT PHOTO", options: { bold: true, breakLine: true } }, { text: "No hardware photo in milestones or repo", options: { fontSize: 10 } }], {
    shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.08, x: 3.0, y: 4.33, w: 3.35, h: 2.25, fill: { color: WHITE }, line: { color: GREEN, width: 1.5, dashType: "dash" },
    fontSize: 13, color: GREEN, align: "center", valign: "middle", margin: 0, objectName: "PHOTO PLACEHOLDER — replace with real hardware photo", isTextBox: true,
  });
  const ew = 3.4, eh = ew * 1246 / 2212;
  s.addImage({ path: A("code/esp32-handle-mqtt-command.png"), x: 9.2, y: 4.3 + (2.3 - eh) / 2, w: ew, h: eh, objectName: "Code: ESP32 handleMqttCommand" });
  s.addNotes(
    "SPEAKER 4 — Olwethu Nkabinde (Soft Skills). ~30 s.\n" +
    "Thanks, Philisile. This slide is our evidence that AgroFlow moved past concepts and mock-ups. " +
    "Top left is the farmer app: a zone's irrigation control and the reports screen. Top right is the admin console's home page, which starts with what needs attention across every farm. " +
    "Bottom left is the physical kit [describe photo]. And bottom right is the firmware running on the ESP32: when an MQTT 'start' command arrives with a duration, it switches the pump on, and on 'stop' it switches it off.\n\n" +
    "Sources: screenshots captured from the running apps on 6 Oct 2026 (apps/mobile via Expo web; apps/web/admin via Vite). The build sandbox could not reach Supabase or Railway, so data comes from a local fixture mirroring docs/demo-account.md — no sensor values were invented, which is why readings show 'No reading'. " +
    "Code: hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino lines 492–509.\n" +
    "ACTION: replace the dashed box with a real photo of the kit before presenting; consider re-capturing the app screens from the live system on a phone."
  );

  // =====================================================================
  // 9. PROGRESS
  // =====================================================================
  s = pres.addSlide({ masterName: "AF_CONTENT", sectionTitle: "Implementation" });
  s.addText("What AgroFlow delivers", { placeholder: "title" });
  speaker(s, "Olwethu");
  const prog = [
    [fa.FaMicrochip, "FIELD SYSTEM", GREEN, ["Kit per zone: probe, DHT11, relay, pump", "One-time enrolment code + Wi-Fi setup", "Offline fallback watering", "5-minute pump safety cap"]],
    [fa.FaServer, "PLATFORM", TEAL, ["MQTT over TLS via HiveMQ", "Auto-irrigation from thresholds", "FAO-56 advice + Open-Meteo", "Telegram alerts"]],
    [fa.FaMobileAlt, "FARMER APP", BLUE, ["Live zone readings and health", "Automatic / scheduled / manual", "Manual start and stop", "Water-usage reports (PDF)"]],
    [fa.FaDesktop, "ADMINISTRATION", FOREST, ["Farm and kit wizards", "Kits online / offline", "Alerts and requests", "Excel, PDF and CSV exports"]],
  ];
  for (let i = 0; i < 4; i++) {
    const x = 0.55 + i * 3.1;
    card(s, x, 1.35, 2.85, 3.75, WHITE, LINE, prog[i][1]);
    await iconCircle(s, prog[i][0], x + 0.2, 1.52, 0.55, LIGHT, prog[i][2]);
    txt(s, prog[i][1], { x: x + 0.85, y: 1.52, w: 1.9, h: 0.55, fontSize: 14, bold: true, color: prog[i][2], valign: "middle" });
    txt(s, prog[i][3].map((t, j) => ({ text: "✓  " + t, options: { breakLine: j < prog[i][3].length - 1 } })), { x: x + 0.2, y: 2.25, w: 2.55, h: 2.75, fontSize: 14, paraSpaceAfter: 10 });
  }
  card(s, 0.55, 5.3, 12.2, 1.4, AMBER_T, AMBER_T, "Not yet");
  txt(s, "○  NOT YET / NEXT", { x: 0.8, y: 5.42, w: 3, h: 0.3, fontSize: 13, bold: true, color: "7A5300" });
  txt(s, [
    { text: "Maintenance jobs and alert assignment are session-only (no table behind them)   ·   Per-kit uptime not measured", options: { breakLine: true } },
    { text: "Kit restart / remove from console is session-only   ·   ESP-NOW gateway and Supabase Realtime (Milestone 3 design) not built" },
  ], { x: 0.8, y: 5.78, w: 11.8, h: 0.8, fontSize: 13, color: NAVY, paraSpaceAfter: 4 });
  s.addNotes(
    "SPEAKER 4 — Olwethu. ~35 s.\n" +
    "This is where the project stands. In the field, each zone has a working kit that enrols with a one-time code, keeps watering on local rules if it loses its connection, and never runs the pump for more than five minutes in one go. " +
    "The platform handles MQTT, automatic irrigation, FAO-56 advice and Telegram alerts. Farmers get live readings, three irrigation modes, manual start and stop, and reports. Administrators get wizards to register farms and kits, kit status, alerts and exports. " +
    "We also want to be honest about what isn't finished: maintenance jobs and alert assignment only last for the browser session, per-kit uptime isn't measured, and two ideas from our Milestone 3 design — an ESP-NOW gateway and Supabase Realtime — weren't built.\n\n" +
    "Sources: docs/final-finish-report.md 'Still not done'; docs/release-notes-v2.md 'What is not connected yet'; firmware v1.2–1.4 header; admin exports commit 2ff6594. " +
    "Not on the slide because it could not be verified here: the report states 650 domain tests pass (dotnet was not available in this environment), and the admin audit log depends on migration 0038 being applied and the dev branch being deployed."
  );

  // =====================================================================
  // 10. JOURNEY
  // =====================================================================
  s = pres.addSlide({ masterName: "AF_CONTENT", sectionTitle: "Implementation" });
  s.addText("The journey we will demonstrate", { placeholder: "title" });
  speaker(s, "Olwethu");
  const steps = [
    ["Farmer opens AgroFlow", "Drip points to today's one action", BLUE],
    ["Zone 2 is critical", "Soil moisture below its start level", AMBER],
    ["Reads the advice", "FAO-56: water now, about 5 min", TEAL],
    ["Starts a manual run", "Switches the zone to Manual", BLUE],
    ["Command reaches the kit", "API → MQTT → ESP32 → pump", GREEN],
    ["Run is recorded", "History: 5 min, Zone 2, manual", TEAL],
    ["Admin follows up", "Alert, kits, reports, activity", FOREST],
  ];
  for (let i = 0; i < steps.length; i++) {
    const x = 0.55 + i * 1.76;
    s.addText(String(i + 1), { shape: pres.shapes.OVAL, x: x + 0.6, y: 1.35, w: 0.42, h: 0.42, fill: { color: steps[i][2] }, line: { color: steps[i][2] }, fontSize: 14, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: "Step " + (i + 1) });
    if (i < steps.length - 1) arrow(s, x + 1.08, 1.56, x + 2.3, 1.56, LINE);
    txt(s, steps[i][0], { x: x, y: 1.88, w: 1.62, h: 0.5, fontSize: 13, bold: true, align: "center" });
    txt(s, steps[i][1], { x: x, y: 2.36, w: 1.62, h: 0.6, fontSize: 11, color: GREY, align: "center" });
  }
  // Screens from the team's system-demo capture (showcase/assets/screens): real app, illustrative demo data.
  const DPH = 1756 / 848, dh = 3.25, dw = dh / DPH;
  [["demo-m-zone2.png", "Zone 2 readings and advice"], ["demo-m-zone2-sent.png", "Manual run sent"], ["demo-m-history.png", "Run recorded in History"]].forEach(([f, n], i) =>
    s.addImage({ path: A("ui/" + f), x: 0.75 + i * 1.85, y: 3.2, w: dw, h: dh, objectName: "Demo screen — " + n }));
  caption(s, "Screens from our system demo: real app, illustrative demo data", 0.75, 6.55, 5.4);
  card(s, 6.45, 3.25, 3.0, 2.05, AMBER_T, AMBER_T, "Validation example");
  txt(s, [
    { text: "VALIDATION IN THE DEMO", options: { bold: true, color: "7A5300", fontSize: 11, breakLine: true } },
    { text: "Farmer types 90 minutes", options: { breakLine: true } },
    { text: "↓", options: { breakLine: true, color: "7A5300" } },
    { text: "“Enter a duration between 1 and 60 minutes.”", options: { italic: true, breakLine: true } },
    { text: "↓", options: { breakLine: true, color: "7A5300" } },
    { text: "Corrected to 5 → confirmed → sent" },
  ], { x: 6.6, y: 3.35, w: 2.7, h: 1.85, fontSize: 12, align: "center" });
  s.addImage({ path: A("ui/demo-a-kits.png"), x: 9.7, y: 3.25, w: 3.05, h: 3.05 * 1620 / 2880, objectName: "Demo screen — admin kits" });
  caption(s, "Admin console · Kits (demo data)", 9.7, 3.3 + 3.05 * 1620 / 2880, 3.05, { align: "center" });
  txt(s, "Now, let's see AgroFlow in action.", { x: 6.45, y: 5.85, w: 6.3, h: 0.65, fontSize: 24, bold: true, color: TEAL, valign: "middle" });
  s.addNotes(
    "SPEAKER 4 — Olwethu. ~45 s.\n" +
    "x\n\n" +
    "Source: the team's system demo (showcase/narration.md, showcase/system-audit.md, showcase/assets/screens/*). Screens are the real, unmodified app answering with clearly labelled illustrative demo data (showcase/capture/demo-data.mjs), approved by the team per showcase/system-audit.md. " +
    "Validation: apps/mobile/src/app/zone/[id].tsx handleStartManualRun ('Enter a duration between 1 and 60 minutes.'). The demo uses 5 minutes, which fits the firmware's 5-minute safety cap."
  );

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
