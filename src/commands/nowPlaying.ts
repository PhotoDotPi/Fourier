import { SlashCommandBuilder } from '@discordjs/builders';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import type NowPlayingPresenter from '../services/nowPlayingPresenter.js';
import type Player from '../services/player.js';
import { STATUS } from '../services/player.js';
import { PlayerButtonId } from '../ui/components.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { getQueueView } from '../ui/queueView.js';
import { getGuildSettings } from '../utils/getGuildSettings.js';
import type Command from './index.js';

export default class NowPlaying implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('now-playing')
    .setDescription('shows the currently played song');

  public readonly handledButtonIds = Object.values(PlayerButtonId);

  private readonly playerManager: PlayerManager;
  private readonly presenter: NowPlayingPresenter;

  constructor(playerManager: PlayerManager, presenter: NowPlayingPresenter) {
    this.playerManager = playerManager;
    this.presenter = presenter;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.getCurrent()) {
      throw new Error('nothing is currently playing');
    }

    await this.presenter.replyPlaying(interaction, player);
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.getCurrent()) {
      throw new Error('nothing is currently playing');
    }

    switch (interaction.customId) {
      case PlayerButtonId.Previous:
        if (!player.canGoBack()) {
          throw new Error('no song to go back to');
        }
        await player.back();
        await this.renderPlayingMessage(interaction, player);
        return;

      case PlayerButtonId.Pause:
        if (player.status === STATUS.PLAYING) {
          player.pause();
        } else if (player.status === STATUS.PAUSED) {
          await player.play();
        } else {
          throw new Error('nothing is currently playing');
        }
        await this.renderPlayingMessage(interaction, player);
        return;

      case PlayerButtonId.Skip:
        if (!player.canGoForward(1)) {
          throw new Error('no song to skip to');
        }
        await player.forward(1);
        await this.renderPlayingMessage(interaction, player);
        return;

      case PlayerButtonId.Stop:
        player.stop();
        await interaction.update({
          embeds: [buildSuccessEmbed('Stopped playback and cleared the queue.')],
          components: [],
        });
        return;

      case PlayerButtonId.Queue:
        await this.renderQueueView(interaction, player);
        return;

      case PlayerButtonId.Shuffle:
        if (player.isQueueEmpty()) {
          throw new Error('not enough songs to shuffle');
        }
        player.shuffle();
        await this.renderPlayingMessage(interaction, player);
        return;

      case PlayerButtonId.Loop:
        player.setLoopCurrentSong(!player.loopCurrentSong);
        await this.renderPlayingMessage(interaction, player);
        return;

      case PlayerButtonId.VolumeDown:
        player.setVolume(Math.max(0, player.getVolume() - 5));
        await this.renderPlayingMessage(interaction, player);
        return;

      case PlayerButtonId.VolumeUp:
        player.setVolume(Math.min(100, player.getVolume() + 5));
        await this.renderPlayingMessage(interaction, player);
        return;

      default:
        throw new Error('unknown button interaction');
    }
  }

  private async renderPlayingMessage(interaction: ButtonInteraction, player: Player): Promise<void> {
    if (!player.getCurrent()) {
      await interaction.update({
        embeds: [buildSuccessEmbed('Nothing is currently playing.')],
        components: [],
      });
      return;
    }

    await this.presenter.editPlaying(interaction, player);
  }

  private async renderQueueView(interaction: ButtonInteraction, player: Player): Promise<void> {
    if (!player.getCurrent()) {
      await interaction.update({
        embeds: [buildSuccessEmbed('Nothing is currently playing.')],
        components: [],
      });
      return;
    }

    const pageSize = (await getGuildSettings(interaction.guild!.id)).defaultQueuePageSize;
    await interaction.update(getQueueView(player, 1, pageSize));
  }
}
