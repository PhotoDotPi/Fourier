import { SlashCommandBuilder } from '@discordjs/builders';
import { type ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import * as settingsRepo from '../db/repositories/settings.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { getGuildSettings } from '../utils/getGuildSettings.js';
import type Command from './index.js';

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

    switch (interaction.options.getSubcommand()) {
      case 'set-playlist-limit': {
        const limit: number = interaction.options.getInteger('limit')!;

        if (limit < 1) {
          throw new Error('invalid limit');
        }

        await settingsRepo.updateSetting(interaction.guild!.id, { playlistLimit: limit });

        await interaction.reply({ embeds: [buildSuccessEmbed('Playlist limit updated.')] });

        break;
      }

      case 'set-wait-after-queue-empties': {
        const delay = interaction.options.getInteger('delay')!;

        await settingsRepo.updateSetting(interaction.guild!.id, {
          secondsToWaitAfterQueueEmpties: delay,
        });

        await interaction.reply({ embeds: [buildSuccessEmbed('Wait delay updated.')] });

        break;
      }

      case 'set-leave-if-no-listeners': {
        const value = interaction.options.getBoolean('value')!;

        await settingsRepo.updateSetting(interaction.guild!.id, { leaveIfNoListeners: value });

        await interaction.reply({ embeds: [buildSuccessEmbed('Leave-if-no-listeners setting updated.')] });

        break;
      }

      case 'set-queue-add-response-hidden': {
        const value = interaction.options.getBoolean('value')!;

        await settingsRepo.updateSetting(interaction.guild!.id, { queueAddResponseEphemeral: value });

        await interaction.reply({ embeds: [buildSuccessEmbed('Queue add notification setting updated.')] });

        break;
      }

      case 'set-auto-announce-next-song': {
        const value = interaction.options.getBoolean('value')!;

        await settingsRepo.updateSetting(interaction.guild!.id, { autoAnnounceNextSong: value });

        await interaction.reply({ embeds: [buildSuccessEmbed('Auto-announce setting updated.')] });

        break;
      }

      case 'set-default-volume': {
        const value = interaction.options.getInteger('level')!;

        await settingsRepo.updateSetting(interaction.guild!.id, { defaultVolume: value });

        await interaction.reply({ embeds: [buildSuccessEmbed('Volume setting updated.')] });

        break;
      }

      case 'set-default-queue-page-size': {
        const value = interaction.options.getInteger('page-size')!;

        await settingsRepo.updateSetting(interaction.guild!.id, { defaultQueuePageSize: value });

        await interaction.reply({ embeds: [buildSuccessEmbed('Default queue page size updated.')] });

        break;
      }

      case 'set-reduce-vol-when-voice': {
        const value = interaction.options.getBoolean('value')!;

        await settingsRepo.updateSetting(interaction.guild!.id, {
          turnDownVolumeWhenPeopleSpeak: value,
        });

        await interaction.reply({ embeds: [buildSuccessEmbed('Turn-down-volume setting updated.')] });

        break;
      }

      case 'set-reduce-vol-when-voice-target': {
        const value = interaction.options.getInteger('volume')!;

        await settingsRepo.updateSetting(interaction.guild!.id, {
          turnDownVolumeWhenPeopleSpeakTarget: value,
        });

        await interaction.reply({ embeds: [buildSuccessEmbed('Turn-down-volume target updated.')] });

        break;
      }

      case 'get': {
        const embed = new EmbedBuilder().setTitle('Config');

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

        embed.setDescription(description);

        await interaction.reply({ embeds: [embed] });

        break;
      }

      default:
        throw new Error('unknown subcommand');
    }
  }
}
