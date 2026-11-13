import { sql } from '../client.js';
import type { KeyValueCacheRow } from '../types.js';

export async function findByKey(key: string): Promise<KeyValueCacheRow | null> {
  const rows = await sql`SELECT * FROM "KeyValueCache" WHERE "key" = ${key}`;
  return (rows[0] as KeyValueCacheRow | undefined) ?? null;
}

export async function upsertKeyValue(key: string, value: string, expiresAt: Date): Promise<void> {
  await sql`
    INSERT INTO "KeyValueCache" ("key", "value", "expiresAt")
    VALUES (${key}, ${value}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET
      "value" = EXCLUDED."value",
      "expiresAt" = EXCLUDED."expiresAt",
      "updatedAt" = NOW()
  `;
}

export async function deleteByKey(key: string): Promise<void> {
  await sql`DELETE FROM "KeyValueCache" WHERE "key" = ${key}`;
}
