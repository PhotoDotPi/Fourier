import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { STATUS } from '../services/player.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { VoicePlayerCommand } from './playerCommand.js';

export default class LoopQueue extends VoicePlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('loop-queue')
    .setDescription('toggle looping the entire queue');

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);

    if (player.status === STATUS.IDLE) {
      throw new Error('no songs to loop!');
    }

    if (player.queueSize() < 1) {
      throw new Error('not enough songs to loop a queue!');
    }

    player.setLoopCurrentQueue(!player.loopCurrentQueue);

    await interaction.reply({
      embeds: [buildSuccessEmbed(player.loopCurrentQueue ? 'Looping the entire queue.' : 'Stopped looping the queue.')],
    });
  }
}
