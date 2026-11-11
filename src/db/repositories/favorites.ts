import { sql } from '../client.js';
import type { FavoriteQueryRow } from '../types.js';

export async function findByGuildId(guildId: string): Promise<FavoriteQueryRow[]> {
  return sql`SELECT * FROM "FavoriteQuery" WHERE "guildId" = ${guildId}` as Promise<FavoriteQueryRow[]>;
}

export async function findByGuildIdAndName(guildId: string, name: string): Promise<FavoriteQueryRow | null> {
  const rows = await sql`SELECT * FROM "FavoriteQuery" WHERE "guildId" = ${guildId} AND "name" = ${name}`;
  return (rows[0] as FavoriteQueryRow | undefined) ?? null;
}

export async function findById(id: number): Promise<FavoriteQueryRow | null> {
  const rows = await sql`SELECT * FROM "FavoriteQuery" WHERE "id" = ${id}`;
  return (rows[0] as FavoriteQueryRow | undefined) ?? null;
}

export async function createFavorite(guildId: string, authorId: string, name: string, query: string): Promise<void> {
  await sql`
    INSERT INTO "FavoriteQuery" ("guildId", "authorId", "name", "query")
    VALUES (${guildId}, ${authorId}, ${name}, ${query})
  `;
}

export async function deleteById(id: number): Promise<void> {
  await sql`DELETE FROM "FavoriteQuery" WHERE "id" = ${id}`;
}
