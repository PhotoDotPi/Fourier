import { SlashCommandBuilder } from '@discordjs/builders';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { SeekButtonId } from '../ui/components.js';
import durationStringToSeconds from '../utils/durationStringToSeconds.js';
import { parseTime } from '../utils/time.js';
import { VoicePlayerCommand } from './playerCommand.js';
import { getSeekableSong, replyWithSeekEmbed, seekAndReply } from './seekSupport.js';

export default class Seek extends VoicePlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('seek')
    .setDescription('seek to a position from beginning of song')
    .addStringOption((option) =>
      option
        .setName('time')
        .setDescription('an interval expression or number of seconds (1m, 30s, 100)')
        .setRequired(true),
    );

  public readonly handledButtonIds = Object.values(SeekButtonId);

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);
    const currentSong = getSeekableSong(player, "can't seek in a livestream");

    const time = interaction.options.getString('time')!.trim();

    let seekTime = 0;

    if (time.includes(':')) {
      if (!/^\+?\d+(?::\d+)+$/.test(time)) {
        throw new Error('invalid seek value');
      }

      seekTime = parseTime(time);
    } else {
      seekTime = durationStringToSeconds(time);
    }

    if (!Number.isFinite(seekTime) || seekTime < 0) {
      throw new Error('invalid seek value');
    }

    if (seekTime > currentSong.length) {
      throw new Error("can't seek past the end of the song");
    }

    await seekAndReply(interaction, () => player.seek(seekTime), player);
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const player = this.getPlayer(interaction);
    const currentSong = getSeekableSong(player, "can't seek in a livestream");

    const position = player.getPosition();
    await interaction.deferUpdate();

    switch (interaction.customId) {
      case SeekButtonId.Back:
        await player.seek(Math.max(0, position - 10));
        break;
      case SeekButtonId.Forward:
        await player.seek(Math.min(currentSong.length, position + 10));
        break;
      case SeekButtonId.Replay:
        await player.seek(0);
        break;
      default:
        throw new Error('unknown button interaction');
    }

    await replyWithSeekEmbed(interaction, player);
  }
}
