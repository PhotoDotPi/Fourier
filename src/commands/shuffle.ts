import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import type Command from './index.js';

export default class Shuffle implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('shuffle the current queue');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (player.isQueueEmpty()) {
      throw new Error('not enough songs to shuffle');
    }

    player.shuffle();

    await interaction.reply({
      embeds: [buildSuccessEmbed('Queue shuffled.')],
    });
  }
}
