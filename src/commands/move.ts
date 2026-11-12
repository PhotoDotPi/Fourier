import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { PlayerCommand } from './playerCommand.js';

export default class Move extends PlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('move')
    .setDescription('move songs within the queue')
    .addIntegerOption((option) =>
      option.setName('from').setDescription('position of the song to move').setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('to').setDescription('position to move the song to').setRequired(true),
    );

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);

    const from = interaction.options.getInteger('from') ?? 1;
    const to = interaction.options.getInteger('to') ?? 1;

    if (from < 1) {
      throw new Error('position must be at least 1');
    }

    if (to < 1) {
      throw new Error('position must be at least 1');
    }

    const { title } = player.move(from, to);

    await interaction.reply({
      embeds: [buildSuccessEmbed(`Moved **${title}** to position **${String(to)}**.`)],
    });
  }
}
