# Technical accuracy checklist

Every technical statement shown on screen, and where in the repository it is confirmed.
Paths are relative to the repository root. "Conceptual" = diagram/illustration, not a
capture of real software. All numeric readings are illustrative demo values.

## Real UI vs conceptual

| Scene | Content | Kind |
|---|---|---|
| 1 Intro | Network mark, wordmark | Conceptual |
| 2 Field | Field illustration, readings | Conceptual, illustrative values |
| 3 Data flow | Architecture diagram | Conceptual |
| 4 Decision | Zone / weather / analysis cards | Conceptual, illustrative values |
| 5 Command | Command path, field close-up, loop | Conceptual, illustrative values |
| 6 Farmer | `apps/mobile` screens (Expo web) | **Real UI**, demo data via network stubs |
| 7 Admin | `apps/web/admin` screens | **Real UI**, demo data via network stubs |
| 8 / Final | Summary diagram, end card | Conceptual |

The real screens were rendered from the unmodified apps; only their network responses were
answered with demo data (`capture/admin-capture.mjs`, `capture/mobile-capture.mjs`), following
the project's own fixture approach in `apps/mobile/scripts/ui-smoke.mjs`. Every demo farm name
carries "(demo)".

## Statements

| On screen | Confirmed by |
|---|---|
| Soil moisture sensor, DHT11 temperature/humidity, relay, pump per zone | `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino` (pins: soil 32, relay 25, DHT11 27), `hardware/README.md` ("one per irrigation zone") |
| ESP32 field controller receives several readings | Firmware publishes `{"sensorType","value"}` per sensor; `backend/AgroFlow.Domain/Sensor.cs` |
| MQTT over TLS, HiveMQ Cloud broker | `hardware/shared/MQTT_TOPICS.md` |
| topic `agroflow/farm/{farmId}/device/{deviceId}/sensors` | `backend/AgroFlow.Api/Mqtt/MqttTopics.cs` |
| AgroFlow.Api (.NET): ingestion, rules, advice | `backend/AgroFlow.Api/Services/SensorReadingProcessor.cs`, `Fao56EngineService.cs` |
| Supabase · Postgres · Row Level Security | `README.md`, `supabase/migrations/0011_row_level_security.sql` |
| Weather from Open-Meteo, every 6 h | `backend/AgroFlow.Api/Services/WeatherCollectionService.cs` (default `Weather:FetchIntervalHours` = 6) |
| Data examples: moisture, temperature, humidity, device status, weather | `sensor_reading`, `hardware.status/last_seen` (`DeviceStatusMonitorService.cs`), `weather_daily` (0016) |
| Irrigation analysis = FAO-56 water balance, deterministic, not an AI model | `backend/AgroFlow.Domain/Agronomy/IrrigationAdvisor.cs` ("This is NOT a language model") |
| Advice text "Water Zone 1 now: about 12 min (~18 L)." | Template in `backend/AgroFlow.Domain/Agronomy/ZoneInsightBuilder.cs` (`Water {zone} now: about {minutes} min (~{litres} L).`) |
| Advice stored as an `ai_recommendation` insight, shown in the farmer app | `backend/AgroFlow.Domain/Fao56EngineXDB.cs` (insert), `apps/mobile/src/services/insightsService.ts` |
| Advice does not switch the pump | `backend/AgroFlow.Domain/AIRecommendation.cs` ("it advises, it does not actuate") |
| Automatic mode: moisture below start level -> start command | `Zone.ShouldStartIrrigation` (`backend/AgroFlow.Domain/Zone.cs`), `IrrigationMode.AllowsAutoCommands` (`IrrigationMode.cs`), `SensorReadingProcessor.cs` |
| Scheduled / manual modes do not take sensor-triggered commands | `backend/AgroFlow.Domain/IrrigationMode.cs` |
| Command path: `irrigation_commands` row -> Postgres LISTEN/NOTIFY -> AgroFlow.Api -> MQTT `.../commands` -> ESP32 | `backend/AgroFlow.Api/Mqtt/IrrigationCommandNotifyService.cs`, migration 0009 |
| Relay -> pump | Firmware `RELAY_PIN`, `hardware/esp32/AgroFlowIrrigationNode/README.md` |
| Pump run logged via `POST /api/irrigation-events` | Firmware header comment; `backend/AgroFlow.Api/Endpoints/IrrigationEventEndpoints.cs` |
| Relay status "Unknown" in the app (no live run-state) | `apps/mobile/src/context/AgroFlowContext.tsx` (relay/pump status note) |
| Admin console is oversight only, no irrigation controls | `apps/web/admin/README.md` ("does not ... allow manual irrigation triggering") |
| Kits page: connection, last seen, device token, status, Service action | `apps/web/admin/src/pages/operations.ts` |
| Alert workflow New -> Assigned -> In Progress -> ... -> Resolved | Alert Queue subtitle and actions in `apps/web/admin/src/pages/operations.ts` |
| Administrator actions are recorded | `supabase/migrations/0037_admin_audit_log.sql`, `apps/web/admin/src/pages/analytics.ts` (Activity) |

## Simplifications (deliberate)

- The water source, supply line and pump placement in the field illustration are generic;
  the repository does not specify site plumbing.
- The architecture row draws AgroFlow.Api -> Supabase -> interfaces as one chain. In the code
  the apps also call AgroFlow.Api directly for some data (e.g. `/api/farmer/dashboard`); the
  diagram does not claim exclusivity.
- The "Reason" line under the advice is an illustrative paraphrase, not engine output.
- Moisture values 34% -> 39% -> 44% are illustrative, not measured results.
