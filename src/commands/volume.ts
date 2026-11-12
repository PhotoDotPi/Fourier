import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { VoicePresenterPlayerCommand } from './playerCommand.js';

export default class Volume extends VoicePresenterPlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('volume')
    .setDescription('set current player volume level')
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('volume percentage (0 is muted, 100 is max & default)')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true),
    );

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new Error('nothing is playing');
    }

    const level = interaction.options.getInteger('level') ?? 100;
    player.setVolume(level);

    await this.presenter.replyPlaying(interaction, player);
  }
}
