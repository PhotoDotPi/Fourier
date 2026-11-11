import { sql } from '../client.js';
import type { FileCacheRow } from '../types.js';

export async function findByHash(hash: string): Promise<FileCacheRow | null> {
  const rows = await sql`SELECT * FROM "FileCache" WHERE "hash" = ${hash}`;
  return (rows[0] as FileCacheRow | undefined) ?? null;
}

export async function upsertFileCache(hash: string, bytes: number, accessedAt: Date): Promise<void> {
  await sql`
    INSERT INTO "FileCache" ("hash", "bytes", "accessedAt")
    VALUES (${hash}, ${bytes}, ${accessedAt})
    ON CONFLICT ("hash") DO UPDATE SET
      "bytes" = EXCLUDED."bytes",
      "accessedAt" = EXCLUDED."accessedAt",
      "updatedAt" = NOW()
  `;
}

export async function updateAccessedAt(hash: string, accessedAt: Date): Promise<void> {
  await sql`UPDATE "FileCache" SET "accessedAt" = ${accessedAt}, "updatedAt" = NOW() WHERE "hash" = ${hash}`;
}

export async function deleteByHash(hash: string): Promise<void> {
  await sql`DELETE FROM "FileCache" WHERE "hash" = ${hash}`;
}

export async function findOldest(): Promise<FileCacheRow | null> {
  const rows = await sql`SELECT * FROM "FileCache" ORDER BY "accessedAt" ASC LIMIT 1`;
  return (rows[0] as FileCacheRow | undefined) ?? null;
}

export async function sumBytes(): Promise<number> {
  const rows = await sql`SELECT COALESCE(SUM("bytes"), 0) AS total FROM "FileCache"`;
  return Number(rows[0]?.total ?? 0);
}

export async function findAllBatched(afterHash: string | null, limit: number): Promise<FileCacheRow[]> {
  if (afterHash === null) {
    return sql`SELECT * FROM "FileCache" ORDER BY "hash" ASC LIMIT ${limit}` as Promise<FileCacheRow[]>;
  }
  return sql`SELECT * FROM "FileCache" WHERE "hash" > ${afterHash} ORDER BY "hash" ASC LIMIT ${limit}` as Promise<
    FileCacheRow[]
  >;
}
