import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import durationStringToSeconds from '../utils/durationStringToSeconds.js';
import { VoicePlayerCommand } from './playerCommand.js';
import { getSeekableSong, seekAndReply } from './seekSupport.js';

export default class ForwardSeek extends VoicePlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('fseek')
    .setDescription('seek forward in the current song')
    .addStringOption((option) =>
      option
        .setName('time')
        .setDescription('an interval expression or number of seconds (1m, 30s, 100)')
        .setRequired(true),
    );

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);
    const currentSong = getSeekableSong(player, "can't seek in a livestream");

    const seekValue = interaction.options.getString('time');

    if (!seekValue) {
      throw new Error('missing seek value');
    }

    const seekTime = durationStringToSeconds(seekValue);

    if (!Number.isFinite(seekTime) || seekTime <= 0) {
      throw new Error('invalid seek value');
    }

    if (seekTime + player.getPosition() > currentSong.length) {
      throw new Error("can't seek past the end of the song");
    }

    await seekAndReply(interaction, () => player.forwardSeek(seekTime), player);
  }
}
