import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { VoicePlayerCommand } from './playerCommand.js';

export default class Shuffle extends VoicePlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('shuffle the current queue');

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);

    if (player.isQueueEmpty()) {
      throw new Error('not enough songs to shuffle');
    }

    player.shuffle();

    await interaction.reply({
      embeds: [buildSuccessEmbed('Queue shuffled.')],
    });
  }
}
