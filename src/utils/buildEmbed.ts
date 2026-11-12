import { EmbedBuilder } from 'discord.js';
import { Emoji, Glyph } from '../constants/emoji.js';
import type Player from '../services/player.js';
import { STATUS } from '../services/playerTypes.js';
import { applySpeakingIndicator, getPlayerUI, getSongTitle } from '../ui/embedShared.js';
import { EmbedColor } from '../ui/embeds.js';
import getProgressBar from './getProgressBar.js';
import { prettyTime } from './time.js';

const getQueueInfo = (player: Player) => {
  const queueSize = player.queueSize();
  if (queueSize === 0) {
    return '-';
  }

  return queueSize === 1 ? '1 song' : `${queueSize} songs`;
};

export const buildPlayingMessageEmbed = (player: Player): EmbedBuilder => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('No playing song found');
  }

  const { artist, thumbnailUrl, requestedBy } = currentlyPlaying;
  const message = new EmbedBuilder();
  message
    .setColor(player.status === STATUS.PLAYING ? EmbedColor.Brand : EmbedColor.Paused)
    .setTitle(player.status === STATUS.PLAYING ? 'Now Playing' : 'Paused')
    .setDescription(`
      **${getSongTitle(currentlyPlaying)}**
      Requested by: <@${requestedBy}>\n
      ${getPlayerUI(player)}
    `)
    .setFooter({ text: `Source: ${artist}` });

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};

export const buildQueueEmbed = (player: Player, page: number, pageSize: number): EmbedBuilder => {
  if (page < 1) {
    throw new Error('page must be at least 1');
  }

  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('queue is empty');
  }

  const queueSize = player.queueSize();
  const maxQueuePage = Math.max(1, Math.ceil(queueSize / pageSize));

  if (page > maxQueuePage) {
    throw new Error("the queue isn't that big");
  }

  const queuePageBegin = (page - 1) * pageSize;
  const queuePageEnd = queuePageBegin + pageSize;
  const queuedSongs = player
    .getQueue()
    .slice(queuePageBegin, queuePageEnd)
    .map((song, index) => {
      const songNumber = index + 1 + queuePageBegin;
      const duration = song.isLive ? 'live' : prettyTime(song.length);

      return `\`${songNumber}.\` ${getSongTitle(song, true)} \`[${duration}]\``;
    })
    .join('\n');

  const { artist, thumbnailUrl, playlist, requestedBy } = currentlyPlaying;
  const playlistTitle = playlist ? `(${playlist.title})` : '';
  const totalLength = player.getQueue().reduce((accumulator, current) => accumulator + current.length, 0);

  const message = new EmbedBuilder();

  let description = `**${getSongTitle(currentlyPlaying)}**\n`;
  description += `Requested by: <@${requestedBy}>\n\n`;
  description += `${getPlayerUI(player)}\n\n`;

  if (player.getQueue().length > 0) {
    description += '**Up next:**\n';
    description += queuedSongs;
  }

  message
    .setTitle(player.status === STATUS.PLAYING ? 'Now Playing' : 'Queued songs')
    .setColor(player.status === STATUS.PLAYING ? EmbedColor.Brand : EmbedColor.Idle)
    .setDescription(description)
    .addFields([
      { name: 'In queue', value: getQueueInfo(player), inline: true },
      {
        name: 'Total length',
        value: `${totalLength > 0 ? prettyTime(totalLength) : '-'}`,
        inline: true,
      },
      { name: 'Page', value: `${page} out of ${maxQueuePage}`, inline: true },
    ])
    .setFooter({ text: `Source: ${artist} ${playlistTitle}` });

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};

export const buildSeekEmbed = (player: Player): EmbedBuilder => {
  const song = player.getCurrent();

  if (!song) {
    throw new Error('No playing song found');
  }

  const position = player.getPosition();
  const songTitle = song.title ?? 'Current song';
  const elapsedTime = song.isLive ? 'live' : `${prettyTime(position)}/${prettyTime(song.length)}`;
  const progressBar = getProgressBar(10, song.length > 0 ? position / song.length : 0);

  return new EmbedBuilder()
    .setColor(EmbedColor.Brand)
    .setTitle(`${Glyph.Info} Seeked to ${prettyTime(position)}`)
    .setDescription(`**${songTitle}**\n${progressBar} \`[${elapsedTime}]\``);
};

const getStatusLine = (player: Player): string => {
  const song = player.getCurrent();

  if (!song) {
    return `${Emoji.Idle} Nothing is playing right now. Queue something up to get started!`;
  }

  const position = player.getPosition();
  const stateEmoji = player.status === STATUS.PLAYING ? Emoji.Play : Emoji.Pause;
  const progressBar = getProgressBar(10, song.length > 0 ? position / song.length : 0);
  const elapsedTime = song.isLive ? 'live' : `${prettyTime(position)}/${prettyTime(song.length)}`;
  const loop = player.loopCurrentSong ? Emoji.RepeatOne : player.loopCurrentQueue ? Emoji.RepeatAll : '';
  const volume = `${Emoji.VolumeDown} ${player.getVolume()}%`;

  return `${stateEmoji} ${progressBar} \`[${elapsedTime}]\` ${volume} ${loop}`.trim();
};

export const buildPlayerPanelEmbed = (player: Player): EmbedBuilder => {
  const song = player.getCurrent();

  if (!song) {
    return new EmbedBuilder()
      .setColor(EmbedColor.Idle)
      .setTitle(`${Emoji.Music} Music Player`)
      .setDescription(`${getStatusLine(player)}\n\nUse the **${Emoji.Search} Search** button to queue a song.`);
  }

  const { artist, requestedBy, thumbnailUrl } = song;
  const message = new EmbedBuilder()
    .setColor(player.status === STATUS.PLAYING ? EmbedColor.Brand : EmbedColor.Paused)
    .setTitle(player.status === STATUS.PLAYING ? `${Emoji.Play} Now Playing` : `${Emoji.Pause} Paused`)
    .setDescription(`
      **${getSongTitle(song)}**
      Requested by: <@${requestedBy}>\n
      ${getStatusLine(player)}
    `)
    .setFooter({ text: `Source: ${artist}` });

  applySpeakingIndicator(message, player, true);

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};
