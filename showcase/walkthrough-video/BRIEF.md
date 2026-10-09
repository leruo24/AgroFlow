---
workflow: general-video
flow: automation
storyboard: no
message: "How the complete AgroFlow system works, from the field to the platform."
destination: university project presentation
aspect: "16:9 (1920x1080, 30 fps)"
language: en
audience: lecturers and assessors of a university systems project
length: "75-90 s"
angle: technically accurate system walkthrough, not a SaaS advert
---

## Intent

One continuous story: FIELD -> SENSOR DATA -> CONNECTED SYSTEM -> AGROFLOW SOFTWARE ->
IRRIGATION DECISION -> FIELD ACTION -> ADMINISTRATION & MONITORING. Eight scenes as
specified by the user (intro, field, data flow, data to decision, irrigation command,
farmer experience, administration console, whole system, final frame).

## Assets

- Real admin console screenshots: `assets/admin/` (captured from apps/web/admin, unmodified,
  with illustrative demo data — see capture/admin-capture.mjs).
- Real farmer app screenshots: `assets/mobile/` (captured from apps/mobile via Expo web,
  unmodified, with illustrative demo data — see capture/mobile-capture.mjs).
- AgroFlow icon: apps/web/admin/public/brand/agroflow-icon-512.png.
- SFX: subset of the Motion-Graphics starter kit (tick, switch, success, chime, pop).

## Customizations

- Palette requested by the user: green #16a34a, bright green #22c55e, blue #0ea5e9,
  navy #0f172a, background #f1f5f9, white. Amber/red only for warnings.
- Font: Inter. Restrained motion, no whooshes.

## Notes

- Accuracy over hype. Every technical label is checked against the repository
  (see ACCURACY.md). Real UI and conceptual visualisation are labelled on screen.
- User asked for a quick low-res preview, a check, then the final render to
  renders/agroflow-system-walkthrough.mp4 (treated as render approval).
