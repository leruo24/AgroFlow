-- zone.planting_date: the one schema gap between AgroFlow's zone table and
-- FAO-56 stage-aware irrigation advice.
--
-- The whole growth-stage engine (backend/AgroFlow.Domain/Agronomy) answers
-- "which of the four FAO-56 stages is this crop in today, and what is its Kc?"
-- from exactly two inputs: the crop's tabulated stage lengths (FAO-56
-- Table 11) and days-after-planting. The first is committed in
-- Agronomy/fao56-crop-knowledge.json. The second needs this column, and
-- nothing in the schema records it today - verified by grepping every
-- migration in this directory for "planting".
--
-- NULLABLE ON PURPOSE. Every existing zone gets NULL, and the advisor treats
-- NULL as "cannot determine stage": it falls back to moisture-threshold-only
-- advice and states plainly in its output that stage-aware guidance needs a
-- planting date. It does not guess a date and it does not fail. So this
-- column can be added to the live database with zero coordination and zero
-- downtime, and each zone starts producing stage-aware advice the moment
-- someone fills it in.
--
-- THE UI FOR THIS COLUMN IS NOT MINE TO ADD. Capturing planting_date belongs
-- in the farmer-onboarding / zone-setup flow, which is Phili's area
-- (apps/web/admin onboarding, FarmerOnboardingEndpoints.cs). This migration
-- deliberately stops at the column. See docs/OVERNIGHT_REPORT.md - wiring the
-- input field needs coordinating with her, not doing behind her back.
--
-- Run this in the Supabase SQL editor. Idempotent - safe to re-run.

alter table zone
    add column if not exists planting_date date;

comment on column zone.planting_date is
    'Date the current crop was planted, used with FAO-56 Table 11 stage lengths to determine growth stage and Kc. Nullable: when null, irrigation advice falls back to moisture-threshold-only and says so. For perennials such as citrus this is the start of the annual cycle, not the year the tree was planted (FAO-56 p. 96).';
