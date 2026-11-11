import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { Emoji } from '../constants/emoji.js';
import type { MusicCardResult } from '../services/musicCard.js';
import type { EnrichedTrackMetadata } from '../services/musicMetadata.js';
import type Player from '../services/player.js';
import type { QueuedSong } from '../services/playerTypes.js';
import { MediaSource, STATUS } from '../services/playerTypes.js';
import getProgressBar from '../utils/getProgressBar.js';
import { prettyTime } from '../utils/time.js';
import { EmbedColor } from './embeds.js';

const MAX_TITLE_LENGTH = 48;
const MAX_NON_ASCII_TITLE_LENGTH = 28;

const getMaxSongTitleLength = (title: string): number => {
  const nonASCII = /[^\x00-\x7F]+/;
  return nonASCII.test(title) ? MAX_NON_ASCII_TITLE_LENGTH : MAX_TITLE_LENGTH;
};

const getSongTitle = ({ title, url, offset, source }: QueuedSong, shouldTruncate = false): string => {
  if (source === MediaSource.HLS) {
    return `[${title}](${url})`;
  }

  const cleanTitle = title.replace(/\[.*\]/, '').trim();
  const displayTitle = shouldTruncate ? cleanTitle.slice(0, getMaxSongTitleLength(cleanTitle)) : cleanTitle;

  const getYouTubeID = (input: string): string | null => {
    const match = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match?.[1] ?? null;
  };

  const youtubeId = url.length === 11 ? url : (getYouTubeID(url) ?? '');

  return `[${displayTitle}](https://www.youtube.com/watch?v=${youtubeId}${offset === 0 ? '' : `&t=${String(offset)}`})`;
};

const getPlayerUI = (player: Player): string => {
  const song = player.getCurrent();
  if (!song) {
    return '';
  }

  const position = player.getPosition();
  const stateEmoji = player.status === STATUS.PLAYING ? Emoji.Play : Emoji.Pause;
  const progressBar = getProgressBar(10, song.length > 0 ? position / song.length : 0);
  const elapsedTime = song.isLive ? 'live' : `${prettyTime(position)}/${prettyTime(song.length)}`;
  const loop = player.loopCurrentSong ? Emoji.RepeatOne : player.loopCurrentQueue ? Emoji.RepeatAll : '';
  const volume = typeof player.getVolume() === 'number' ? `${Emoji.VolumeDown} ${player.getVolume()!}%` : '';

  return `${stateEmoji} ${progressBar} \`[${elapsedTime}]\` ${volume} ${loop}`.trim();
};

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

const getSpeakingIndicator = (player: Player): string => {
  const speakingUserIds = player.getSpeakingUserIds();

  if (speakingUserIds.length === 0) {
    return '';
  }

  const names = speakingUserIds.map((userId) => `<@${userId}>`).join(', ');
  return `${Emoji.Mic} ${names} ${speakingUserIds.length === 1 ? 'is' : 'are'} talking ${Emoji.Signal}`;
};

export const buildMusicCardEmbed = (
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

  if (options?.includeSpeakingIndicator) {
    const speakingLine = getSpeakingIndicator(player);
    if (speakingLine !== '' && player.status === STATUS.PLAYING) {
      embed.addFields([{ name: `${Emoji.Mic} Who's talking`, value: speakingLine }]);
    }
  }

  return {
    embeds: [embed],
    attachments: [cardImage],
  };
};

export const buildFallbackPlayingEmbed = (
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
    .setDescription(`**${getSongTitle(song)}**\nRequested by: <@${song.requestedBy}>\n\n${getPlayerUI(player)}`)
    .setFooter({ text: getSourceLabel(song) });

  if (options?.includeSpeakingIndicator) {
    const speakingLine = getSpeakingIndicator(player);
    if (speakingLine !== '' && player.status === STATUS.PLAYING) {
      embed.addFields([{ name: `${Emoji.Mic} Who's talking`, value: speakingLine }]);
    }
  }

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
