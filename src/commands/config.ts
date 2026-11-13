import { SlashCommandBuilder } from '@discordjs/builders';
import { type ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import * as settingsRepo from '../db/repositories/settings.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { getGuildSettings } from '../utils/getGuildSettings.js';
import type Command from './index.js';

type BooleanSettingKey =
  | 'leaveIfNoListeners'
  | 'queueAddResponseEphemeral'
  | 'autoAnnounceNextSong'
  | 'turnDownVolumeWhenPeopleSpeak';

type IntegerSettingKey =
  | 'playlistLimit'
  | 'secondsToWaitAfterQueueEmpties'
  | 'defaultVolume'
  | 'defaultQueuePageSize'
  | 'turnDownVolumeWhenPeopleSpeakTarget';

interface BooleanSubcommand {
  option: string;
  setting: BooleanSettingKey;
  message: string;
}

interface IntegerSubcommand {
  option: string;
  setting: IntegerSettingKey;
  message: string;
  minimum?: number;
}

const BOOLEAN_SUBCOMMANDS: Record<string, BooleanSubcommand> = {
  'set-leave-if-no-listeners': {
    option: 'value',
    setting: 'leaveIfNoListeners',
    message: 'Leave-if-no-listeners setting updated.',
  },
  'set-queue-add-response-hidden': {
    option: 'value',
    setting: 'queueAddResponseEphemeral',
    message: 'Queue add notification setting updated.',
  },
  'set-auto-announce-next-song': {
    option: 'value',
    setting: 'autoAnnounceNextSong',
    message: 'Auto-announce setting updated.',
  },
  'set-reduce-vol-when-voice': {
    option: 'value',
    setting: 'turnDownVolumeWhenPeopleSpeak',
    message: 'Turn-down-volume setting updated.',
  },
};

const INTEGER_SUBCOMMANDS: Record<string, IntegerSubcommand> = {
  'set-playlist-limit': {
    option: 'limit',
    setting: 'playlistLimit',
    message: 'Playlist limit updated.',
    minimum: 1,
  },
  'set-wait-after-queue-empties': {
    option: 'delay',
    setting: 'secondsToWaitAfterQueueEmpties',
    message: 'Wait delay updated.',
  },
  'set-default-volume': {
    option: 'level',
    setting: 'defaultVolume',
    message: 'Volume setting updated.',
  },
  'set-default-queue-page-size': {
    option: 'page-size',
    setting: 'defaultQueuePageSize',
    message: 'Default queue page size updated.',
  },
  'set-reduce-vol-when-voice-target': {
    option: 'volume',
    setting: 'turnDownVolumeWhenPeopleSpeakTarget',
    message: 'Turn-down-volume target updated.',
  },
};

export default class Config implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('configure bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-playlist-limit')
        .setDescription('set the maximum number of tracks that can be added from a playlist')
        .addIntegerOption((option) =>
          option.setName('limit').setDescription('maximum number of tracks').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-wait-after-queue-empties')
        .setDescription('set the time to wait before leaving the voice channel when queue empties')
        .addIntegerOption((option) =>
          option
            .setName('delay')
            .setDescription('delay in seconds (set to 0 to never leave)')
            .setRequired(true)
            .setMinValue(0),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-leave-if-no-listeners')
        .setDescription('set whether to leave when all other participants leave')
        .addBooleanOption((option) =>
          option.setName('value').setDescription('whether to leave when everyone else leaves').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-queue-add-response-hidden')
        .setDescription('set whether bot responses to queue additions are only displayed to the requester')
        .addBooleanOption((option) =>
          option
            .setName('value')
            .setDescription('whether bot responses to queue additions are only displayed to the requester')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-reduce-vol-when-voice')
        .setDescription('set whether to turn down the volume when people speak')
        .addBooleanOption((option) =>
          option.setName('value').setDescription('whether to turn down the volume when people speak').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-reduce-vol-when-voice-target')
        .setDescription('set the target volume when people speak')
        .addIntegerOption((option) =>
          option
            .setName('volume')
            .setDescription('volume percentage (0 is muted, 100 is max & default)')
            .setMinValue(0)
            .setMaxValue(100)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-auto-announce-next-song')
        .setDescription('set whether to announce the next song in the queue automatically')
        .addBooleanOption((option) =>
          option
            .setName('value')
            .setDescription('whether to announce the next song in the queue automatically')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-default-volume')
        .setDescription('set default volume used when entering the voice channel')
        .addIntegerOption((option) =>
          option
            .setName('level')
            .setDescription('volume percentage (0 is muted, 100 is max & default)')
            .setMinValue(0)
            .setMaxValue(100)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-default-queue-page-size')
        .setDescription('set the default page size of the /queue command')
        .addIntegerOption((option) =>
          option
            .setName('page-size')
            .setDescription('page size of the /queue command')
            .setMinValue(1)
            .setMaxValue(30)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) => subcommand.setName('get').setDescription('show all settings'));

  async execute(interaction: ChatInputCommandInteraction) {
    await getGuildSettings(interaction.guild!.id);

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'get') {
      await this.showSettings(interaction);
      return;
    }

    const booleanSubcommand = BOOLEAN_SUBCOMMANDS[subcommand];

    if (booleanSubcommand) {
      await this.applyBooleanSubcommand(interaction, booleanSubcommand);
      return;
    }

    const integerSubcommand = INTEGER_SUBCOMMANDS[subcommand];

    if (!integerSubcommand) {
      throw new Error('unknown subcommand');
    }

    await this.applyIntegerSubcommand(interaction, integerSubcommand);
  }

  private async applyBooleanSubcommand(
    interaction: ChatInputCommandInteraction,
    subcommand: BooleanSubcommand,
  ): Promise<void> {
    const value = interaction.options.getBoolean(subcommand.option)!;
    const data: Partial<Record<BooleanSettingKey, boolean>> = {};
    data[subcommand.setting] = value;

    await this.finishSettingUpdate(interaction, data, subcommand.message);
  }

  private async applyIntegerSubcommand(
    interaction: ChatInputCommandInteraction,
    subcommand: IntegerSubcommand,
  ): Promise<void> {
    const value = interaction.options.getInteger(subcommand.option)!;

    if (subcommand.minimum !== undefined && value < subcommand.minimum) {
      throw new Error('invalid limit');
    }

    const data: Partial<Record<IntegerSettingKey, number>> = {};
    data[subcommand.setting] = value;

    await this.finishSettingUpdate(interaction, data, subcommand.message);
  }

  private async finishSettingUpdate(
    interaction: ChatInputCommandInteraction,
    data: Partial<Record<string, number | boolean>>,
    message: string,
  ): Promise<void> {
    await settingsRepo.updateSetting(interaction.guild!.id, data as Parameters<typeof settingsRepo.updateSetting>[1]);

    await interaction.reply({ embeds: [buildSuccessEmbed(message)] });
  }

  private async showSettings(interaction: ChatInputCommandInteraction): Promise<void> {
    const config = await getGuildSettings(interaction.guild!.id);

    const settingsToShow = {
      'Playlist Limit': config.playlistLimit,
      'Wait before leaving after queue empty':
        config.secondsToWaitAfterQueueEmpties === 0 ? 'never leave' : `${config.secondsToWaitAfterQueueEmpties}s`,
      'Leave if there are no listeners': config.leaveIfNoListeners ? 'yes' : 'no',
      'Auto announce next song in queue': config.autoAnnounceNextSong ? 'yes' : 'no',
      'Add to queue responses show for requester only': config.queueAddResponseEphemeral ? 'yes' : 'no',
      'Default Volume': config.defaultVolume,
      'Default queue page size': config.defaultQueuePageSize,
      'Reduce volume when people speak': config.turnDownVolumeWhenPeopleSpeak ? 'yes' : 'no',
      'Reduce volume when people speak target': config.turnDownVolumeWhenPeopleSpeakTarget,
    };

    let description = '';
    for (const [key, value] of Object.entries(settingsToShow)) {
      description += `**${key}**: ${value}\n`;
    }

    const embed = new EmbedBuilder().setTitle('Config').setDescription(description);

    await interaction.reply({ embeds: [embed] });
  }
}
