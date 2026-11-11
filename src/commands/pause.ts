import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import type NowPlayingPresenter from '../services/nowPlayingPresenter.js';
import { STATUS } from '../services/player.js';
import type Command from './index.js';

export default class Pause implements Command {
  public readonly slashCommand = new SlashCommandBuilder().setName('pause').setDescription('pause the current song');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;
  private readonly presenter: NowPlayingPresenter;

  constructor(playerManager: PlayerManager, presenter: NowPlayingPresenter) {
    this.playerManager = playerManager;
    this.presenter = presenter;
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const player = this.playerManager.get(interaction.guild!.id);

    if (player.status !== STATUS.PLAYING) {
      throw new Error('not currently playing');
    }

    player.pause();

    await this.presenter.replyPlaying(interaction, player);
  }
}
