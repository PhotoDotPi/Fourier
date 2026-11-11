import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from './client.js';

export async function runMigrations(migrationsDir: string): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS "_migrations" (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT NOT NULL UNIQUE,
      "applied_at" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  const applied = await sql`SELECT "name" FROM "_migrations" ORDER BY "name"`;
  const appliedSet = new Set(applied.map((r: { name: string }) => r.name));

  const files = await readdir(migrationsDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  for (const file of sqlFiles) {
    if (appliedSet.has(file)) continue;

    const content = await Bun.file(join(migrationsDir, file)).text();
    const wasApplied = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(727274)`;

      const existing = await tx`SELECT 1 FROM "_migrations" WHERE "name" = ${file}`;
      if (existing.length > 0) {
        return false;
      }

      await tx.unsafe(content);
      await tx`INSERT INTO "_migrations" ("name") VALUES (${file})`;
      return true;
    });

    if (wasApplied) {
      console.log(`Applied migration: ${file}`);
    }
  }
}
