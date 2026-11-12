import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { STATUS } from '../services/player.js';
import { VoicePresenterPlayerCommand } from './playerCommand.js';

export default class Pause extends VoicePresenterPlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder().setName('pause').setDescription('pause the current song');

  public async execute(interaction: ChatInputCommandInteraction) {
    const player = this.getPlayer(interaction);

    if (player.status !== STATUS.PLAYING) {
      throw new Error('not currently playing');
    }

    player.pause();

    await this.presenter.replyPlaying(interaction, player);
  }
}
