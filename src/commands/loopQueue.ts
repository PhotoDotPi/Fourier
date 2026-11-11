import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import { STATUS } from '../services/player.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import type Command from './index.js';

export default class LoopQueue implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('loop-queue')
    .setDescription('toggle looping the entire queue');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

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
