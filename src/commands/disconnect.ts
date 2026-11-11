import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import type Command from './index.js';

export default class Disconnect implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('pause and disconnect Fourier');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.voiceConnection) {
      throw new Error('not connected');
    }

    player.disconnect();

    await interaction.reply({
      embeds: [buildSuccessEmbed('Disconnected.')],
    });
  }
}
