import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import {
  type AudioPlayer,
  type AudioPlayerState,
  AudioPlayerStatus,
  type AudioResource,
  createAudioPlayer,
  createAudioResource,
  type DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  StreamType,
  type VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import type { VoiceChannel } from 'discord.js';
import type { SettingRow } from '../db/types.js';
import { buildPlayingMessageEmbed } from '../utils/buildEmbed.js';
import debug from '../utils/debug.js';
import { getGuildSettings } from '../utils/getGuildSettings.js';
import { getYouTubeMediaSource, YtDlpMediaUnavailableError } from '../utils/ytDlp.js';
import { FfmpegMediaUnavailableError, FfmpegStartupError } from './ffmpegProcess.js';
import type FileCacheProvider from './fileCache.js';
import type { PlaybackAttemptToken } from './playbackAttempt.js';
import { type PlaybackAttemptContext, PlaybackAttemptTracker } from './playbackAttempt.js';
import {
  type AgeRestrictedFallbackResolver,
  DEFAULT_VOLUME,
  MediaSource,
  type PlayerEventName,
  type PlayerEvents,
  type QueuedPlaylist,
  type QueuedSong,
  type SongMetadata,
  STATUS,
} from './playerTypes.js';
import Queue from './queue.js';
import { destroyVoiceConnection, recoverVoiceConnection } from './voiceConnectionRecovery.js';

export type { AgeRestrictedFallbackResolver, PlayerEvents, QueuedPlaylist, QueuedSong, SongMetadata };
export { DEFAULT_VOLUME, FfmpegMediaUnavailableError, FfmpegStartupError, MediaSource, STATUS };

type PlayerPlaybackAttemptContext = PlaybackAttemptContext<QueuedSong, VoiceConnection>;

const sha256 = (input: string): string => {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(input);
  return hasher.digest('hex');
};

const getMediaIdentifierForLog = (song: QueuedSong) =>
  song.source === MediaSource.Youtube && /^[\w-]{11}$/.test(song.url)
    ? `youtube=${song.url}`
    : `sourceHash=${sha256(song.url).slice(0, 16)}`;

export default class extends EventEmitter {
  public voiceConnection: VoiceConnection | null = null;
  public status = STATUS.PAUSED;
  public guildId: string;
  public loopCurrentSong = false;
  public loopCurrentQueue = false;
  private currentChannel: VoiceChannel | undefined;
  private readonly queue = new Queue();
  private audioPlayer: AudioPlayer | null = null;
  private audioResource: AudioResource | null = null;
  private volume?: number;
  private defaultVolume: number = DEFAULT_VOLUME;
  private nowPlaying: QueuedSong | null = null;
  private nowPlayingQueueEntryVersion: number | null = null;
  private readonly playbackAttempts: PlaybackAttemptTracker<QueuedSong, VoiceConnection>;
  private readonly programmaticallyStoppedAudioPlayers = new WeakSet<AudioPlayer>();

  private positionInSeconds = 0;
  private positionStartedAt = 0;
  private positionBase = 0;
  private readonly fileCache: FileCacheProvider;
  private readonly ageRestrictedFallbackResolver?: AgeRestrictedFallbackResolver;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly channelToSpeakingUsers: Map<string, Set<string>> = new Map();
  private volumeBeforeVoiceActivity?: number;
  private voiceActivityVolumeTarget?: number;
  private voiceActivitySessionGeneration = 0;
  private hasRegisteredVoiceActivityListener = false;

  constructor(
    fileCache: FileCacheProvider,
    guildId: string,
    ageRestrictedFallbackResolver?: AgeRestrictedFallbackResolver,
  ) {
    super();
    this.fileCache = fileCache;
    this.guildId = guildId;
    this.ageRestrictedFallbackResolver = ageRestrictedFallbackResolver;
    this.playbackAttempts = new PlaybackAttemptTracker(() => ({
      currentSong: this.getCurrent(),
      queueEntryVersion: this.getCurrentQueueEntryId(),
      currentConnection: this.voiceConnection,
    }));
  }

  async connect(channel: VoiceChannel): Promise<void> {
    if (this.voiceConnection) {
      this.disconnect();
    }

    const settings = await getGuildSettings(this.guildId);
    const { defaultVolume = DEFAULT_VOLUME, turnDownVolumeWhenPeopleSpeak } = settings;
    this.defaultVolume = defaultVolume;

    const voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: !turnDownVolumeWhenPeopleSpeak,
      adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
    });

    this.voiceConnection = voiceConnection;
    this.currentChannel = channel;
    this.hasRegisteredVoiceActivityListener = false;

    voiceConnection.on('error', (error) => {
      console.error(`Voice connection error for guild ${this.guildId}:`, error);
    });

    const guildSettings = await getGuildSettings(this.guildId);
    const stateTransitions = [voiceConnection.state.status];
    voiceConnection.on('stateChange', (oldState, newState) => {
      stateTransitions.push(newState.status);
      if (stateTransitions.length > 10) {
        stateTransitions.shift();
      }

      debug(`Voice connection state changed: ${oldState.status} -> ${newState.status}`);

      if (
        this.voiceConnection === voiceConnection &&
        newState.status === VoiceConnectionStatus.Ready &&
        !this.hasRegisteredVoiceActivityListener
      ) {
        this.registerVoiceActivityListener(guildSettings);
        this.hasRegisteredVoiceActivityListener = true;
      }
    });

    voiceConnection.on(
      VoiceConnectionStatus.Disconnected,
      this.onVoiceConnectionDisconnect.bind(this, voiceConnection),
    );

    try {
      await this.waitForVoiceConnectionReady(voiceConnection);
      this.emit('connect' as PlayerEventName);
    } catch {
      const { status } = voiceConnection.state;
      destroyVoiceConnection(voiceConnection);

      if (this.voiceConnection === voiceConnection) {
        this.voiceConnection = null;
      }

      throw new Error(
        `Failed to connect to the voice channel (last state: ${status}, rejoin attempts: ${voiceConnection.rejoinAttempts}, recent states: ${stateTransitions.join(' -> ')}).`,
      );
    }
  }

  getChannel(): VoiceChannel | undefined {
    return this.currentChannel;
  }

  getSpeakingUserIds(): string[] {
    if (!this.currentChannel) {
      return [];
    }

    return [...(this.channelToSpeakingUsers.get(this.currentChannel.id) ?? [])];
  }

  disconnect(): void {
    this.playbackAttempts.invalidate();
    this.voiceActivitySessionGeneration++;

    if (this.voiceConnection) {
      if (this.status === STATUS.PLAYING) {
        this.pause();
      }

      this.loopCurrentSong = false;
      destroyVoiceConnection(this.voiceConnection);
      this.stopAudioPlayer(true);

      this.voiceConnection = null;
      this.audioPlayer = null;
      this.audioResource = null;
      this.currentChannel = undefined;
      this.channelToSpeakingUsers.clear();
      this.volumeBeforeVoiceActivity = undefined;
      this.voiceActivityVolumeTarget = undefined;
      this.hasRegisteredVoiceActivityListener = false;
      this.emit('disconnect' as PlayerEventName);
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    const attempt = this.playbackAttempts.begin();
    await this.seekWithAttempt(positionSeconds, attempt);
  }

  async forwardSeek(positionSeconds: number): Promise<void> {
    return this.seek(this.getPosition() + positionSeconds);
  }

  getPosition(): number {
    if (this.status === STATUS.PLAYING) {
      return this.positionBase + Math.floor((Date.now() - this.positionStartedAt) / 1000);
    }

    return this.positionInSeconds;
  }

  async play(allowAgeRestrictedFallback = true): Promise<void> {
    const attempt = this.playbackAttempts.begin();
    await this.playWithAttempt(attempt, allowAgeRestrictedFallback);
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      throw new Error('Not currently playing.');
    }

    this.positionInSeconds = this.getPosition();
    this.playbackAttempts.invalidate();
    const oldStatus = this.status;
    this.status = STATUS.PAUSED;

    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    this.emit('statusChange' as PlayerEventName, oldStatus, this.status);
  }

  async forward(skip: number): Promise<void> {
    const originalPosition = this.getPosition();
    this.positionInSeconds = originalPosition;
    const originalSnapshot = this.queue.snapshot();
    this.manualForward(skip);
    const destinationSong = this.getCurrent();
    const destinationEntryVersion = this.getCurrentQueueEntryId();
    let destinationPlayback: PlayerPlaybackAttemptContext | null = null;

    try {
      if (!destinationSong) {
        await this.finishQueue();
      } else if (this.status !== STATUS.PAUSED) {
        const playPromise = this.play();
        const destinationConnection = this.voiceConnection;
        if (destinationConnection && destinationSong && destinationEntryVersion !== null) {
          destinationPlayback = this.playbackAttempts.capture(
            this.playbackAttempts.latest(),
            destinationSong,
            destinationEntryVersion,
            destinationConnection,
          );
        }

        await playPromise;
      }
    } catch (error: unknown) {
      const failedTransitionStillOwnsDestination =
        this.getCurrent() === destinationSong &&
        this.getCurrentQueueEntryId() === destinationEntryVersion &&
        (destinationPlayback === null || this.playbackAttempts.owns(destinationPlayback));
      if (failedTransitionStillOwnsDestination) {
        this.positionInSeconds = originalPosition;
        this.queue.restoreSnapshot(originalSnapshot);
      }

      throw error;
    }
  }

  registerVoiceActivityListener(guildSettings: SettingRow) {
    const { turnDownVolumeWhenPeopleSpeak, turnDownVolumeWhenPeopleSpeakTarget } = guildSettings;
    const { voiceConnection, currentChannel } = this;
    if (!turnDownVolumeWhenPeopleSpeak || !voiceConnection || !currentChannel) {
      return;
    }

    const voiceActivitySessionGeneration = ++this.voiceActivitySessionGeneration;
    const isCurrentVoiceActivitySession = () =>
      voiceActivitySessionGeneration === this.voiceActivitySessionGeneration &&
      voiceConnection === this.voiceConnection &&
      currentChannel === this.currentChannel;

    voiceConnection.receiver.speaking.on('start', (userId: string) => {
      if (!isCurrentVoiceActivitySession()) {
        return;
      }

      const member = currentChannel.members.get(userId);
      const { id: channelId } = currentChannel;

      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.add(member.id);
      }

      this.emit('speakingStart' as PlayerEventName, userId);
      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });

    voiceConnection.receiver.speaking.on('end', (userId: string) => {
      if (!isCurrentVoiceActivitySession()) {
        return;
      }

      this.channelToSpeakingUsers.get(currentChannel.id)?.delete(userId);

      this.emit('speakingEnd' as PlayerEventName, userId);
      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });
  }

  suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget: number): void {
    if (!this.currentChannel) {
      return;
    }

    const speakingUsers = this.channelToSpeakingUsers.get(this.currentChannel.id);
    if (speakingUsers && speakingUsers.size > 0) {
      if (this.volumeBeforeVoiceActivity === undefined) {
        this.volumeBeforeVoiceActivity = this.getVolume();
      }

      this.voiceActivityVolumeTarget = turnDownVolumeWhenPeopleSpeakTarget;
      this.setAudioPlayerVolume(turnDownVolumeWhenPeopleSpeakTarget);
    } else if (this.volumeBeforeVoiceActivity !== undefined) {
      const { volumeBeforeVoiceActivity } = this;
      this.volumeBeforeVoiceActivity = undefined;
      this.voiceActivityVolumeTarget = undefined;
      this.setAudioPlayerVolume(volumeBeforeVoiceActivity);
    }
  }

  canGoForward(skip: number) {
    return this.queue.canGoForward(skip);
  }

  manualForward(skip: number): void {
    const previous = this.getCurrent();
    this.queue.forward(skip);
    this.positionInSeconds = 0;
    this.emit('trackEnd' as PlayerEventName, previous);
    this.emit('queueChange' as PlayerEventName);
  }

  canGoBack() {
    return this.queue.canGoBack();
  }

  async back(): Promise<void> {
    if (!this.canGoBack()) {
      throw new Error('No songs in queue to go back to.');
    }

    const originalPosition = this.getPosition();
    this.positionInSeconds = originalPosition;
    const originalSnapshot = this.queue.snapshot();
    const previousSong = this.getCurrent();
    this.queue.back();
    this.positionInSeconds = 0;
    this.emit('trackEnd' as PlayerEventName, previousSong);
    this.emit('queueChange' as PlayerEventName);
    const destinationSong = this.getCurrent();
    const destinationEntryVersion = this.getCurrentQueueEntryId();
    let destinationPlayback: PlayerPlaybackAttemptContext | null = null;

    try {
      if (this.status !== STATUS.PAUSED) {
        const playPromise = this.play();
        const destinationConnection = this.voiceConnection;
        if (destinationConnection && destinationSong && destinationEntryVersion !== null) {
          destinationPlayback = this.playbackAttempts.capture(
            this.playbackAttempts.latest(),
            destinationSong,
            destinationEntryVersion,
            destinationConnection,
          );
        }

        await playPromise;
      }
    } catch (error: unknown) {
      const failedTransitionStillOwnsDestination =
        this.getCurrent() === destinationSong &&
        this.getCurrentQueueEntryId() === destinationEntryVersion &&
        (destinationPlayback === null || this.playbackAttempts.owns(destinationPlayback));
      if (failedTransitionStillOwnsDestination) {
        this.positionInSeconds = originalPosition;
        this.queue.restoreSnapshot(originalSnapshot);
      }

      throw error;
    }
  }

  getCurrent(): QueuedSong | null {
    return this.queue.getCurrent();
  }

  getCurrentQueueEntryId(): number | null {
    return this.getCurrent() === null ? null : this.queue.getCurrentEntryVersion();
  }

  get currentQueueEntryVersion(): number {
    return this.queue.getCurrentEntryVersion();
  }

  getQueue(): QueuedSong[] {
    return this.queue.getUpcoming();
  }

  setLoopCurrentSong(value: boolean): void {
    this.loopCurrentSong = value;
    if (value) {
      this.loopCurrentQueue = false;
    }
    this.emit('loopChange' as PlayerEventName);
  }

  setLoopCurrentQueue(value: boolean): void {
    this.loopCurrentQueue = value;
    if (value) {
      this.loopCurrentSong = false;
    }
    this.emit('loopChange' as PlayerEventName);
  }

  add(song: QueuedSong, options?: { immediate?: boolean; immediateOffset?: number }): void {
    this.queue.add(song, options);
    this.emit('queueChange' as PlayerEventName);
  }

  shuffle(): void {
    this.queue.shuffle();
    this.emit('queueChange' as PlayerEventName);
  }

  clear(): void {
    this.queue.clear();
    this.emit('queueChange' as PlayerEventName);
  }

  removeFromQueue(index: number, amount = 1): void {
    this.queue.removeFromQueue(index, amount);
    this.emit('queueChange' as PlayerEventName);
  }

  removeCurrent(): void {
    this.queue.removeCurrent();
    this.emit('queueChange' as PlayerEventName);
  }

  queueSize(): number {
    return this.queue.getSize();
  }

  isQueueEmpty(): boolean {
    return this.queue.isEmpty();
  }

  stop(): void {
    this.disconnect();
    this.queue.reset();
  }

  move(from: number, to: number): QueuedSong {
    const moved = this.queue.move(from, to);
    this.emit('queueChange' as PlayerEventName);
    return moved;
  }

  setVolume(level: number): void {
    this.volume = level;

    if (this.volumeBeforeVoiceActivity === undefined) {
      this.setAudioPlayerVolume(level);
    } else {
      this.volumeBeforeVoiceActivity = level;
      this.setAudioPlayerVolume(this.voiceActivityVolumeTarget);
    }

    this.emit('volumeChange' as PlayerEventName, this.getVolume());
  }

  getVolume(): number {
    return this.voiceActivityVolumeTarget ?? this.volume ?? this.defaultVolume;
  }

  private async seekWithAttempt(positionSeconds: number, attempt: PlaybackAttemptToken): Promise<void> {
    const previousPosition = this.getPosition();
    this.positionInSeconds = previousPosition;
    const statusBeforeSeek = this.status;
    this.status = STATUS.PAUSED;

    const currentSong = this.getCurrent();
    const currentQueueEntryVersion = this.getCurrentQueueEntryId();
    const voiceConnection = await this.ensureVoiceConnectionReady();

    if (!this.playbackAttempts.isCurrent(attempt, voiceConnection)) {
      return;
    }

    if (!currentSong) {
      throw new Error('No song currently playing');
    }

    if (currentQueueEntryVersion === null) {
      return;
    }

    const playback = this.playbackAttempts.capture(attempt, currentSong, currentQueueEntryVersion, voiceConnection);
    if (!this.playbackAttempts.owns(playback)) {
      return;
    }

    if (positionSeconds > currentSong.length) {
      throw new Error('Seek position is outside the range of the song.');
    }

    let realPositionSeconds = positionSeconds;
    let to: number | undefined;
    if (currentSong.offset !== undefined) {
      realPositionSeconds += currentSong.offset;
      to = currentSong.length + currentSong.offset;
    }

    let stream: Readable;
    try {
      stream = await this.getStream(currentSong, { seek: realPositionSeconds, to });
    } catch (error: unknown) {
      if (this.playbackAttempts.owns(playback)) {
        this.positionInSeconds = previousPosition;
        this.audioPlayer = null;
        this.audioResource = null;
      }

      await this.handlePlaybackError(error, playback, true);
      return;
    }

    if (!this.playbackAttempts.owns(playback)) {
      this.destroyStaleStream(stream);
      return;
    }

    this.audioPlayer = createAudioPlayer({
      behaviors: {
        maxMissedFrames: 50,
      },
    });
    voiceConnection.subscribe(this.audioPlayer);
    this.playAudioPlayerResource(this.createAudioStream(stream));
    this.attachListeners();

    this.positionBase = positionSeconds;
    this.positionStartedAt = Date.now();
    this.status = STATUS.PLAYING;
    this.nowPlaying = currentSong;
    this.nowPlayingQueueEntryVersion = currentQueueEntryVersion;
    if (statusBeforeSeek !== STATUS.PLAYING) {
      this.emit('statusChange' as PlayerEventName, STATUS.PAUSED, this.status);
    }
    this.emit('trackStart' as PlayerEventName, currentSong);
  }

  private async playWithAttempt(attempt: PlaybackAttemptToken, allowAgeRestrictedFallback: boolean): Promise<void> {
    const currentSong = this.getCurrent();
    const currentQueueEntryVersion = this.getCurrentQueueEntryId();
    const voiceConnection = await this.ensureVoiceConnectionReady();

    if (!this.playbackAttempts.isCurrent(attempt, voiceConnection)) {
      return;
    }

    if (!currentSong) {
      throw new Error('Queue empty.');
    }

    if (currentQueueEntryVersion === null) {
      return;
    }

    const playback = this.playbackAttempts.capture(attempt, currentSong, currentQueueEntryVersion, voiceConnection);
    if (!this.playbackAttempts.owns(playback)) {
      return;
    }

    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    if (
      this.status === STATUS.PAUSED &&
      currentSong === this.nowPlaying &&
      this.getCurrentQueueEntryId() === this.nowPlayingQueueEntryVersion
    ) {
      if (this.audioPlayer) {
        this.audioPlayer.unpause();
        this.positionBase = this.positionInSeconds;
        this.positionStartedAt = Date.now();
        this.status = STATUS.PLAYING;
        this.emit('statusChange' as PlayerEventName, STATUS.PAUSED, this.status);
        this.emit('trackStart' as PlayerEventName, currentSong);
        return;
      }

      if (!currentSong.isLive) {
        return this.seekWithAttempt(this.getPosition(), attempt);
      }
    }

    const previousPosition = this.getPosition();
    this.positionInSeconds = previousPosition;
    try {
      let positionSeconds: number | undefined;
      let to: number | undefined;
      if (currentSong.offset !== undefined) {
        positionSeconds = currentSong.offset;
        to = currentSong.length + currentSong.offset;
      }

      const stream = await this.getStream(currentSong, { seek: positionSeconds, to });
      if (!this.playbackAttempts.owns(playback)) {
        this.destroyStaleStream(stream);
        return;
      }

      this.audioPlayer = createAudioPlayer({
        behaviors: {
          maxMissedFrames: 50,
        },
      });
      voiceConnection.subscribe(this.audioPlayer);
      this.playAudioPlayerResource(this.createAudioStream(stream));

      this.attachListeners();

      this.positionBase = 0;
      this.positionStartedAt = Date.now();
      const oldPlayStatus = this.status;
      this.status = STATUS.PLAYING;
      this.nowPlaying = currentSong;
      this.nowPlayingQueueEntryVersion = currentQueueEntryVersion;
      if (oldPlayStatus !== STATUS.PLAYING) {
        this.emit('statusChange' as PlayerEventName, oldPlayStatus, this.status);
      }
      this.emit('trackStart' as PlayerEventName, currentSong);
    } catch (error: unknown) {
      if (this.playbackAttempts.owns(playback)) {
        this.positionInSeconds = previousPosition;
        this.status = STATUS.PAUSED;
        this.audioPlayer = null;
        this.audioResource = null;
      }

      await this.handlePlaybackError(error, playback, allowAgeRestrictedFallback);
    }
  }

  private async handlePlaybackError(
    error: unknown,
    playback: PlayerPlaybackAttemptContext,
    allowAgeRestrictedFallback: boolean,
  ): Promise<void> {
    if (!this.playbackAttempts.owns(playback)) {
      throw error;
    }

    const isGone = typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 410;

    if (
      error instanceof YtDlpMediaUnavailableError &&
      error.reason === 'age-restricted' &&
      allowAgeRestrictedFallback
    ) {
      const fallbackHandled = await this.tryAgeRestrictedAudioFallback(playback);
      if (fallbackHandled) {
        return;
      }

      if (!this.playbackAttempts.owns(playback)) {
        throw error;
      }
    }

    if (error instanceof YtDlpMediaUnavailableError || error instanceof FfmpegMediaUnavailableError || isGone) {
      const detail = error instanceof Error ? error.message : 'media returned HTTP 410';
      console.warn(
        `Skipping unplayable track for guild ${this.guildId} (${getMediaIdentifierForLog(playback.song)}): ${detail}`,
      );
      await this.advancePastUnplayableTrack();
      return;
    }

    throw error;
  }

  private async getStream(song: QueuedSong, options: { seek?: number; to?: number } = {}): Promise<Readable> {
    if (this.status === STATUS.PLAYING) {
      this.stopAudioPlayer();
    } else if (this.status === STATUS.PAUSED) {
      this.stopAudioPlayer(true);
    }

    if (song.source === MediaSource.HLS) {
      return this.createReadStream({ url: song.url, cacheKey: song.url });
    }

    let ffmpegInput: string | null;
    const ffmpegInputOptions: string[] = [];
    let shouldCacheVideo = false;
    let usingNetworkStream = false;
    let mediaHeaders: Record<string, string> | undefined;

    const cacheHash = this.getHashForCache(song.url);
    const cachedEntry = await this.fileCache.getEntryFor(cacheHash);
    ffmpegInput = cachedEntry?.path ?? null;

    if (!ffmpegInput) {
      const mediaSource = await getYouTubeMediaSource(song.url);
      ffmpegInput = mediaSource.url;
      usingNetworkStream = true;
      mediaHeaders = mediaSource.headers;

      const MAX_CACHE_LENGTH_SECONDS = 30 * 60;
      shouldCacheVideo = !mediaSource.isLive && song.length < MAX_CACHE_LENGTH_SECONDS && !options.seek;

      debug(shouldCacheVideo ? 'Caching video' : 'Not caching video');
    }

    if (options.seek) {
      ffmpegInputOptions.push('-ss', options.seek.toString());
    }

    if (options.to) {
      ffmpegInputOptions.push('-to', options.to.toString());
    }

    try {
      return await this.createReadStream({
        url: ffmpegInput,
        cacheKey: song.url,
        ffmpegInputOptions,
        cache: shouldCacheVideo,
        networkStream: usingNetworkStream,
        headers: mediaHeaders,
      });
    } catch (error: unknown) {
      if (cachedEntry && error instanceof FfmpegMediaUnavailableError && error.reason === 'invalid-output') {
        await this.fileCache.invalidate(cacheHash, cachedEntry.generation);
        return this.getStream(song, options);
      }

      throw error;
    }
  }

  private attachListeners(): void {
    if (!this.voiceConnection) {
      return;
    }

    if (!this.audioPlayer) {
      return;
    }

    const { audioPlayer } = this;
    const queueEntryVersion = this.getCurrentQueueEntryId();
    if (audioPlayer.listeners(AudioPlayerStatus.Idle).length === 0) {
      audioPlayer.on(AudioPlayerStatus.Idle, (oldState, newState) => {
        if (
          this.programmaticallyStoppedAudioPlayers.has(audioPlayer) ||
          this.audioPlayer !== audioPlayer ||
          this.getCurrentQueueEntryId() !== queueEntryVersion
        ) {
          return;
        }

        void this.onAudioPlayerIdle(oldState, newState).catch((error) => {
          console.error(`Audio player idle handler failed for guild ${this.guildId}:`, error);
        });
      });
    }
  }

  private async onVoiceConnectionDisconnect(voiceConnection: VoiceConnection): Promise<void> {
    await recoverVoiceConnection(voiceConnection, {
      isCurrent: (candidate) => this.voiceConnection === candidate,
      dispose: (candidate) => {
        if (this.voiceConnection === candidate) {
          this.disconnect();
        } else {
          destroyVoiceConnection(candidate);
        }
      },
    });
  }

  private async ensureVoiceConnectionReady(): Promise<VoiceConnection> {
    if (this.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    await this.waitForVoiceConnectionReady(this.voiceConnection);

    return this.voiceConnection;
  }

  private async waitForVoiceConnectionReady(voiceConnection: VoiceConnection): Promise<void> {
    await entersState(voiceConnection, VoiceConnectionStatus.Ready, 60_000);
  }

  private async advancePastUnplayableTrack(): Promise<void> {
    this.manualForward(1);

    if (!this.getCurrent()) {
      await this.finishQueue();
      return;
    }

    await this.play();
  }

  private async tryAgeRestrictedAudioFallback(playback: PlayerPlaybackAttemptContext): Promise<boolean> {
    const { song, queueEntryVersion, attempt, connection } = playback;
    if (!this.ageRestrictedFallbackResolver || song.source !== MediaSource.Youtube) {
      return false;
    }

    if (!this.playbackAttempts.owns(playback)) {
      return true;
    }

    let fallback: SongMetadata | null;
    try {
      fallback = await this.ageRestrictedFallbackResolver(song);
    } catch {
      if (!this.playbackAttempts.owns(playback)) {
        return true;
      }

      console.warn(`Audio fallback search failed for age-restricted track in guild ${this.guildId}.`);
      return false;
    }

    if (!this.playbackAttempts.owns(playback)) {
      return true;
    }

    if (!fallback || fallback.source !== MediaSource.Youtube || fallback.url === song.url) {
      return false;
    }

    const currentQueueIndex = this.queue.getPosition();
    const replacement: QueuedSong = {
      ...fallback,
      playlist: song.playlist,
      addedInChannelId: song.addedInChannelId,
      requestedBy: song.requestedBy,
    };
    this.queue.replaceSong(currentQueueIndex, replacement);
    const replacementPlayback = this.playbackAttempts.capture(attempt, replacement, queueEntryVersion, connection);
    console.warn(
      `Trying audio fallback for age-restricted YouTube track in guild ${this.guildId}: ${song.url} -> ${replacement.url}`,
    );

    try {
      await this.playWithAttempt(attempt, false);
      return true;
    } catch (error: unknown) {
      if (this.playbackAttempts.owns(replacementPlayback) && this.queue.getSongAt(currentQueueIndex) === replacement) {
        this.queue.replaceSong(currentQueueIndex, song);
      }

      throw error;
    }
  }

  private async onAudioPlayerIdle(_oldState: AudioPlayerState, newState: AudioPlayerState): Promise<void> {
    if (this.loopCurrentSong && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      await this.seek(0);
      return;
    }

    if (this.loopCurrentQueue && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      const currentSong = this.getCurrent();

      if (currentSong) {
        this.add(currentSong);
      } else {
        throw new Error('No song currently playing.');
      }
    }

    if (newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      if (!this.canGoForward(1)) {
        await this.finishQueue();
        return;
      }

      await this.forward(1);
      const currentSong = this.getCurrent();
      if (!currentSong) {
        return;
      }

      const settings = await getGuildSettings(this.guildId);
      const { autoAnnounceNextSong } = settings;
      if (autoAnnounceNextSong && this.currentChannel) {
        await this.currentChannel.send({
          embeds: [buildPlayingMessageEmbed(this)],
        });
      }
    }
  }

  private async finishQueue(): Promise<void> {
    this.playbackAttempts.invalidate();
    this.positionInSeconds = 0;
    const wasPlaying = this.status === STATUS.PLAYING;
    const wasPaused = this.status === STATUS.PAUSED;
    this.status = STATUS.IDLE;
    this.stopAudioPlayer(true);

    if (wasPlaying || wasPaused) {
      this.emit('statusChange' as PlayerEventName, wasPlaying ? STATUS.PLAYING : STATUS.PAUSED, this.status);
    }
    this.emit('trackEnd' as PlayerEventName, null);

    const settings = await getGuildSettings(this.guildId);

    const { secondsToWaitAfterQueueEmpties } = settings;
    if (secondsToWaitAfterQueueEmpties !== 0) {
      this.disconnectTimer = setTimeout(() => {
        if (this.status === STATUS.IDLE) {
          this.disconnect();
        }
      }, secondsToWaitAfterQueueEmpties * 1000);
    }
  }

  private getHashForCache(url: string): string {
    return sha256(url);
  }

  private async createReadStream(options: {
    url: string;
    cacheKey: string;
    ffmpegInputOptions?: string[];
    cache?: boolean;
    networkStream?: boolean;
    headers?: Record<string, string>;
  }): Promise<Readable> {
    const { createReadStream: spawnFfmpegReadStream } = await import('./ffmpegProcess.js');

    return spawnFfmpegReadStream({
      url: options.url,
      inputOptions: options.ffmpegInputOptions ?? ['-re'],
      cacheKey: options.cacheKey,
      cache: options.cache,
      fileCache: this.fileCache,
      hashFn: (input) => sha256(input),
      networkStream: options.networkStream,
      headers: options.headers,
    });
  }

  private createAudioStream(stream: Readable) {
    return createAudioResource(stream, {
      inputType: StreamType.WebmOpus,
      inlineVolume: true,
    });
  }

  private playAudioPlayerResource(resource: AudioResource) {
    if (this.audioPlayer !== null) {
      this.audioResource = resource;
      this.setAudioPlayerVolume();
      this.audioPlayer.play(this.audioResource);
    }
  }

  private setAudioPlayerVolume(level?: number) {
    this.audioResource?.volume?.setVolume((level ?? this.getVolume()) / 100);
  }

  private stopAudioPlayer(force = false): void {
    if (!this.audioPlayer) {
      return;
    }

    this.programmaticallyStoppedAudioPlayers.add(this.audioPlayer);
    this.audioPlayer.stop(force);
  }

  private destroyStaleStream(stream: Readable): void {
    if (!stream.destroyed) {
      stream.destroy();
    }
  }
}
