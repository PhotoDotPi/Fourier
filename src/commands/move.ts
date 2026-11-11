import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import type Command from './index.js';

export default class Move implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('move')
    .setDescription('move songs within the queue')
    .addIntegerOption((option) =>
      option.setName('from').setDescription('position of the song to move').setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('to').setDescription('position to move the song to').setRequired(true),
    );

  private readonly playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

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
