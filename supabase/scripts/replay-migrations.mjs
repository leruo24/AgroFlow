// Migration replay check, run on two separate empty databases:
//   1. every migration in order, with NO workarounds (the simulation's drop-view step is not
//      used); only pg_cron's CREATE EXTENSION is skipped (not installed locally);
//   2. 0007 and 0010 run again on the finished schema, which stands in for the live database:
//      the schema must not change (view, schedule function, zone columns, triggers);
//   3. docs/ops/verify-migrations.sql: every migration row must be true;
//   4. for information only: which files cannot be re-run as a whole chain.
// Usage: node supabase/scripts/replay-migrations.mjs <repo> <shim.sql>
//   e.g. node supabase/scripts/replay-migrations.mjs . hardware/sim/supabase-shim.sql
// Needs the embedded-postgres package on the module path (hardware/sim installs it; run
// `npm i --no-save embedded-postgres` in supabase/scripts or copy the script beside it).
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , repo, shimPath] = process.argv;
const migDir = path.join(repo, 'supabase', 'migrations');
const files = fs.readdirSync(migDir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
const read = file => fs.readFileSync(path.join(migDir, file), 'utf8')
  .replace(/create extension if not exists pg_cron\s*;/gi, '-- pg_cron not available locally');

async function run(client, file) {
  try {
    await client.query('begin');
    await client.query(read(file));
    await client.query('commit');
    return null;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return `${file}: ${error.message}`;
  }
}

const SNAPSHOT = `
select
  (select pg_get_viewdef('public.zone_latest_reading'::regclass)) as view_def,
  (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
    where table_schema='public' and table_name='zone_latest_reading') as view_cols,
  (select reloptions::text from pg_class where oid='public.zone_latest_reading'::regclass) as view_options,
  (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='fire_due_irrigation_schedules') as schedule_fn,
  (select string_agg(column_name || ':' || data_type || ':' || coalesce(column_default,''), ',' order by column_name)
     from information_schema.columns where table_schema='public' and table_name='zone') as zone_cols,
  (select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname) from pg_constraint
    where conrelid='public.zone'::regclass) as zone_constraints,
  (select string_agg(tgname, ',' order by tgname) from pg_trigger where not tgisinternal) as triggers,
  (select string_agg(proname, ',' order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public') as functions,
  (select to_regclass('public.irrigation_schedule') is null) as schedule_table_gone`;

async function replayOnce(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agroflow-replay-'));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'replay-only', port, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('agroflow');
  const client = pg.getPgClient('agroflow');
  await client.connect();
  const out = {};
  try {
    await client.query(fs.readFileSync(shimPath, 'utf8'));
    // verify-migrations.sql's last row reads Supabase Storage; an empty stand-in so it runs.
    await client.query('create schema if not exists storage; create table if not exists storage.buckets (id text primary key, name text, public boolean)');

    const failures = [];
    for (const file of files) {
      const failure = await run(client, file);
      if (failure) { failures.push(failure); break; }
    }
    out.fromEmpty = failures.length ? failures : `all ${files.length} applied (${files[0]} .. ${files[files.length - 1]})`;

    const before = (await client.query(SNAPSHOT)).rows[0];
    const rerun = [];
    for (const file of files.filter(f => /^00(07|10)_/.test(f))) rerun.push(await run(client, file) ?? `${file}: ok`);
    const after = (await client.query(SNAPSHOT)).rows[0];
    out.rerun0007and0010 = rerun;
    out.schemaChangedByRerun = Object.keys(before).filter(k => before[k] !== after[k]);

    // The audit-fix migrations (0057-0059) and the ESP32 one (0060) run a second time: they must apply cleanly and change
    // nothing (the snapshot above, plus policies, grants, the cap trigger and the seeded settings).
    const AUDIT = `select
      (select string_agg(tablename || '.' || policyname, ',' order by tablename, policyname) from pg_policies where schemaname = 'public') as policies,
      (select string_agg(table_name || ':' || privilege_type || ':' || grantee, ',' order by table_name, privilege_type, grantee)
         from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')) as grants,
      (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.irrigation_commands'::regclass and not tgisinternal) as command_triggers,
      (select string_agg(key || '=' || value::text, ',' order by key) from app_setting where key like 'service.%') as service_settings,
      (select string_agg(commission_state, ',' order by id) from zone) as commission_states`;
    const beforeAudit = { ...(await client.query(SNAPSHOT)).rows[0], ...(await client.query(AUDIT)).rows[0] };
    const rerunAudit = [];
    for (const file of files.filter(f => /^00(5[789]|6[012])_/.test(f))) rerunAudit.push(await run(client, file) ?? `${file}: ok`);
    const afterAudit = { ...(await client.query(SNAPSHOT)).rows[0], ...(await client.query(AUDIT)).rows[0] };
    out.rerun0057to0059 = rerunAudit;
    out.schemaChangedByAuditRerun = Object.keys(beforeAudit).filter(k => beforeAudit[k] !== afterAudit[k]);

    const rows = (await client.query(fs.readFileSync(path.join(repo, 'docs', 'ops', 'verify-migrations.sql'), 'utf8'))).rows;
    out.verify = {
      rows: rows.length,
      migrationRowsAllTrue: rows.filter(r => r.num !== 'storage').every(r => r.applied === true),
      notTrue: rows.filter(r => r.applied !== true).map(r => `${r.num} ${r.name}`),
    };
    out.viewColumns = after.view_cols;
    out.scheduleTableGone = after.schedule_table_gone;
    out.scheduleFunctionReadsZone = /from zone z/.test(after.schedule_fn ?? '');

    const notRerunnable = [];
    for (const file of files) {
      const failure = await run(client, file);
      if (failure) notRerunnable.push(failure.split(':')[0]);
    }
    out.wholeChainAgain_notRerunnable = notRerunnable;
  } finally {
    await client.end().catch(() => {});
    await pg.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

const first = await replayOnce(54341);
const second = await replayOnce(54342);
console.log(JSON.stringify({ first, second }, null, 2));
