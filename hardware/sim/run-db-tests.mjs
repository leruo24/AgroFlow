// Only the API's database tests (backend/AgroFlow.Domain.Tests/SimDatabaseTests.cs), against a
// throwaway local Postgres with every migration applied. run-e2e.mjs runs the same tests at
// its end; this is the quick way to run just them while working on one.
//   cd hardware/sim && node run-db-tests.mjs        (exit code 0 = pass)
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startDatabase, applyMigrations, repoRoot } from './db.mjs';

const db = await startDatabase({ port: 54351 });
let code = 1;
try {
  await applyMigrations(db.client);
  code = await new Promise(resolve => {
    const p = spawn('dotnet', ['test', path.join(repoRoot, 'backend', 'AgroFlow.Domain.Tests'),
      '--filter', 'FullyQualifiedName~SimDatabaseTests|FullyQualifiedName~DroughtCommunityDbTests|FullyQualifiedName~DroughtCommunityFixTests', '--logger', 'console;verbosity=normal'], {
      env: { ...process.env, AGROFLOW_SIM_DB: db.connectionString }, stdio: 'inherit',
    });
    p.on('close', resolve);
  });
} finally {
  await db.stop();
}
process.exit(code);
