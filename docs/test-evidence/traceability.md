# Requirements → tests

Each major feature, and the tests that prove it. Backend tests are classes in
`backend/AgroFlow.Domain.Tests/`; admin tests are Playwright specs in
`apps/web/admin/tests/`; mobile tests are jest files under `apps/mobile/src/`.

| Feature | Backend (xUnit) | Admin (Playwright) | Mobile (jest) |
|---|---|---|---|
| FAO-56 engine (ETo, Kc, TAW/RAW, Ks, water balance) | `Fao56EngineVerificationTests` (Examples 14, 18, 28, 36, 37), `ReferenceEvapotranspirationTests`, `Fao56EngineDataRulesTests`, `GrowthStageCalculatorTests` | | |
| Soil types | `SoilClassVerificationTests`, `RuleBookTests` (SoilRules), `RuleBookMatrixTests` (sand < loam < clay, every crop and stage) | `setup.spec.ts` (soil cards) | `screens.test.tsx` (Finish setup: soil step) |
| **Rule book** | `RuleBookTests`, `RuleBookMatrixTests` (every crop × soil × stage at RAW, rain = need, ratio 1.2/0.8; every RuleBook method called by a test), `RuleBookDocument` (docs/rule-book.md) | | |
| **Actionable insights** | `IrrigationAdvisorTests`, `ExplanationTests` (every insight type), `ManualLoggingTests` (TodayRules), `AdviceNeverBlockedTests` | `setup.spec.ts` (farm drawer: today's action) | `todayCard.test.tsx` |
| **"Why am I seeing this?"** | `ExplanationTests`, `TelegramWhyTests`, `ReportWhyTests` | `why.spec.ts` | `whySheet.test.tsx` |
| **Confidence and graceful degradation** | `AdviceNeverBlockedTests`, `ManualLoggingTests` (manual check named, never High), `EdgeCaseTests` (unknown crop, any planting date, sensor limits), `DependencyFailureTests` | `robustness.spec.ts` (every page empty / failing) | `todayCard.test.tsx`, `screens.test.tsx` |
| **Recommended settings** | `RecommendationTests` (potato / loam / 0.2 m² / 1.5 L/min / ETo 5; equals Reset; root-zone cap; climate source) | `recommend.spec.ts` | `recommendedCard.test.tsx` |
| **The farmer changing the crop** | `RecommendationTests` (checks, 403 for another farmer's zone, activity sentence, past reports keep the old crop), `EdgeCaseTests` (crop lists agree) | | `recommendedCard.test.tsx` (date stepper) |
| Manual logging ("I watered", soil feel) | `ManualLoggingTests`, `EdgeCaseTests` (SAST midnight) | | `todayCard.test.tsx` |
| Finish setup / registration wizard | `ManualLoggingTests` (ZoneSetupFields) | `setup.spec.ts`, `keyboard.spec.ts` | `screens.test.tsx` (500 mL bottle helper) |
| Reports / PDF / Excel | `ActionReportTests`, `WaterUsageReportFormulaTest`, `WaterUsageWorkbookTests`, `FarmWaterUsageReportTests`, `DesignedReportRenderSmokeTests`, `SampleReportsTests`, `HostileTextTests` | `reports.spec.ts` | `screens.test.tsx` (Reports) |
| **Telegram auto-report schedules** | `AutoReportScheduleTests`, `ReportSchedulePolicyTests` | `reports.spec.ts` | |
| Telegram | `FarmRequestMessagesTests`, `FarmRequestNotifierResilienceTests`, `TelegramWhyTests`, `SqlGuardTests` (sent once) | | |
| Device enrollment, tokens, MQTT pool | `DeviceTokenTests`, `ClaimRateLimiterTests`, `MqttPoolPasteParserTests`, `MqttPoolSecretBoxTests`, `MqttBrokerAddressTests`, `SecurityTests` (legacy key), `SqlGuardTests` (pool race), `FirmwareContractTests` | | |
| Change WiFi / kit commands | `DeviceSetupCommandsTests`, `DeviceCommandOwnershipTests`, `CommandReplayPolicyTests`, `SqlGuardTests` | | |
| Archive / audit log | `AuditLogAndSchemaCheckTests`, `SqlGuardTests` (append-only) | `hostile.spec.ts` (activity CSV) | |
| Health | `DependencyFailureTests` (database and broker down), `AuditLogAndSchemaCheckTests` (every migration probed) | | |
| RLS / permissions | `ApiContractTests` (401 everywhere without login; 403 for a farmer on all 53 admin routes; only known routes open), `SqlGuardTests` (ownership on every farmer route), `SecurityTests` (JWT) | `robustness.spec.ts` (a farmer is kept out) | |
| **Claim-based accountability** | `AccountabilityTests` | `accountability.spec.ts` | |
| **Request completion** | `RequestCompletionTests` | `requests.spec.ts` | |
| **The enquiry flow and its report** | `EnquiryTests`, `EnquiryReportTests` (counts against a hand-worked set) | `enquiry-form.spec.ts`, `enquiries.spec.ts` | `enquiry.test.ts`, `screens.test.tsx` (login link) |
| **Rapid-click navigation** | | `rapid-navigation.spec.ts`, `rapid-actions.spec.ts` | `router.test.ts`, `singleFlight.test.ts`, `doubleSubmit.test.ts` |
| Mobile screens | | | `screens.test.tsx` (Finish setup, login, Reports, forecast, alerts, help), `todayCard.test.tsx`, `recommendedCard.test.tsx`, `whySheet.test.tsx` (Drip) |
| API contract (baseline routes, firmware) | `ApiContractTests` (all 73 baseline routes), `FirmwareContractTests` | | |
