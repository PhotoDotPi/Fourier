import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { VoicePlayerCommand } from './playerCommand.js';

export default class Stop extends VoicePlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('stop')
    .setDescription('stop playback, disconnect, and clear all songs in the queue');

  public async execute(interaction: ChatInputCommandInteraction) {
    const player = this.getConnectedPlayer(interaction);

    player.stop();
    await interaction.reply({
      embeds: [buildSuccessEmbed('Stopped playback, disconnected, and cleared the queue.')],
    });
  }
}
