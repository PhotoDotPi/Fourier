import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import type NowPlayingPresenter from '../services/nowPlayingPresenter.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import type Command from './index.js';

export default class Unskip implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('unskip')
    .setDescription('go back in the queue by one song');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;
  private readonly presenter: NowPlayingPresenter;

  constructor(playerManager: PlayerManager, presenter: NowPlayingPresenter) {
    this.playerManager = playerManager;
    this.presenter = presenter;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);
    await interaction.deferReply();

    try {
      await player.back();
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'No songs in queue to go back to.') {
        throw new Error('no song to go back to');
      }

      throw error;
    }

    if (player.getCurrent()) {
      await this.presenter.editPlaying(interaction, player);
    } else {
      await interaction.editReply({
        embeds: [buildSuccessEmbed('Back at the start of the queue.')],
      });
    }
  }
}
