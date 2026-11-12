import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import type { MusicCardResult } from '../services/musicCard.js';
import type { EnrichedTrackMetadata } from '../services/musicMetadata.js';
import type Player from '../services/player.js';
import { MediaSource, type QueuedSong, STATUS } from '../services/playerTypes.js';
import { applySpeakingIndicator, getPlayerUI, getSongTitle } from './embedShared.js';
import { EmbedColor } from './embeds.js';

const getSourceLabel = (song: QueuedSong): string => {
  if (song.source === MediaSource.HLS) {
    return 'Live stream';
  }
  return song.artist || 'Unknown source';
};

const getMetadataLines = (meta: EnrichedTrackMetadata): string[] => {
  const lines: string[] = [];

  if (meta.album) {
    lines.push(`**Album:** ${meta.album}`);
  }
  if (meta.genre) {
    lines.push(`**Genre:** ${meta.genre}`);
  }

  return lines;
};

export interface MusicPlayingMessageResult {
  embeds: EmbedBuilder[];
  attachments: AttachmentBuilder[];
}

const buildMusicCardEmbed = (
  player: Player,
  meta: EnrichedTrackMetadata,
  cardResult: MusicCardResult,
  options?: { includeSpeakingIndicator?: boolean },
): MusicPlayingMessageResult => {
  const song = player.getCurrent();
  if (!song) {
    throw new Error('No playing song found');
  }

  const cardImage = new AttachmentBuilder(cardResult.buffer, { name: 'now-playing.png' });
  const metaLines = getMetadataLines(meta);
  const statusLabel = player.status === STATUS.PLAYING ? 'Now Playing' : 'Paused';
  const statusColor = player.status === STATUS.PLAYING ? EmbedColor.Brand : EmbedColor.Paused;

  const descriptionParts: string[] = [];
  descriptionParts.push(getSongTitle(song));
  descriptionParts.push(`Requested by: <@${song.requestedBy}>`);
  if (metaLines.length > 0) {
    descriptionParts.push('');
    descriptionParts.push(metaLines.join('\n'));
  }

  const embed = new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(`${statusLabel}`)
    .setDescription(descriptionParts.join('\n'))
    .setImage('attachment://now-playing.png')
    .setFooter({ text: getSourceLabel(song) });

  applySpeakingIndicator(embed, player, options?.includeSpeakingIndicator);

  return {
    embeds: [embed],
    attachments: [cardImage],
  };
};

const buildFallbackPlayingEmbed = (
  player: Player,
  options?: { includeSpeakingIndicator?: boolean },
): MusicPlayingMessageResult => {
  const song = player.getCurrent();
  if (!song) {
    throw new Error('No playing song found');
  }

  const statusLabel = player.status === STATUS.PLAYING ? 'Now Playing' : 'Paused';
  const statusColor = player.status === STATUS.PLAYING ? EmbedColor.Brand : EmbedColor.Paused;

  const embed = new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(statusLabel)
    .setDescription(`**${getSongTitle(song)}**\nRequested by: <@${song.requestedBy}>\n\n${getPlayerUI(player, true)}`)
    .setFooter({ text: getSourceLabel(song) });

  applySpeakingIndicator(embed, player, options?.includeSpeakingIndicator);

  if (song.thumbnailUrl) {
    embed.setThumbnail(song.thumbnailUrl);
  }

  return {
    embeds: [embed],
    attachments: [],
  };
};

export const buildMusicCardOrFallback = async (
  player: Player,
  meta: EnrichedTrackMetadata,
  cardResult: MusicCardResult | null,
  options?: { includeSpeakingIndicator?: boolean },
): Promise<MusicPlayingMessageResult> => {
  if (cardResult) {
    return buildMusicCardEmbed(player, meta, cardResult, options);
  }
  return buildFallbackPlayingEmbed(player, options);
};
