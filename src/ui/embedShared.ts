import type { EmbedBuilder } from 'discord.js';
import { Emoji } from '../constants/emoji.js';
import type Player from '../services/player.js';
import { MediaSource, type QueuedSong, STATUS } from '../services/playerTypes.js';
import getProgressBar from '../utils/getProgressBar.js';
import getYouTubeId from '../utils/getYouTubeId.js';
import { truncate } from '../utils/string.js';
import { prettyTime } from '../utils/time.js';

const getMaxSongTitleLength = (title: string): number => {
  const nonASCII = /[^\x00-\x7F]+/;
  return nonASCII.test(title) ? 28 : 48;
};

export const getSongTitle = ({ title, url, offset, source }: QueuedSong, shouldTruncate = false): string => {
  if (source === MediaSource.HLS) {
    return `[${title}](${url})`;
  }

  const cleanTitle = title.replace(/\[.*\]/, '').trim();
  const songTitle = shouldTruncate ? truncate(cleanTitle, getMaxSongTitleLength(cleanTitle)) : cleanTitle;
  const youtubeId = url.length === 11 ? url : (getYouTubeId(url) ?? '');

  return `[${songTitle}](https://www.youtube.com/watch?v=${youtubeId}${offset === 0 ? '' : `&t=${String(offset)}`})`;
};

export const getPlayerUI = (player: Player, guardZeroLength = false): string => {
  const song = player.getCurrent();

  if (!song) {
    return '';
  }

  const position = player.getPosition();
  const stateEmoji = player.status === STATUS.PLAYING ? Emoji.Play : Emoji.Pause;
  const progress = guardZeroLength && song.length <= 0 ? 0 : position / song.length;
  const progressBar = getProgressBar(10, progress);
  const elapsedTime = song.isLive ? 'live' : `${prettyTime(position)}/${prettyTime(song.length)}`;
  const loop = player.loopCurrentSong ? Emoji.RepeatOne : player.loopCurrentQueue ? Emoji.RepeatAll : '';
  const volume = typeof player.getVolume() === 'number' ? `${Emoji.VolumeDown} ${player.getVolume()!}%` : '';

  return `${stateEmoji} ${progressBar} \`[${elapsedTime}]\` ${volume} ${loop}`.trim();
};

const getSpeakingIndicator = (player: Player): string => {
  const speakingUserIds = player.getSpeakingUserIds();

  if (speakingUserIds.length === 0) {
    return '';
  }

  const names = speakingUserIds.map((userId) => `<@${userId}>`).join(', ');
  return `${Emoji.Mic} ${names} ${speakingUserIds.length === 1 ? 'is' : 'are'} talking ${Emoji.Signal}`;
};

export const applySpeakingIndicator = (embed: EmbedBuilder, player: Player, include?: boolean): void => {
  if (!include) {
    return;
  }

  const speakingLine = getSpeakingIndicator(player);
  if (speakingLine !== '' && player.status === STATUS.PLAYING) {
    embed.addFields([{ name: `${Emoji.Mic} Who's talking`, value: speakingLine }]);
  }
};
