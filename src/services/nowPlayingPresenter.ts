import type {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
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

interface MusicMessagePayload {
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
    const shouldDeferReply = this.shouldDeferReply(interaction);

    await this.deferIfNeeded(interaction);

    const payload = await this.buildPlayingPayloadGuarded(player);
    if (!payload) {
      if (shouldDeferReply) {
        await interaction.deleteReply().catch(() => {});
      }
      return;
    }

    await interaction.editReply(payload);
  }

  private shouldDeferReply(
    interaction: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction,
  ): boolean {
    return !interaction.deferred && !interaction.replied && !interaction.isButton() && !interaction.isModalSubmit();
  }

  private async deferIfNeeded(
    interaction: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction,
  ): Promise<void> {
    if (interaction.deferred || interaction.replied) {
      return;
    }

    if (interaction.isButton() || interaction.isModalSubmit()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply();
    }
  }

  async buildPanelPayloadGuarded(player: Player): Promise<MusicMessagePayload | null> {
    if (!player.getCurrent()) {
      return null;
    }

    return this.buildGuardedPayload(player, buildPlayerPanelComponents, { includeSpeakingIndicator: true });
  }

  async buildPlayingPayloadGuarded(player: Player): Promise<MusicMessagePayload | null> {
    if (!player.getCurrent()) {
      throw new Error('No playing song found');
    }

    return this.buildGuardedPayload(player, buildPlayerControls);
  }

  private async buildGuardedPayload(
    player: Player,
    buildComponents: (player: Player) => MusicMessagePayload['components'],
    cardOptions?: { includeSpeakingIndicator?: boolean },
  ): Promise<MusicMessagePayload | null> {
    const capturedQueueEntryId = player.getCurrentQueueEntryId();
    const meta = await this.resolveMetadata(player);

    if (capturedQueueEntryId !== player.getCurrentQueueEntryId()) {
      return null;
    }

    const card = await this.musicCard.getOrGenerateForPlayer(player, meta);

    if (capturedQueueEntryId !== player.getCurrentQueueEntryId()) {
      return null;
    }

    const { embeds, attachments } = await buildMusicCardOrFallback(player, meta, card, cardOptions);

    return { embeds, files: attachments, components: buildComponents(player) };
  }

  private async resolveMetadata(player: Player): Promise<EnrichedTrackMetadata> {
    const song = player.getCurrent()!;
    const position = player.getPosition();
    return resolveEnrichedMetadata(song, position, this.itunesSearch);
  }
}
