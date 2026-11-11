import type {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message,
  MessageActionRowComponentBuilder,
  ModalSubmitInteraction,
} from 'discord.js';
import { buildPlayerControls, buildPlayerPanelComponents } from '../ui/components.js';
import { buildMusicCardOrFallback } from '../ui/musicEmbed.js';
import type ItunesSearchService from './itunesSearch.js';
import type MusicCardService from './musicCard.js';
import type { EnrichedTrackMetadata } from './musicMetadata.js';
import { resolveEnrichedMetadata } from './musicMetadata.js';
import type Player from './player.js';

export interface MusicMessagePayload {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  components: Array<ActionRowBuilder<MessageActionRowComponentBuilder>>;
}

export default class NowPlayingPresenter {
  private readonly itunesSearch: ItunesSearchService | null;
  private readonly musicCard: MusicCardService;

  constructor(musicCard: MusicCardService, itunesSearch: ItunesSearchService | null) {
    this.musicCard = musicCard;
    this.itunesSearch = itunesSearch;
  }

  async replyPlaying(interaction: ChatInputCommandInteraction | ButtonInteraction, player: Player): Promise<void> {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const payload = await this.buildPlayingPayloadGuarded(player);
    if (!payload) {
      await interaction.deleteReply().catch(() => {});
      return;
    }

    await interaction.editReply(payload);
  }

  async editPlaying(
    interaction: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction,
    player: Player,
  ): Promise<void> {
    const shouldDeferReply =
      !interaction.deferred && !interaction.replied && !interaction.isButton() && !interaction.isModalSubmit();

    if (!interaction.deferred && !interaction.replied) {
      if (interaction.isButton() || interaction.isModalSubmit()) {
        await interaction.deferUpdate();
      } else {
        await interaction.deferReply();
      }
    }

    const payload = await this.buildPlayingPayloadGuarded(player);
    if (!payload) {
      if (shouldDeferReply) {
        await interaction.deleteReply().catch(() => {});
      }
      return;
    }

    await interaction.editReply(payload);
  }

  async updatePanelMessage(player: Player, message: Message): Promise<void> {
    const payload = await this.buildPanelPayloadGuarded(player);
    if (!payload) {
      return;
    }
    await message.edit(payload);
  }

  async buildPanelPayloadGuarded(player: Player): Promise<MusicMessagePayload | null> {
    const song = player.getCurrent();
    if (!song) {
      return null;
    }

    const capturedQueueEntryId = player.getCurrentQueueEntryId();
    const meta = await this.resolveMetadata(player);

    if (capturedQueueEntryId !== player.getCurrentQueueEntryId()) {
      return null;
    }

    const card = await this.musicCard.getOrGenerateForPlayer(player, meta);

    if (capturedQueueEntryId !== player.getCurrentQueueEntryId()) {
      return null;
    }

    const { embeds, attachments } = await buildMusicCardOrFallback(player, meta, card, {
      includeSpeakingIndicator: true,
    });
    const components = buildPlayerPanelComponents(player);

    return { embeds, files: attachments, components };
  }

  async buildPlayingPayloadGuarded(player: Player): Promise<MusicMessagePayload | null> {
    const song = player.getCurrent();
    if (!song) {
      throw new Error('No playing song found');
    }

    const capturedQueueEntryId = player.getCurrentQueueEntryId();
    const meta = await this.resolveMetadata(player);

    if (capturedQueueEntryId !== player.getCurrentQueueEntryId()) {
      return null;
    }

    const card = await this.musicCard.getOrGenerateForPlayer(player, meta);

    if (capturedQueueEntryId !== player.getCurrentQueueEntryId()) {
      return null;
    }

    const { embeds, attachments } = await buildMusicCardOrFallback(player, meta, card);
    const components = buildPlayerControls(player);

    return { embeds, files: attachments, components };
  }

  private async resolveMetadata(player: Player): Promise<EnrichedTrackMetadata> {
    const song = player.getCurrent()!;
    const position = player.getPosition();
    return resolveEnrichedMetadata(song, position, this.itunesSearch);
  }
}

export type { MusicMessagePayload as NowPlayingPayload };
