import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import { buildSeekToolbar } from '../ui/components.js';
import { buildSeekEmbed } from '../utils/buildEmbed.js';
import type Command from './index.js';

export default class Replay implements Command {
  public readonly slashCommand = new SlashCommandBuilder().setName('replay').setDescription('replay the current song');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new Error('nothing is playing');
    }

    if (currentSong.isLive) {
      throw new Error("can't replay a livestream");
    }

    await Promise.all([player.seek(0), interaction.deferReply()]);

    await interaction.editReply({
      embeds: [buildSeekEmbed(player)],
      components: buildSeekToolbar(),
    });
  }
}
