import { SlashCommandBuilder } from '@discordjs/builders';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import type Player from '../services/player.js';
import { STATUS } from '../services/player.js';
import { PlayerButtonId } from '../ui/components.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import { getQueueView } from '../ui/queueView.js';
import { getGuildSettings } from '../utils/getGuildSettings.js';
import { PresenterPlayerCommand } from './playerCommand.js';

const updateWithNothingPlaying = async (interaction: ButtonInteraction): Promise<void> => {
  await interaction.update({
    embeds: [buildSuccessEmbed('Nothing is currently playing.')],
    components: [],
  });
};

type PlayerButtonIdValue = (typeof PlayerButtonId)[keyof typeof PlayerButtonId];

export default class NowPlaying extends PresenterPlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('now-playing')
    .setDescription('shows the currently played song');

  public readonly handledButtonIds = Object.values(PlayerButtonId);

  private readonly buttonHandlers: Partial<
    Record<PlayerButtonIdValue, (interaction: ButtonInteraction, player: Player) => Promise<void>>
  > = {
    [PlayerButtonId.Previous]: async (interaction, player) => {
      if (!player.canGoBack()) {
        throw new Error('no song to go back to');
      }

      await player.back();
      await this.renderPlayingMessage(interaction, player);
    },

    [PlayerButtonId.Pause]: async (interaction, player) => {
      if (player.status === STATUS.PLAYING) {
        player.pause();
      } else if (player.status === STATUS.PAUSED) {
        await player.play();
      } else {
        throw new Error('nothing is currently playing');
      }

      await this.renderPlayingMessage(interaction, player);
    },

    [PlayerButtonId.Skip]: async (interaction, player) => {
      if (!player.canGoForward(1)) {
        throw new Error('no song to skip to');
      }

      await player.forward(1);
      await this.renderPlayingMessage(interaction, player);
    },

    [PlayerButtonId.Stop]: async (interaction, player) => {
      player.stop();
      await interaction.update({
        embeds: [buildSuccessEmbed('Stopped playback and cleared the queue.')],
        components: [],
      });
    },

    [PlayerButtonId.Queue]: async (interaction, player) => {
      await this.renderQueueView(interaction, player);
    },

    [PlayerButtonId.Shuffle]: async (interaction, player) => {
      if (player.isQueueEmpty()) {
        throw new Error('not enough songs to shuffle');
      }

      player.shuffle();
      await this.renderPlayingMessage(interaction, player);
    },

    [PlayerButtonId.Loop]: async (interaction, player) => {
      player.setLoopCurrentSong(!player.loopCurrentSong);
      await this.renderPlayingMessage(interaction, player);
    },

    [PlayerButtonId.VolumeDown]: async (interaction, player) => {
      player.setVolume(Math.max(0, player.getVolume() - 5));
      await this.renderPlayingMessage(interaction, player);
    },

    [PlayerButtonId.VolumeUp]: async (interaction, player) => {
      player.setVolume(Math.min(100, player.getVolume() + 5));
      await this.renderPlayingMessage(interaction, player);
    },
  };

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);

    if (!player.getCurrent()) {
      throw new Error('nothing is currently playing');
    }

    await this.presenter.replyPlaying(interaction, player);
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const player = this.getPlayer(interaction);

    if (!player.getCurrent()) {
      throw new Error('nothing is currently playing');
    }

    const handler = this.buttonHandlers[interaction.customId as PlayerButtonIdValue];

    if (!handler) {
      throw new Error('unknown button interaction');
    }

    await handler(interaction, player);
  }

  private async renderPlayingMessage(interaction: ButtonInteraction, player: Player): Promise<void> {
    if (!player.getCurrent()) {
      await updateWithNothingPlaying(interaction);
      return;
    }

    await this.presenter.editPlaying(interaction, player);
  }

  private async renderQueueView(interaction: ButtonInteraction, player: Player): Promise<void> {
    if (!player.getCurrent()) {
      await updateWithNothingPlaying(interaction);
      return;
    }

    const pageSize = (await getGuildSettings(interaction.guild!.id)).defaultQueuePageSize;
    await interaction.update(getQueueView(player, 1, pageSize));
  }
}
