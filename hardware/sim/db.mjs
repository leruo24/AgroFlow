// A throwaway local Postgres with every AgroFlow migration applied, for the simulation.
// Uses embedded-postgres (real PostgreSQL binaries, no Docker). The data folder is deleted
// when it stops.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');

export async function startDatabase({ port = 54329 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agroflow-sim-pg-'));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'sim-only', port, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('agroflow');
  const client = pg.getPgClient('agroflow');
  await client.connect();
  return {
    pg, client, port,
    connectionString: `Host=127.0.0.1;Port=${port};Database=agroflow;Username=postgres;Password=sim-only;Pooling=true`,
    async stop() {
      await client.end().catch(() => {});
      await pg.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Every supabase/migrations file in order, after the Supabase stand-ins. pg_cron is not
// available locally, so its `create extension` line is skipped (cron.schedule is a no-op).
export async function applyMigrations(client, log = console.log) {
  await client.query(fs.readFileSync(path.join(here, 'supabase-shim.sql'), 'utf8'));
  const dir = path.join(repoRoot, 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  const viewRedefinitions = [];
  for (const file of files) {
    let sql = fs.readFileSync(path.join(dir, file), 'utf8')
      .replace(/create extension if not exists pg_cron\s*;/gi, '-- pg_cron skipped in the simulation');
    // On an empty database, CREATE OR REPLACE VIEW zone_latest_reading fails where a
    // migration renames the view's columns (0007 does). The live database never replayed the
    // chain from empty, so this is a simulation-only step: drop the view just before any
    // migration that redefines it. Nothing in the files changes.
    if (/create\s+or\s+replace\s+view\s+(public\.)?zone_latest_reading/i.test(sql)) {
      sql = 'drop view if exists public.zone_latest_reading;\n' + sql;
      viewRedefinitions.push(file);
    }
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
  }
  log(`applied ${files.length} migrations (${files[0]} .. ${files[files.length - 1]}); ` +
    `zone_latest_reading dropped before: ${viewRedefinitions.join(', ') || 'none'}`);
  return files;
}

if (process.argv[2] === '--migrations-only') {
  const db = await startDatabase();
  try {
    await applyMigrations(db.client);
  } finally {
    await db.stop();
  }
}
