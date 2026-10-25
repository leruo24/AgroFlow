-- RET-02 (live web retest, 23 October 2026): farmers were asked to accept documents marked
-- "Draft – needs approval". Acceptance is now a staff setting, OFF by default. While it is off the
-- farmer's "Before you start" shows the terms and the privacy notice as "Preview – not yet in
-- effect", with no checkbox, and the API refuses to record an acceptance. Even when staff switch
-- it on, nothing is recorded while either document is still a draft (LegalDocuments.AcceptanceOpen),
-- so a draft is never accepted.
--
-- The API already treats a missing row as off; this row only lets staff switch it on in Settings
-- (AppSettingsStore.SetAsync updates existing rows). Safe to run more than once: an existing
-- value is kept.

insert into app_setting (key, value, description, source) values
  ('terms.acceptance_enabled', 'false',
   'Ask farmers to accept the terms and the privacy notice. Off: the documents are shown as a preview, not yet in effect, and no acceptance is recorded. Has no effect while either document is a draft.',
   'Live web retest RET-02 (team decision)')
on conflict (key) do nothing;
