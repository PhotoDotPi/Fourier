import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { VoicePresenterPlayerCommand } from './playerCommand.js';

export default class Skip extends VoicePresenterPlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('skip')
    .setDescription('skip the next songs')
    .addIntegerOption((option) =>
      option.setName('number').setDescription('number of songs to skip [default: 1]').setRequired(false),
    );

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const numToSkip = interaction.options.getInteger('number') ?? 1;

    if (numToSkip < 1) {
      throw new Error('invalid number of songs to skip');
    }

    const player = this.getPlayer(interaction);
    await interaction.deferReply();

    try {
      await player.forward(numToSkip);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'No songs in queue to forward to.') {
        throw new Error('no song to skip to');
      }

      throw error;
    }

    if (player.getCurrent()) {
      await this.presenter.editPlaying(interaction, player);
    } else {
      await interaction.editReply({
        embeds: [buildSuccessEmbed('Skipped to the end of the queue.')],
      });
    }
  }
}
