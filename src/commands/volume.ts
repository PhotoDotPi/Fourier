import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import type NowPlayingPresenter from '../services/nowPlayingPresenter.js';
import type Command from './index.js';

export default class Volume implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('volume')
    .setDescription('set current player volume level')
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('volume percentage (0 is muted, 100 is max & default)')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true),
    );

  public requiresVC = true;

  private readonly playerManager: PlayerManager;
  private readonly presenter: NowPlayingPresenter;

  constructor(playerManager: PlayerManager, presenter: NowPlayingPresenter) {
    this.playerManager = playerManager;
    this.presenter = presenter;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new Error('nothing is playing');
    }

    const level = interaction.options.getInteger('level') ?? 100;
    player.setVolume(level);

    await this.presenter.replyPlaying(interaction, player);
  }
}
