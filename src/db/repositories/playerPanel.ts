import { sql } from '../client.js';
import type { PlayerPanelRow } from '../types.js';

export async function upsert(guildId: string, channelId: string, messageId: string | null): Promise<PlayerPanelRow> {
  const rows = await sql`
    INSERT INTO "PlayerPanel" ("guildId", "channelId", "messageId")
    VALUES (${guildId}, ${channelId}, ${messageId})
    ON CONFLICT ("guildId") DO UPDATE SET
      "channelId" = EXCLUDED."channelId",
      "messageId" = EXCLUDED."messageId",
      "updatedAt" = NOW()
    RETURNING *
  `;
  return rows[0] as PlayerPanelRow;
}

export async function remove(guildId: string): Promise<void> {
  await sql`DELETE FROM "PlayerPanel" WHERE "guildId" = ${guildId}`;
}

export async function findAll(): Promise<PlayerPanelRow[]> {
  return sql`SELECT * FROM "PlayerPanel"` as Promise<PlayerPanelRow[]>;
}
