import { REST } from '@discordjs/rest';
import { generateDependencyReport } from '@discordjs/voice';
import { type Client, Collection, Events, MessageFlags, type User } from 'discord.js';
import { Routes } from 'discord-api-types/v10';
import type Command from './commands/index.js';
import { Emoji } from './constants/emoji.js';
import type Config from './services/config.js';
import { buildErrorEmbed } from './ui/embeds.js';
import { isUserInVoice } from './utils/channels.js';
import debug from './utils/debug.js';
import { toFriendlyError } from './utils/errorMsg.js';
import registerCommandsOnGuild from './utils/registerCommandsOnGuild.js';
import spinner from './utils/spinner.js';

const sanitizeErrorDetail = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(
      /(["']?\b(?:api[-_]?key|key|token|authorization|cookie)["']?\s*[:=]\s*)(?:["'][^"']*["']|Bearer\s+[^,;\s]+|[^,;\s}\]]+)/gi,
      '$1[redacted]',
    )
    .replace(/\b(authorization|cookie)\s*[:=]\s*[^\r\n]*/gi, '$1: [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
};

const sanitizeErrorForLog = (error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  const detail = sanitizeErrorDetail(error);

  return `${name}: ${detail || 'unknown error'}`;
};

export default class Bot {
  private readonly client: Client;
  private readonly config: Config;
  private readonly shouldRegisterCommandsOnBot: boolean;
  private readonly commandsByName!: Collection<string, Command>;
  private readonly commandsByButtonId!: Collection<string, Command>;
  private readonly commandsByButtonIdPrefix!: Collection<string, Command>;
  private readonly commandsByModalId!: Collection<string, Command>;
  private readonly commandsByModalIdPrefix!: Collection<string, Command>;

  constructor(client: Client, config: Config) {
    this.client = client;
    this.config = config;
    this.shouldRegisterCommandsOnBot = config.REGISTER_COMMANDS_ON_BOT;
    this.commandsByName = new Collection();
    this.commandsByButtonId = new Collection();
    this.commandsByButtonIdPrefix = new Collection();
    this.commandsByModalId = new Collection();
    this.commandsByModalIdPrefix = new Collection();
  }

  public async register(
    commands: Command[],
    onGuildCreate: (guild: import('discord.js').Guild) => Promise<void>,
    onVoiceStateUpdate: (
      oldState: import('discord.js').VoiceState,
      newState: import('discord.js').VoiceState,
    ) => Promise<void>,
    onReady?: () => Promise<void>,
  ): Promise<void> {
    for (const command of commands) {
      try {
        command.slashCommand.toJSON();
      } catch (error) {
        console.error(error);
        throw new Error(`Could not serialize /${command.slashCommand.name ?? ''} to JSON`);
      }

      if (command.slashCommand.name) {
        this.commandsByName.set(command.slashCommand.name, command);
      }

      if (command.handledButtonIds) {
        for (const buttonId of command.handledButtonIds) {
          this.commandsByButtonId.set(buttonId, command);
        }
      }

      if (command.handledButtonIdPrefixes) {
        for (const prefix of command.handledButtonIdPrefixes) {
          this.commandsByButtonIdPrefix.set(prefix, command);
        }
      }

      if (command.handledModalIds) {
        for (const modalId of command.handledModalIds) {
          this.commandsByModalId.set(modalId, command);
        }
      }

      if (command.handledModalIdPrefixes) {
        for (const prefix of command.handledModalIdPrefixes) {
          this.commandsByModalIdPrefix.set(prefix, command);
        }
      }
    }

    const resolveCommandByComponent = (customId: string): Command | undefined => {
      const exact = this.commandsByButtonId.get(customId);

      if (exact) {
        return exact;
      }

      const prefixes = [...this.commandsByButtonIdPrefix.entries()].sort((a, b) => b[0].length - a[0].length);

      for (const [prefix, command] of prefixes) {
        if (customId.startsWith(prefix)) {
          return command;
        }
      }

      return undefined;
    };

    const resolveCommandByModalId = (customId: string): Command | undefined => {
      const exact = this.commandsByModalId.get(customId);

      if (exact) {
        return exact;
      }

      const prefixes = [...this.commandsByModalIdPrefix.entries()].sort((a, b) => b[0].length - a[0].length);

      for (const [prefix, command] of prefixes) {
        if (customId.startsWith(prefix)) {
          return command;
        }
      }

      return undefined;
    };

    this.client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isCommand()) {
          const command = this.commandsByName.get(interaction.commandName);

          if (!command || !interaction.isChatInputCommand()) {
            return;
          }

          if (!interaction.guild) {
            await interaction.reply({
              embeds: [buildErrorEmbed('Heads up', "You can't use this bot in a DM.", null)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const requiresVC =
            command.requiresVC instanceof Function ? command.requiresVC(interaction) : command.requiresVC;
          if (requiresVC && interaction.member && !isUserInVoice(interaction.guild, interaction.member.user as User)) {
            await interaction.reply({
              embeds: [buildErrorEmbed('Heads up', 'You need to be in a voice channel for this command.', null)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          if (command.execute) {
            await command.execute(interaction);
          }
        } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
          const command = resolveCommandByComponent(interaction.customId);

          if (!command) {
            return;
          }

          if (interaction.isButton() && command.handleButtonInteraction) {
            await command.handleButtonInteraction(interaction);
          } else if (interaction.isStringSelectMenu() && command.handleSelectMenuInteraction) {
            await command.handleSelectMenuInteraction(interaction);
          }
        } else if (interaction.isModalSubmit()) {
          const command = resolveCommandByModalId(interaction.customId);

          if (command?.handleModalSubmit) {
            await command.handleModalSubmit(interaction);
          }
        } else if (interaction.isAutocomplete()) {
          const command = this.commandsByName.get(interaction.commandName);

          if (!command) {
            return;
          }

          if (command.handleAutocompleteInteraction) {
            await command.handleAutocompleteInteraction(interaction);
          }
        }
      } catch (error: unknown) {
        const sanitizedError = sanitizeErrorForLog(error);
        debug(sanitizedError);
        const interactionName =
          interaction.isCommand() || interaction.isAutocomplete()
            ? `/${interaction.commandName}`
            : interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()
              ? `component:${interaction.customId}`
              : interaction.type.toString();
        console.error(
          `Discord interaction failed (${interactionName}, guild=${interaction.guildId ?? 'dm'}, channel=${interaction.channelId ?? 'unknown'}, user=${interaction.user.id}): ${sanitizedError}`,
        );

        const userSafeError = new Error(sanitizeErrorDetail(error));
        const friendlyError = toFriendlyError(userSafeError);
        const reply = {
          embeds: [buildErrorEmbed(friendlyError.title, friendlyError.description, friendlyError.footerDetail)],
        };

        try {
          if (
            (interaction.isCommand() ||
              interaction.isButton() ||
              interaction.isStringSelectMenu() ||
              interaction.isModalSubmit()) &&
            (interaction.replied || interaction.deferred)
          ) {
            await interaction.editReply(reply);
          } else if (
            interaction.isCommand() ||
            interaction.isButton() ||
            interaction.isStringSelectMenu() ||
            interaction.isModalSubmit()
          ) {
            await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
          }
        } catch {}
      }
    });

    const status = spinner(`${Emoji.Signal} connecting to Discord...`);

    this.client.once(Events.ClientReady, async () => {
      debug(generateDependencyReport());

      const rest = new REST({ version: '10' }).setToken(this.config.DISCORD_TOKEN);
      if (this.shouldRegisterCommandsOnBot) {
        status.text = `${Emoji.Signal} updating commands on bot...`;
        await rest.put(Routes.applicationCommands(this.client.user!.id), {
          body: this.commandsByName.map((command) => command.slashCommand.toJSON()),
        });
      } else {
        status.text = `${Emoji.Signal} updating commands in all guilds...`;

        await Promise.all([
          ...this.client.guilds.cache.map(async (guild) => {
            await registerCommandsOnGuild({
              rest,
              guildId: guild.id,
              applicationId: this.client.user!.id,
              commands: this.commandsByName.map((c) => c.slashCommand),
            });
          }),

          rest.put(Routes.applicationCommands(this.client.user!.id), { body: [] }),
        ]);
      }

      this.client.user!.setPresence({
        activities: [
          {
            name: this.config.BOT_ACTIVITY,
            type: this.config.BOT_ACTIVITY_TYPE,
            url: this.config.BOT_ACTIVITY_URL === '' ? undefined : this.config.BOT_ACTIVITY_URL,
          },
        ],
        status: this.config.BOT_STATUS,
      });

      if (onReady) {
        await onReady();
      }

      status.succeed(
        `Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${this.client.user?.id ?? ''}&scope=bot%20applications.commands&permissions=36700160`,
      );
    });

    this.client.on('error', console.error);
    this.client.on('debug', debug);

    this.client.on('guildCreate', onGuildCreate);
    this.client.on('voiceStateUpdate', onVoiceStateUpdate);
    await this.client.login();
  }
}
