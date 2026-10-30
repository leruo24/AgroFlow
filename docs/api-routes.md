# API routes (contract audit)

100 routes, read from the running API's own route table by `ApiContractTests`. All 73 baseline routes are present (`Every_baseline_route_still_exists`).

| Method | Route | Who may call it |
|---|---|---|
| GET | `/api/admin/activity` | admins only (403 for a farmer) |
| GET | `/api/admin/activity/{entityType}/{entityId}` | admins only (403 for a farmer) |
| GET | `/api/admin/enquiries` | admins only (403 for a farmer) |
| GET | `/api/admin/enquiries/summary` | admins only (403 for a farmer) |
| POST | `/api/admin/enquiries/{id:long}/anonymise` | admins only (403 for a farmer) |
| GET | `/api/admin/enquiries/{id:long}/calls` | admins only (403 for a farmer) |
| POST | `/api/admin/enquiries/{id:long}/calls` | admins only (403 for a farmer) |
| POST | `/api/admin/enquiries/{id:long}/claim` | admins only (403 for a farmer) |
| POST | `/api/admin/enquiries/{id:long}/close` | admins only (403 for a farmer) |
| POST | `/api/admin/enquiries/{id:long}/onboarded` | admins only (403 for a farmer) |
| POST | `/api/admin/enquiries/{id:long}/take-over` | admins only (403 for a farmer) |
| GET | `/api/admin/farms/{farmId:long}/report-schedule` | admins only (403 for a farmer) |
| PUT | `/api/admin/farms/{farmId:long}/report-schedule` | admins only (403 for a farmer) |
| POST | `/api/admin/farms/{farmId:long}/report-schedule/test` | admins only (403 for a farmer) |
| POST | `/api/admin/handling/maintenance` | admins only (403 for a farmer) |
| GET | `/api/admin/handling/{kind}` | admins only (403 for a farmer) |
| POST | `/api/admin/handling/{kind}/{id:long}/action` | admins only (403 for a farmer) |
| POST | `/api/admin/handling/{kind}/{id:long}/claim` | admins only (403 for a farmer) |
| POST | `/api/admin/handling/{kind}/{id:long}/release` | admins only (403 for a farmer) |
| POST | `/api/admin/handling/{kind}/{id:long}/take-over` | admins only (403 for a farmer) |
| GET | `/api/admin/hardware` | admins only (403 for a farmer) |
| GET | `/api/admin/health` | admins only (403 for a farmer) |
| GET | `/api/admin/mqtt-logins` | admins only (403 for a farmer) |
| POST | `/api/admin/mqtt-logins` | admins only (403 for a farmer) |
| GET | `/api/admin/platform-config` | admins only (403 for a farmer) |
| POST | `/api/admin/recommended-settings/preview` | admins only (403 for a farmer) |
| GET | `/api/admin/reports/enquiries.pdf` | admins only (403 for a farmer) |
| GET | `/api/admin/reports/enquiries.xlsx` | admins only (403 for a farmer) |
| PUT | `/api/admin/requests/{requestId:long}/assign` | admins only (403 for a farmer) |
| PUT | `/api/admin/requests/{requestId:long}/status` | admins only (403 for a farmer) |
| GET | `/api/admin/summary.pdf` | admins only (403 for a farmer) |
| GET | `/api/admin/zones/{zoneId:long}/hardware` | admins only (403 for a farmer) |
| POST | `/api/admin/zones/{zoneId:long}/hardware/change-wifi` | admins only (403 for a farmer) |
| POST | `/api/admin/zones/{zoneId:long}/hardware/open-setup` | admins only (403 for a farmer) |
| POST | `/api/admin/zones/{zoneId:long}/hardware/revoke` | admins only (403 for a farmer) |
| POST | `/api/admin/zones/{zoneId:long}/run-advice` | admins only (403 for a farmer) |
| POST | `/api/auth/forgot-password` | anyone (device key/token or public by design) |
| POST | `/api/devices/claim` | anyone (device key/token or public by design) |
| POST | `/api/devices/commands/{id}/executed` | anyone (device key/token or public by design) |
| POST | `/api/devices/enroll` | admins only (403 for a farmer) |
| GET | `/api/devices/firmware-check` | anyone (device key/token or public by design) |
| GET | `/api/devices/mqtt-credentials` | anyone (device key/token or public by design) |
| GET | `/api/farmer/auto-reports` | any signed-in user, their own data only |
| POST | `/api/farmer/auto-reports/stop` | any signed-in user, their own data only |
| GET | `/api/farmer/dashboard` | any signed-in user, their own data only |
| GET | `/api/farmer/farms/{farmId:long}/today` | any signed-in user, their own data only |
| GET | `/api/farmer/forecast` | any signed-in user, their own data only |
| POST | `/api/farmer/insights/{insightType}/dismiss` | any signed-in user, their own data only |
| POST | `/api/farmer/password-changed` | any signed-in user, their own data only |
| PUT | `/api/farmer/profile` | any signed-in user, their own data only |
| GET | `/api/farmer/report-requests` | any signed-in user, their own data only |
| POST | `/api/farmer/report-requests` | any signed-in user, their own data only |
| GET | `/api/farmer/reports/moisture` | any signed-in user, their own data only |
| GET | `/api/farmer/reports/moisture/pdf` | any signed-in user, their own data only |
| GET | `/api/farmer/reports/schedule` | any signed-in user, their own data only |
| GET | `/api/farmer/reports/schedule/pdf` | any signed-in user, their own data only |
| GET | `/api/farmer/reports/water-usage` | any signed-in user, their own data only |
| GET | `/api/farmer/reports/water-usage/pdf` | any signed-in user, their own data only |
| GET | `/api/farmer/reports/water-usage/xlsx` | any signed-in user, their own data only |
| GET | `/api/farmer/reports/zones` | any signed-in user, their own data only |
| POST | `/api/farmer/requests` | any signed-in user, their own data only |
| POST | `/api/farmer/telegram/link-code` | any signed-in user, their own data only |
| GET | `/api/farmer/weather/current` | any signed-in user, their own data only |
| POST | `/api/farmer/zones/{zoneId:long}/calibration` | any signed-in user, their own data only |
| POST | `/api/farmer/zones/{zoneId:long}/commands` | any signed-in user, their own data only |
| PUT | `/api/farmer/zones/{zoneId:long}/crop` | any signed-in user, their own data only |
| GET | `/api/farmer/zones/{zoneId:long}/hardware` | any signed-in user, their own data only |
| POST | `/api/farmer/zones/{zoneId:long}/hardware/change-wifi` | any signed-in user, their own data only |
| GET | `/api/farmer/zones/{zoneId:long}/insights` | any signed-in user, their own data only |
| POST | `/api/farmer/zones/{zoneId:long}/manual-watering` | any signed-in user, their own data only |
| GET | `/api/farmer/zones/{zoneId:long}/recommended-settings` | any signed-in user, their own data only |
| POST | `/api/farmer/zones/{zoneId:long}/reset-recommended` | any signed-in user, their own data only |
| PUT | `/api/farmer/zones/{zoneId:long}/settings` | any signed-in user, their own data only |
| PUT | `/api/farmer/zones/{zoneId:long}/setup` | any signed-in user, their own data only |
| PUT | `/api/farmer/zones/{zoneId:long}/soil` | any signed-in user, their own data only |
| POST | `/api/farmer/zones/{zoneId:long}/soil-feel` | any signed-in user, their own data only |
| POST | `/api/farmers/create` | admins only (403 for a farmer) |
| POST | `/api/farmers/invite` | admins only (403 for a farmer) |
| POST | `/api/farmers/onboard` | admins only (403 for a farmer) |
| GET | `/api/farms` | admins only (403 for a farmer) |
| POST | `/api/farms/register` | admins only (403 for a farmer) |
| POST | `/api/farms/{farmId:long}/zones` | admins only (403 for a farmer) |
| DELETE | `/api/farms/{id:long}` | admins only (403 for a farmer) |
| POST | `/api/farms/{id:long}/archive` | admins only (403 for a farmer) |
| POST | `/api/farms/{id:long}/restore` | admins only (403 for a farmer) |
| POST | `/api/irrigation-events` | anyone (device key/token or public by design) |
| POST | `/api/public/enquiries` | anyone (device key/token or public by design) |
| POST | `/api/sensor-readings` | anyone (device key/token or public by design) |
| POST | `/api/telegram/admin/codes/{profileId:guid}` | admins only (403 for a farmer) |
| POST | `/api/telegram/admin/codes/{profileId:guid}/link` | admins only (403 for a farmer) |
| POST | `/api/telegram/admin/password/{profileId:guid}` | admins only (403 for a farmer) |
| POST | `/api/telegram/admin/password/{profileId:guid}/send` | admins only (403 for a farmer) |
| DELETE | `/api/telegram/me` | any signed-in user, their own data only |
| GET | `/api/telegram/me` | any signed-in user, their own data only |
| POST | `/api/telegram/me/alerts` | any signed-in user, their own data only |
| POST | `/api/telegram/me/code` | any signed-in user, their own data only |
| POST | `/api/telegram/webhook` | anyone (device key/token or public by design) |
| GET | `/api/users` | admins only (403 for a farmer) |
| GET | `/api/users/farmers` | admins only (403 for a farmer) |
| DELETE | `/api/users/{id:guid}` | admins only (403 for a farmer) |
