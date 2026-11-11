import { sql } from '../client.js';
import type { SettingRow } from '../types.js';

const UPDATABLE_COLUMNS = new Set([
  'playlistLimit',
  'secondsToWaitAfterQueueEmpties',
  'leaveIfNoListeners',
  'queueAddResponseEphemeral',
  'autoAnnounceNextSong',
  'defaultVolume',
  'defaultQueuePageSize',
  'turnDownVolumeWhenPeopleSpeak',
  'turnDownVolumeWhenPeopleSpeakTarget',
]);

export async function findByGuildId(guildId: string): Promise<SettingRow | null> {
  const rows = await sql`SELECT * FROM "Setting" WHERE "guildId" = ${guildId}`;
  return (rows[0] as SettingRow | undefined) ?? null;
}

export async function upsertSetting(guildId: string): Promise<SettingRow> {
  const rows = await sql`
    INSERT INTO "Setting" ("guildId") VALUES (${guildId})
    ON CONFLICT ("guildId") DO UPDATE SET "guildId" = EXCLUDED."guildId"
    RETURNING *
  `;
  return rows[0] as SettingRow;
}

export async function updateSetting(
  guildId: string,
  data: Partial<
    Pick<
      SettingRow,
      | 'playlistLimit'
      | 'secondsToWaitAfterQueueEmpties'
      | 'leaveIfNoListeners'
      | 'queueAddResponseEphemeral'
      | 'autoAnnounceNextSong'
      | 'defaultVolume'
      | 'defaultQueuePageSize'
      | 'turnDownVolumeWhenPeopleSpeak'
      | 'turnDownVolumeWhenPeopleSpeakTarget'
    >
  >,
): Promise<void> {
  const entries = Object.entries(data);
  if (entries.length === 0) return;

  for (const [key] of entries) {
    if (!UPDATABLE_COLUMNS.has(key)) {
      throw new Error(`Unsupported setting column: ${key}`);
    }
  }

  const setClauses = entries.map(([key], i) => `"${key}" = $${i + 1}`);
  const values = entries.map(([, val]) => val);

  await sql.unsafe(
    `UPDATE "Setting" SET ${setClauses.join(', ')}, "updatedAt" = NOW() WHERE "guildId" = $${entries.length + 1}`,
    [...values, guildId],
  );
}
