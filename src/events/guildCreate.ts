import { REST } from '@discordjs/rest';
import type { Client, Guild } from 'discord.js';
import type Command from '../commands/index.js';
import { Emoji } from '../constants/emoji.js';
import * as settingsRepo from '../db/repositories/settings.js';
import type { SettingRow } from '../db/types.js';
import type Config from '../services/config.js';
import registerCommandsOnGuild from '../utils/registerCommandsOnGuild.js';

export async function createGuildSettings(guildId: string): Promise<SettingRow> {
  return settingsRepo.upsertSetting(guildId);
}

export default (config: Config, client: Client, commands: Command[]) =>
  async (guild: Guild): Promise<void> => {
    await createGuildSettings(guild.id);

    if (!config.REGISTER_COMMANDS_ON_BOT) {
      const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

      await registerCommandsOnGuild({
        rest,
        applicationId: client.user!.id,
        guildId: guild.id,
        commands: commands.map((command) => command.slashCommand),
      });
    }

    const owner = await guild.fetchOwner();
    await owner.send(
      `${Emoji.Wave} Hi! Someone (probably you) just invited me to a server you own. By default, I'm usable by all guild members in all guild channels. To change this, check out the wiki page on permissions: https://github.com/PhotoDotPi/Fourier/wiki/Configuring-Bot-Permissions.`,
    );
  };
