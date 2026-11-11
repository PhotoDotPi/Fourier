import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import type NowPlayingPresenter from '../services/nowPlayingPresenter.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import type Command from './index.js';

export default class Skip implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('skip')
    .setDescription('skip the next songs')
    .addIntegerOption((option) =>
      option.setName('number').setDescription('number of songs to skip [default: 1]').setRequired(false),
    );

  public requiresVC = true;

  private readonly playerManager: PlayerManager;
  private readonly presenter: NowPlayingPresenter;

  constructor(playerManager: PlayerManager, presenter: NowPlayingPresenter) {
    this.playerManager = playerManager;
    this.presenter = presenter;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const numToSkip = interaction.options.getInteger('number') ?? 1;

    if (numToSkip < 1) {
      throw new Error('invalid number of songs to skip');
    }

    const player = this.playerManager.get(interaction.guild!.id);
    await interaction.deferReply();

    try {
      await player.forward(numToSkip);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'No songs in queue to forward to.') {
        throw new Error('no song to skip to');
      }

      throw error;
    }

    if (player.getCurrent()) {
      await this.presenter.editPlaying(interaction, player);
    } else {
      await interaction.editReply({
        embeds: [buildSuccessEmbed('Skipped to the end of the queue.')],
      });
    }
  }
}
