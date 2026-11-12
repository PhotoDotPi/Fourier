import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { VoicePlayerCommand } from './playerCommand.js';

export default class Disconnect extends VoicePlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('pause and disconnect Fourier');

  public async execute(interaction: ChatInputCommandInteraction) {
    const player = this.getConnectedPlayer(interaction);

    player.disconnect();

    await interaction.reply({
      embeds: [buildSuccessEmbed('Disconnected.')],
    });
  }
}
