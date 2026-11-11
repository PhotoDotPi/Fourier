import * as settingsRepo from '../db/repositories/settings.js';
import type { SettingRow } from '../db/types.js';
import { createGuildSettings } from '../events/guildCreate.js';

export async function getGuildSettings(guildId: string): Promise<SettingRow> {
  const config = await settingsRepo.findByGuildId(guildId);
  if (!config) {
    return createGuildSettings(guildId);
  }

  return config;
}
