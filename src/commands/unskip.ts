import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { VoicePresenterPlayerCommand } from './playerCommand.js';

export default class Unskip extends VoicePresenterPlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('unskip')
    .setDescription('go back in the queue by one song');

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);
    await interaction.deferReply();

    try {
      await player.back();
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'No songs in queue to go back to.') {
        throw new Error('no song to go back to');
      }

      throw error;
    }

    if (player.getCurrent()) {
      await this.presenter.editPlaying(interaction, player);
    } else {
      await interaction.editReply({
        embeds: [buildSuccessEmbed('Back at the start of the queue.')],
      });
    }
  }
}
