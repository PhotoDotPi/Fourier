import type { ButtonInteraction, Client, Message, ModalSubmitInteraction, VoiceChannel } from 'discord.js';
import * as playerPanelRepo from '../db/repositories/playerPanel.js';
import type { PlayerPanelRow } from '../db/types.js';
import type PlayerManager from '../managers/player.js';
import {
  buildPlayerPanelComponents,
  buildPlayerPanelSearchModal,
  PanelButtonId,
  PanelModalId,
} from '../ui/components.js';
import { buildPlayerPanelEmbed } from '../utils/buildEmbed.js';
import debug from '../utils/debug.js';
import type AddQueryToQueue from './addQueryToQueue.js';
import type NowPlayingPresenter from './nowPlayingPresenter.js';
import type Player from './player.js';
import { STATUS } from './player.js';

const PANEL_REFRESH_INTERVAL_MS = 10_000;

export default class PlayerPanelManager {
  private readonly playerManager: PlayerManager;
  private readonly client: Client;
  private readonly addQueryToQueue: AddQueryToQueue;
  private readonly presenter: NowPlayingPresenter;
  private readonly panels = new Map<string, PlayerPanelRow>();
  private readonly players = new Map<string, Player>();
  private readonly updateChains = new Map<string, Promise<void>>();

  constructor(
    playerManager: PlayerManager,
    client: Client,
    addQueryToQueue: AddQueryToQueue,
    presenter: NowPlayingPresenter,
  ) {
    this.playerManager = playerManager;
    this.client = client;
    this.addQueryToQueue = addQueryToQueue;
    this.presenter = presenter;

    playerManager.onPlayerCreate((player) => {
      this.players.set(player.guildId, player);
      this.subscribeToPlayer(player);
    });
  }

  async init(): Promise<void> {
    const rows = await playerPanelRepo.findAll();

    for (const row of rows) {
      this.panels.set(row.guildId, row);
      const player = this.players.get(row.guildId) ?? this.playerManager.get(row.guildId);
      this.players.set(row.guildId, player);
      await this.updatePlayerPanel(row.guildId).catch((error) => {
        console.error(`Failed to restore player panel for guild ${row.guildId}:`, error);
      });
    }

    setInterval(() => {
      void this.refreshActivePanels().catch((error) => {
        console.error('Failed to refresh player panels:', error);
      });
    }, PANEL_REFRESH_INTERVAL_MS);
  }

  getConfig(guildId: string): PlayerPanelRow | null {
    return this.panels.get(guildId) ?? null;
  }

  async setChannel(guildId: string, channel: VoiceChannel): Promise<PlayerPanelRow> {
    const player = this.players.get(guildId) ?? this.playerManager.get(guildId);
    this.players.set(guildId, player);

    const previousPanel = this.panels.get(guildId);

    const options = await this.buildPanelMessageOptions(player);
    const message = await channel.send(options);
    let panel: PlayerPanelRow;
    try {
      panel = await playerPanelRepo.upsert(guildId, channel.id, message.id);
    } catch (error) {
      await message.delete().catch(() => {});
      throw error;
    }
    this.panels.set(guildId, panel);

    if (previousPanel && previousPanel.messageId !== panel.messageId) {
      await this.deletePanelMessage(previousPanel);
    }

    debug(`Player panel created in guild ${guildId} (channel ${channel.id})`);
    return panel;
  }

  async disable(guildId: string): Promise<void> {
    const panel = this.panels.get(guildId);
    if (!panel) {
      return;
    }

    await this.deletePanelMessage(panel);

    await playerPanelRepo.remove(guildId);
    this.panels.delete(guildId);
    debug(`Player panel removed from guild ${guildId}`);
  }

  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const panel = guildId ? this.panels.get(guildId) : undefined;
    if (!guildId || !panel || !this.isPanelMessage(interaction.message.id, panel)) {
      return;
    }

    const player = this.players.get(guildId) ?? this.playerManager.get(guildId);
    this.players.set(guildId, player);

    switch (interaction.customId) {
      case PanelButtonId.Pause:
        await this.handleToggle(interaction, player);
        return;

      case PanelButtonId.Skip:
        if (!player.canGoForward(1)) {
          throw new Error('no song to skip to');
        }
        await player.forward(1);
        await this.updateMessageFromInteraction(interaction, player);
        return;

      case PanelButtonId.Stop:
        player.stop();
        await this.updateMessageFromInteraction(interaction, player);
        return;

      case PanelButtonId.Shuffle:
        if (player.isQueueEmpty()) {
          throw new Error('not enough songs to shuffle');
        }
        player.shuffle();
        await this.updateMessageFromInteraction(interaction, player);
        return;

      case PanelButtonId.Loop:
        player.setLoopCurrentSong(!player.loopCurrentSong);
        await this.updateMessageFromInteraction(interaction, player);
        return;

      case PanelButtonId.VolumeDown:
        player.setVolume(Math.max(0, player.getVolume() - 5));
        await this.updateMessageFromInteraction(interaction, player);
        return;

      case PanelButtonId.VolumeUp:
        player.setVolume(Math.min(100, player.getVolume() + 5));
        await this.updateMessageFromInteraction(interaction, player);
        return;

      case PanelButtonId.Search:
        await interaction.showModal(buildPlayerPanelSearchModal());
        return;

      default:
        return;
    }
  }

  async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (interaction.customId !== PanelModalId.Search) {
      return;
    }

    const guildId = interaction.guildId;
    const panel = guildId ? this.panels.get(guildId) : undefined;
    if (!panel) {
      return;
    }

    const query = interaction.fields.getTextInputValue(PanelModalId.SearchQueryInput).trim();

    await this.addQueryToQueue.addToQueue({
      interaction,
      query,
      addToFrontOfQueue: false,
      shuffleAdditions: false,
      shouldSplitChapters: false,
      skipCurrentTrack: false,
    });
  }

  private subscribeToPlayer(player: Player): void {
    const refresh = () => {
      void this.updatePlayerPanel(player.guildId).catch(() => {});
    };

    player.on('trackStart', refresh);
    player.on('trackEnd', refresh);
    player.on('statusChange', refresh);
    player.on('disconnect', refresh);
    player.on('volumeChange', refresh);
    player.on('loopChange', refresh);
    player.on('queueChange', refresh);
  }

  private async refreshActivePanels(): Promise<void> {
    for (const row of this.panels.values()) {
      const player = this.players.get(row.guildId);
      if (player && player.status === STATUS.PLAYING) {
        await this.updatePlayerPanel(row.guildId);
      }
    }
  }

  private async updatePlayerPanel(guildId: string): Promise<void> {
    const panel = this.panels.get(guildId);
    if (!panel) {
      return;
    }

    const player = this.players.get(guildId) ?? this.playerManager.get(guildId);
    const previous = this.updateChains.get(guildId) ?? Promise.resolve();

    const next = previous.then(async () => {
      const message = await this.resolvePanelMessage(panel);
      if (!message) {
        return;
      }

      const options = await this.buildPanelMessageOptions(player);
      await message.edit(options);
    });

    this.updateChains.set(
      guildId,
      next.catch(() => {}),
    );
    await next;
  }

  private async buildPanelMessageOptions(player: Player): Promise<{
    embeds: Array<import('discord.js').EmbedBuilder>;
    files: import('discord.js').AttachmentBuilder[];
    components: Array<import('discord.js').ActionRowBuilder<import('discord.js').MessageActionRowComponentBuilder>>;
  }> {
    if (!player.getCurrent()) {
      return {
        embeds: [buildPlayerPanelEmbed(player)],
        files: [],
        components: buildPlayerPanelComponents(player),
      };
    }

    const payload = await this.presenter.buildPanelPayloadGuarded(player);
    if (!payload) {
      return {
        embeds: [buildPlayerPanelEmbed(player)],
        files: [],
        components: buildPlayerPanelComponents(player),
      };
    }

    return {
      embeds: payload.embeds,
      files: payload.files,
      components: payload.components,
    };
  }

  private async deletePanelMessage(panel: PlayerPanelRow): Promise<void> {
    const message = await this.resolvePanelMessage(panel);
    if (message) {
      await message.delete().catch(() => {});
    }
  }

  private async updateMessageFromInteraction(interaction: ButtonInteraction, player: Player): Promise<void> {
    const options = await this.buildPanelMessageOptions(player);
    await interaction.update(options);
  }

  private async handleToggle(interaction: ButtonInteraction, player: Player): Promise<void> {
    if (player.status === STATUS.PLAYING) {
      player.pause();
    } else if (player.status === STATUS.PAUSED) {
      await player.play();
    } else if (player.getCurrent()) {
      await player.play();
    } else {
      throw new Error('nothing is currently playing');
    }

    await this.updateMessageFromInteraction(interaction, player);
  }

  private isPanelMessage(messageId: string, panel: PlayerPanelRow): boolean {
    return panel.messageId === messageId;
  }

  private async resolvePanelMessage(panel: PlayerPanelRow): Promise<Message | null> {
    const guild = this.client.guilds.cache.get(panel.guildId);
    const channel = guild?.channels.cache.get(panel.channelId);
    if (!channel?.isTextBased() || !panel.messageId) {
      return null;
    }

    try {
      return await channel.messages.fetch(panel.messageId);
    } catch {
      return null;
    }
  }
}
