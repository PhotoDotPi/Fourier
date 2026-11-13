import { SlashCommandBuilder } from '@discordjs/builders';
import type { ButtonInteraction, ChatInputCommandInteraction, StringSelectMenuInteraction } from 'discord.js';
import { buildPlayerControls, QueueButtonId } from '../ui/components.js';
import { getQueueView } from '../ui/queueView.js';
import { buildPlayingMessageEmbed } from '../utils/buildEmbed.js';
import { getGuildSettings } from '../utils/getGuildSettings.js';
import { PlayerCommand } from './playerCommand.js';

const PAGE_OF_BUTTONS = ['queue:first', 'queue:last', 'queue:next', 'queue:previous'];

const getPageFromCustomId = (customId: string, fallback: number) => {
  const page = Number(customId.split(':').at(-1));
  return Number.isNaN(page) ? fallback : page;
};

export default class QueueCommand extends PlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('queue')
    .setDescription('show the current queue')
    .addIntegerOption((option) =>
      option.setName('page').setDescription('page of queue to show [default: 1]').setMinValue(1).setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName('page-size')
        .setDescription('how many items to display per page [default: 10, max: 30]')
        .setMinValue(1)
        .setMaxValue(30)
        .setRequired(false),
    );

  public readonly handledButtonIds = [QueueButtonId.NowPlaying, QueueButtonId.Shuffle, QueueButtonId.PageSelect];
  public readonly handledButtonIdPrefixes = PAGE_OF_BUTTONS;

  public async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const player = this.getPlayer(interaction);
    const pageSize =
      interaction.options.getInteger('page-size') ?? (await getGuildSettings(guildId)).defaultQueuePageSize;

    await interaction.reply(getQueueView(player, interaction.options.getInteger('page') ?? 1, pageSize));
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    const player = this.getPlayer(interaction);
    const pageSize = (await getGuildSettings(guildId)).defaultQueuePageSize;
    const currentPage = getPageFromCustomId(interaction.customId, 1);
    const maxPage = Math.max(1, Math.ceil(player.queueSize() / pageSize));

    switch (interaction.customId.split(':')[1]) {
      case 'first':
        await interaction.update(getQueueView(player, 1, pageSize));
        return;

      case 'last':
        await interaction.update(getQueueView(player, maxPage, pageSize));
        return;

      case 'next':
        await interaction.update(getQueueView(player, Math.min(maxPage, currentPage + 1), pageSize));
        return;

      case 'previous':
        await interaction.update(getQueueView(player, Math.max(1, currentPage - 1), pageSize));
        return;

      default:
        break;
    }

    if (interaction.customId === QueueButtonId.NowPlaying) {
      if (!player.getCurrent()) {
        throw new Error('nothing is currently playing');
      }

      await interaction.update({
        embeds: [buildPlayingMessageEmbed(player)],
        components: buildPlayerControls(player),
      });
      return;
    }

    if (interaction.customId === QueueButtonId.Shuffle) {
      if (player.isQueueEmpty()) {
        throw new Error('not enough songs to shuffle');
      }

      player.shuffle();
      await interaction.update(getQueueView(player, currentPage, pageSize));
      return;
    }

    throw new Error('unknown button interaction');
  }

  public async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    const player = this.getPlayer(interaction);
    const pageSize = (await getGuildSettings(guildId)).defaultQueuePageSize;
    const page = Number(interaction.values[0]);

    await interaction.update(getQueueView(player, page, pageSize));
  }
}
