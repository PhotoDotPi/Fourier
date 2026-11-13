import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { PlayerCommand } from './playerCommand.js';

export default class Remove extends PlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('remove')
    .setDescription('remove songs from the queue')
    .addIntegerOption((option) =>
      option
        .setName('position')
        .setDescription('position of the song to remove [default: 1]')
        .setMinValue(1)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName('range')
        .setDescription('number of songs to remove [default: 1]')
        .setMinValue(1)
        .setRequired(false),
    );

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);

    const position = interaction.options.getInteger('position') ?? 1;
    const range = interaction.options.getInteger('range') ?? 1;

    if (position < 1) {
      throw new Error('position must be at least 1');
    }

    if (range < 1) {
      throw new Error('range must be at least 1');
    }

    if (position > player.queueSize()) {
      throw new Error('position is outside the range of the queue');
    }

    player.removeFromQueue(position, range);

    await interaction.reply({
      embeds: [buildSuccessEmbed('Removed song(s) from the queue.')],
    });
  }
}
