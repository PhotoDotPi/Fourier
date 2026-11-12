import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { STATUS } from '../services/player.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { VoicePlayerCommand } from './playerCommand.js';

export default class Loop extends VoicePlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('loop')
    .setDescription('toggle looping the current song');

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);

    if (player.status === STATUS.IDLE) {
      throw new Error('no song to loop!');
    }

    player.setLoopCurrentSong(!player.loopCurrentSong);

    await interaction.reply({
      embeds: [
        buildSuccessEmbed(player.loopCurrentSong ? 'Looping the current song.' : 'Stopped looping the current song.'),
      ],
    });
  }
}
