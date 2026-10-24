# AGROFLOW — PREMIUM VISUAL REDESIGN & IMAGE INTEGRATION

> Implementation overrides confirmed 24 Oct 2026: **GO GREEN**. Use only the
> originals already in `apps/web/admin/public/images/agroflow/`, not Downloads.
> Keep the five tabs, Kit checklist, four tasks/hosepipe progress, honest data
> states, terms preview, 1200px/16–24–32px layout and reduced motion. Glass is
> decorative only. No business logic, API, firmware, migration or route changes.
> The historical Downloads instructions below are superseded by these overrides.

## YOUR TASK

Upgrade the existing AgroFlow application into a visually rich, premium agricultural technology platform using the farm photographs I have already provided.

**The images are already available on my computer in the Downloads folder. Do not ask me to regenerate them or download replacements.**

First locate the images in the project workspace or accessible Downloads directory. If Downloads is outside your accessible workspace, explain the access limitation and identify the exact files that need copying.

I want actual implementation, not design suggestions, mockups or a plan.

The existing application already has a visual design that I generally like. Your job is to elevate it by introducing realistic agricultural imagery, improving containers, incorporating subtle gradients and making the application feel more immersive.

The goal is to make AgroFlow feel like a polished, modern agricultural SaaS platform rather than a plain administrative dashboard.

**Important: Do not redesign everything from scratch. Preserve the existing design language and improve it.**

---

## 1. IMAGE ASSETS — USE THE EXISTING PHOTOGRAPHS

The following images are available:

1. `agroflow_farm_aerial.png`
2. `agroflow_sprinkler_closeup.png`
3. `agroflow_field_irrigation.png`
4. `agroflow_planting_seedling.png`
5. `agroflow_tomato_greenhouse_evening.png`
6. `agroflow_water_reservoir.png`
7. `agroflow_hero_farm.jpg`
8. `agroflow_more_field_sensor.jpg`
9. `agroflow_more_leafy_crops.jpg`
10. `agroflow_more_water_tanks.jpg`

Use the exact filenames where available.

Search the repository first, then the accessible Downloads directory if necessary.

Copy the assets into an appropriate project directory such as:

`public/images/agroflow/`

Do not introduce duplicate copies unnecessarily.

Create a reusable asset registry so images can be referenced consistently throughout the application.

Optimise image dimensions, formats and loading behaviour.

Do not use unrelated external stock photography.

Do not add fake farm data to the application.

---

## 2. DESIGN DIRECTION

The design should combine:

- Modern agricultural photography.
- Deep green branding.
- Warm earth tones.
- Soft off-white backgrounds.
- Subtle blue and gold accents.
- Clean typography.
- Large, comfortable buttons.
- Tasteful glassmorphism.
- Elegant gradients.
- Smooth transitions.
- Rounded photographic containers.
- Professional spacing.

### Colour palette

Use the following colours as guidance:

| Purpose | Colour |
|---|---|
| Primary green | `#176B45` |
| Dark green | `#104B38` |
| Warm off-white | `#F7F8F4` |
| Earth brown | `#B58B62` |
| Soft gold | `#E8C88F` |
| Sky blue | `#B9DCE8` |
| Dark text | `#172822` |

Do not make everything green.

Let the photographs introduce natural colour variation.

Use warm backgrounds and green accents to create balance.

---

## 3. PUBLIC WEBSITE — COMPLETE VISUAL ENHANCEMENT

### Homepage hero

Use `agroflow_hero_farm.jpg` as the primary hero photograph if its resolution is sufficient.

Otherwise use the highest-quality suitable landscape already available.

The hero should have:

- A beautiful agricultural landscape.
- Wide cinematic composition.
- Subtle dark gradient overlay.
- Large white or dark text depending on contrast.
- Rounded or edge-to-edge presentation consistent with the existing layout.
- Prominent primary CTA.
- Soft entrance animation.
- No unnecessary loading screen.

Use the existing homepage copy unless there is a clear visual reason to adjust its formatting.

Do not remove existing buttons or change their destinations.

### Homepage feature sections

Use the following associations:

**Smart Irrigation**

Image: `agroflow_sprinkler_closeup.png`

Show the photograph alongside the existing irrigation feature description.

**Automated Watering**

Image: `agroflow_field_irrigation.png`

Use an image-and-text layout.

**Real-Time Monitoring**

Image: `agroflow_more_field_sensor.jpg`

Showcase AgroFlow's sensor capabilities.

**Sustainable Farming**

Image: `agroflow_planting_seedling.png`

Use a warm, welcoming photographic section.

**Water Management**

Image: `agroflow_water_reservoir.png`

Pair the photograph with the existing water-management messaging.

These should not all use identical card layouts.

Alternate between wide images, split layouts and smaller supporting photographs to create visual rhythm.

---

## 4. FARMER DASHBOARD — MAKE IT FEEL LIKE A REAL FARM

This is one of the most important improvements.

### Welcome banner

Introduce a refined landscape banner using:

`agroflow_farm_aerial.png`

Design it as a compact but visually rich header.

Display existing dynamic greeting and farm information on or beside the photograph.

Use a dark gradient where text overlaps the image.

The banner must remain compact on mobile and must not push important information too far down the screen.

### My Farms

Redesign farm cards to incorporate photographs.

Use stable fallback imagery from the available landscape, greenhouse and crop photographs.

Each card should feature:

- Farm photograph.
- Actual farm name.
- Actual location, where available.
- Existing farm status.
- Relevant zone information.
- Clear navigation indicator.
- Soft hover or press interaction.

Use rounded images with clean text containers.

Do not display fictional farm names, locations, zone counts or statuses.

Do not randomly change a farm's fallback picture every time the page renders.

### Farm overview

Add a tasteful farm cover image to the existing farm detail screen, provided it fits the current layout.

The image should complement the farm's real information, not compete with it.

### Irrigation management

Use:

`agroflow_sprinkler_closeup.png`

or

`agroflow_field_irrigation.png`

as a small feature image or banner.

Keep irrigation controls prominent.

Start, Stop, scheduling and manual override actions must remain easy to see and operate.

### Sensor management

Use:

`agroflow_more_field_sensor.jpg`

as a contextual image in the sensor overview or explanatory section.

Do not place busy photographs directly behind numerical sensor readings.

### Crop and zone cards

Use:

`agroflow_more_leafy_crops.jpg`

and

`agroflow_tomato_greenhouse_evening.png`

for relevant crop imagery and fallback zone artwork.

Crop imagery must not imply a particular crop is present unless that information is supported by the farm's actual data.

---

## 5. ADMIN DASHBOARD — ELEGANT BUT RESTRAINED

The administrative dashboard must remain professional, clean and data-driven.

Do not turn it into a marketing website.

### Overview

Introduce a subtle agricultural visual element near the top of the admin dashboard.

Do not replace KPI cards, charts or operational information.

### Farms

Use farm thumbnails where appropriate to improve recognition.

### Maintenance

Use:

`agroflow_more_water_tanks.jpg`

for maintenance-related headers or equipment sections.

### Reports

Use photographs only in introductory or summary areas where they add context.

Keep graphs and reporting tables clean.

### Alerts and audit logs

Avoid large decorative imagery.

These pages must prioritise readability, accuracy and fast decision-making.

---

## 6. MOBILE EXPERIENCE — MAKE IT FEEL PREMIUM

The mobile experience should receive equal attention.

Use responsive imagery throughout relevant screens.

### Mobile welcome banner

Use a compact landscape photograph with a soft gradient overlay.

Ensure the user can immediately access important dashboard functions.

### Farm cards

Introduce attractive farm thumbnails and clean rounded containers.

### Navigation bar

Refine the existing bottom navigation with:

- Subtle green gradient.
- Soft translucent surface.
- Light frosted-glass effect where supported.
- Clear active-state styling.
- Smooth transitions.
- Proper safe-area spacing.
- Consistent icon alignment.

Do not make the navbar excessively tall.

### Mobile containers

Inspect the existing card and container alignment.

Fix:

- Uneven horizontal padding.
- Elements extending outside their parents.
- Inconsistent border radii.
- Excessive nested containers.
- Awkward empty spacing.
- Cropped content.
- Inconsistent widths.
- Text wrapping issues.

All primary content should follow a consistent horizontal alignment system.

---

## 7. IMPORTANT — IMPROVE THE VISUAL COMPOSITION

Do not simply insert images into existing cards without considering the surrounding layout.

For every photograph:

1. Choose an appropriate container.
2. Determine the correct aspect ratio.
3. Apply controlled image cropping.
4. Ensure proper contrast for text.
5. Use appropriate corner radii.
6. Balance image size with surrounding content.
7. Add subtle shadows where appropriate.
8. Prevent distortion and stretching.

Use `object-fit: cover` where appropriate.

Maintain consistent image heights within card grids.

Use restrained hover scaling for interactive image cards on desktop.

Do not introduce aggressive zoom animations.

### Glassmorphism

Use glass panels primarily where text or small status information appears over imagery.

Recommended styling:

- White translucent surface.
- Mild backdrop blur.
- Thin translucent border.
- Soft shadow.
- Clear foreground text.

Avoid excessive blur, especially on mobile.

### Photography balance

Not every page needs a large image.

The user should still feel that this is a functional application.

Use photography strategically to communicate farming, irrigation, sustainability and the physical environment being monitored.

---

## 8. REMOVE SLOW AND REPETITIVE LOADING SCREENS

Inspect the current loading experience.

The public-facing website previously had repeated full-screen loading transitions when navigating between pages.

Eliminate unnecessary repeated loading screens.

Prefer:

- Persistent layouts.
- Lightweight skeleton components.
- Image placeholders.
- Lazy loading for below-the-fold images.
- Progressive rendering.
- Cached assets.
- Smooth page transitions without blocking the interface.

Do not preload the entire image collection before rendering the homepage.

Maintain reasonable performance on slower mobile connections.

---

## 9. TECHNICAL RESTRICTIONS

Do not modify the application’s core business logic.

Preserve:

- Authentication.
- Role-based access control.
- Existing routes.
- Supabase or backend connectivity.
- API endpoints.
- ESP32 integrations.
- Irrigation commands.
- Irrigation scheduling.
- Sensor data processing.
- Notification functionality.
- Existing reports.
- Farm management logic.

Do not introduce hardcoded production data.

Do not remove existing working features.

Do not redesign functional workflows merely to accommodate photographs.

Reuse existing components, design tokens and styling utilities where possible.

---

## 10. IMPLEMENTATION AND VERIFICATION

Proceed with the implementation.

Do not stop after producing recommendations.

Work through the existing codebase and apply the improvements.

After implementation:

1. Run the relevant build.
2. Run existing frontend checks.
3. Resolve errors introduced by the changes.
4. Verify image paths.
5. Confirm images display correctly.
6. Check desktop responsiveness.
7. Check mobile responsiveness.
8. Check navigation and primary interactions.
9. Ensure no new loading delays.
10. Confirm no core functionality was changed.

Where browser testing is available, capture screenshots of the finished pages.

If browser testing is unavailable, explicitly state that the layouts were not visually verified.

---

## 11. FINAL DELIVERABLE

Provide a concise report containing:

- Which images were successfully imported.
- Which pages were enhanced.
- Which components were created or modified.
- What styling improvements were made.
- Any visual or responsive issues corrected.
- Build and test results.
- Any remaining limitations.

Do not claim completion for changes that were not implemented.

## FINAL INSTRUCTION

The current AgroFlow design already has a good foundation.

I want you to make it significantly more visually appealing without destroying that foundation.

The final result should feel:

**Modern. Agricultural. Immersive. Professional. Smooth. Premium.**

Make it feel like a product built for real farmers, with real landscapes, real irrigation environments and modern digital tools.

Use the images that already exist.

Implement the improvements directly.

Preserve functionality.

Do not ask for design decisions that have already been specified above.

Begin by locating the available image files and examining the existing UI.
