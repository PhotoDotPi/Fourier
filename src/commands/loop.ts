import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import { STATUS } from '../services/player.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import type Command from './index.js';

export default class Loop implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('loop')
    .setDescription('toggle looping the current song');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

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
