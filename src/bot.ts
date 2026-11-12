import { REST } from '@discordjs/rest';
import { generateDependencyReport } from '@discordjs/voice';
import {
  type AutocompleteInteraction,
  type ButtonInteraction,
  type Client,
  Collection,
  type CommandInteraction,
  Events,
  type Interaction,
  MessageFlags,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
  type User,
} from 'discord.js';
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

const resolveByLongestPrefix = <T>(collection: Collection<string, T>, customId: string): T | undefined => {
  const prefixes = [...collection.entries()].sort((a, b) => b[0].length - a[0].length);

  for (const [prefix, command] of prefixes) {
    if (customId.startsWith(prefix)) {
      return command;
    }
  }

  return undefined;
};

const isRepliableInteraction = (interaction: Interaction): interaction is RepliableInteraction =>
  interaction.isCommand() || interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit();

const describeInteraction = (interaction: Interaction): string => {
  if (interaction.isCommand() || interaction.isAutocomplete()) {
    return `/${interaction.commandName}`;
  }

  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    return `component:${interaction.customId}`;
  }

  return interaction.type.toString();
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
      this.registerCommand(command);
    }

    this.client.on('interactionCreate', this.handleInteraction.bind(this));

    const status = spinner(`${Emoji.Signal} connecting to Discord...`);
    this.client.once(Events.ClientReady, async () => {
      await this.handleClientReady(status, onReady);
    });

    this.client.on('error', console.error);
    this.client.on('debug', debug);

    this.client.on('guildCreate', onGuildCreate);
    this.client.on('voiceStateUpdate', onVoiceStateUpdate);
    await this.client.login();
  }

  private registerCommand(command: Command): void {
    try {
      command.slashCommand.toJSON();
    } catch (error) {
      console.error(error);
      throw new Error(`Could not serialize /${command.slashCommand.name ?? ''} to JSON`);
    }

    if (command.slashCommand.name) {
      this.commandsByName.set(command.slashCommand.name, command);
    }

    this.registerIds(command.handledButtonIds, this.commandsByButtonId, command);
    this.registerIds(command.handledButtonIdPrefixes, this.commandsByButtonIdPrefix, command);
    this.registerIds(command.handledModalIds, this.commandsByModalId, command);
    this.registerIds(command.handledModalIdPrefixes, this.commandsByModalIdPrefix, command);
  }

  private registerIds(ids: readonly string[] | undefined, collection: Collection<string, Command>, command: Command) {
    if (!ids) {
      return;
    }

    for (const id of ids) {
      collection.set(id, command);
    }
  }

  private resolveCommandByComponent(customId: string): Command | undefined {
    return this.commandsByButtonId.get(customId) ?? resolveByLongestPrefix(this.commandsByButtonIdPrefix, customId);
  }

  private resolveCommandByModalId(customId: string): Command | undefined {
    return this.commandsByModalId.get(customId) ?? resolveByLongestPrefix(this.commandsByModalIdPrefix, customId);
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      await this.dispatchInteraction(interaction);
    } catch (error: unknown) {
      await this.handleInteractionError(interaction, error);
    }
  }

  private async dispatchInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isCommand()) {
      await this.handleCommandInteraction(interaction);
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await this.handleComponentInteraction(interaction);
    } else if (interaction.isModalSubmit()) {
      await this.handleModalInteraction(interaction);
    } else if (interaction.isAutocomplete()) {
      await this.handleAutocompleteInteraction(interaction);
    }
  }

  private async handleCommandInteraction(interaction: CommandInteraction): Promise<void> {
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

    if (this.isVoiceRequirementMissing(command, interaction)) {
      await interaction.reply({
        embeds: [buildErrorEmbed('Heads up', 'You need to be in a voice channel for this command.', null)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (command.execute) {
      await command.execute(interaction);
    }
  }

  private isVoiceRequirementMissing(
    command: Command,
    interaction: import('discord.js').ChatInputCommandInteraction,
  ): boolean {
    const requiresVC = command.requiresVC instanceof Function ? command.requiresVC(interaction) : command.requiresVC;

    return Boolean(
      requiresVC && interaction.member && !isUserInVoice(interaction.guild!, interaction.member.user as User),
    );
  }

  private async handleComponentInteraction(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ): Promise<void> {
    const command = this.resolveCommandByComponent(interaction.customId);

    if (!command) {
      return;
    }

    if (interaction.isButton() && command.handleButtonInteraction) {
      await command.handleButtonInteraction(interaction);
    } else if (interaction.isStringSelectMenu() && command.handleSelectMenuInteraction) {
      await command.handleSelectMenuInteraction(interaction);
    }
  }

  private async handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
    const command = this.resolveCommandByModalId(interaction.customId);

    if (command?.handleModalSubmit) {
      await command.handleModalSubmit(interaction);
    }
  }

  private async handleAutocompleteInteraction(interaction: AutocompleteInteraction): Promise<void> {
    const command = this.commandsByName.get(interaction.commandName);

    if (command?.handleAutocompleteInteraction) {
      await command.handleAutocompleteInteraction(interaction);
    }
  }

  private async handleInteractionError(interaction: Interaction, error: unknown): Promise<void> {
    const sanitizedError = sanitizeErrorForLog(error);
    debug(sanitizedError);
    console.error(
      `Discord interaction failed (${describeInteraction(interaction)}, guild=${interaction.guildId ?? 'dm'}, channel=${interaction.channelId ?? 'unknown'}, user=${interaction.user.id}): ${sanitizedError}`,
    );

    if (!isRepliableInteraction(interaction)) {
      return;
    }

    await this.replyWithFriendlyError(interaction, sanitizeErrorDetail(error));
  }

  private async replyWithFriendlyError(interaction: RepliableInteraction, detail: string): Promise<void> {
    const friendlyError = toFriendlyError(new Error(detail));
    const reply = {
      embeds: [buildErrorEmbed(friendlyError.title, friendlyError.description, friendlyError.footerDetail)],
    };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(reply);
      } else {
        await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }

  private async handleClientReady(status: ReturnType<typeof spinner>, onReady?: () => Promise<void>): Promise<void> {
    debug(generateDependencyReport());

    const rest = new REST({ version: '10' }).setToken(this.config.DISCORD_TOKEN);
    await this.updateCommands(rest, status);

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
  }

  private async updateCommands(rest: REST, status: ReturnType<typeof spinner>): Promise<void> {
    if (this.shouldRegisterCommandsOnBot) {
      status.text = `${Emoji.Signal} updating commands on bot...`;
      await rest.put(Routes.applicationCommands(this.client.user!.id), {
        body: this.commandsByName.map((command) => command.slashCommand.toJSON()),
      });
      return;
    }

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
}
