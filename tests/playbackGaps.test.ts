import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn, vi } from 'bun:test';
import { existsSync, promises as fs, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const dependencyMocks = {
  buildPlayingMessageEmbed: vi.fn(() => ({ title: 'playing' })),
  createAudioPlayer: vi.fn(),
  createAudioResource: vi.fn(),
  entersState: vi.fn(),
  fetch: vi.fn(),
  getGuildSettings: vi.fn(),
  getMemberVoiceChannel: vi.fn(),
  getMostPopularVoiceChannel: vi.fn(),
  joinVoiceChannel: vi.fn(),
  shuffle: vi.fn((items: unknown[]) => items),
  spawnSync: vi.fn(),
};

mock.module('../src/utils/arrays.js', () => ({
  chunk: (arr: unknown[]) => arr,
  shuffle: dependencyMocks.shuffle,
}));

mock.module('@discordjs/voice', () => ({
  AudioPlayerStatus: { Idle: 'idle' },
  VoiceConnectionDisconnectReason: { WebSocketClose: 'websocket-close' },
  VoiceConnectionStatus: {
    Connecting: 'connecting',
    Disconnected: 'disconnected',
    Ready: 'ready',
    Signalling: 'signalling',
  },
  StreamType: { WebmOpus: 'webm-opus' },
  createAudioPlayer: dependencyMocks.createAudioPlayer,
  createAudioResource: dependencyMocks.createAudioResource,
  entersState: dependencyMocks.entersState,
  joinVoiceChannel: dependencyMocks.joinVoiceChannel,
}));

mock.module('../src/services/fileCache.js', () => ({
  default: class {},
}));

mock.module('../src/utils/buildEmbed.js', () => ({
  buildPlayingMessageEmbed: dependencyMocks.buildPlayingMessageEmbed,
}));

mock.module('../src/utils/getGuildSettings.js', () => ({
  getGuildSettings: dependencyMocks.getGuildSettings,
}));

mock.module('../src/utils/channels.js', () => ({
  getMemberVoiceChannel: dependencyMocks.getMemberVoiceChannel,
  getMostPopularVoiceChannel: dependencyMocks.getMostPopularVoiceChannel,
}));

import Play from '../src/commands/play.js';
import AddQueryToQueue from '../src/services/addQueryToQueue.js';
import Player, {
  FfmpegMediaUnavailableError,
  MediaSource,
  type QueuedSong,
  type SongMetadata,
  STATUS,
} from '../src/services/player.js';
import { getYouTubeMediaSource, YtDlpMediaUnavailableError } from '../src/utils/ytDlp.js';

const GUILD_ID = 'guild-id';
const ORIGINAL_YT_DLP_COOKIES_PATH = process.env.YT_DLP_COOKIES_PATH;
const ORIGINAL_YT_DLP_PATH = process.env.YT_DLP_PATH;
const ORIGINAL_FETCH = globalThis.fetch;
const VALID_MEDIA_RESPONSE = JSON.stringify({
  url: 'https://media.example/audio.webm',
  http_headers: { 'User-Agent': 'Fourier test' },
  is_live: false,
});

interface FakeSpawnResult {
  success?: boolean;
  stdout?: Uint8Array;
  stderr?: Uint8Array;
  exitCode?: number;
}

const makeSpawnProc = (result: FakeSpawnResult) => ({
  stdout: new Response(result.stdout ?? new Uint8Array()).body as ReadableStream<Uint8Array>,
  stderr: new Response(result.stderr ?? new Uint8Array()).body as ReadableStream<Uint8Array>,
  exited: Promise.resolve(result.success === false ? (result.exitCode ?? 1) : 0),
  kill: vi.fn(),
});

type FakeAudioPlayer = ReturnType<typeof makeAudioPlayer>;

const makeAudioPlayer = () => {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const audioPlayer = {
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    listeners: vi.fn((event: string) => handlers.get(event) ?? []),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return audioPlayer;
    }),
    pause: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    unpause: vi.fn(),
  };

  return audioPlayer;
};

const makeVoiceConnection = () => ({
  destroy: vi.fn(),
  on: vi.fn(),
  receiver: { speaking: { on: vi.fn() } },
  rejoin: vi.fn(),
  rejoinAttempts: 0,
  state: { status: 'ready' },
  subscribe: vi.fn(),
});

const makeReadyPlayer = () => {
  const player = new Player({} as never, GUILD_ID);
  const voiceConnection = makeVoiceConnection();
  const getStream = vi.fn().mockResolvedValue(Readable.from([]));
  player.voiceConnection = voiceConnection as never;
  Object.assign(player, { getStream });

  return { getStream, player, voiceConnection };
};

const makeProductionStreamPlayer = () => {
  const fileCache = {
    getEntryFor: vi.fn().mockResolvedValue({ generation: 'cached-generation', path: '/cached/audio.webm' }),
  };
  const player = new Player(fileCache as never, GUILD_ID);
  const voiceConnection = makeVoiceConnection();
  const createReadStream = vi.fn().mockResolvedValue(Readable.from([]));
  player.voiceConnection = voiceConnection as never;
  Object.assign(player, { createReadStream });

  return { createReadStream, player, voiceConnection };
};

const makeDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

const flushAsyncWork = async () => {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
  }
};

const getPrivatePlayer = (player: Player) =>
  player as unknown as {
    audioPlayer: FakeAudioPlayer | null;
    onAudioPlayerIdle(oldState: object, newState: { status: string }): Promise<void>;
  };

const makeSong = (title: string, overrides: Partial<SongMetadata> = {}): SongMetadata => ({
  title,
  artist: 'Artist',
  url: title.toLowerCase().replaceAll(' ', '-'),
  length: 100,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: MediaSource.Youtube,
  ...overrides,
});

const makeQueuedSong = (title: string): QueuedSong => ({
  ...makeSong(title),
  addedInChannelId: 'text-channel-id',
  requestedBy: 'requester-id',
});

const makeAutocompleteHarness = (query: string, spotify?: object) => {
  const cache = {
    wrap: vi.fn(async (operation: (...args: unknown[]) => Promise<unknown>, ...args: unknown[]) =>
      operation(...args.slice(0, -1)),
    ),
  };
  const interaction = {
    options: { getString: vi.fn(() => query) },
    respond: vi.fn().mockResolvedValue(undefined),
  };
  const command = new Play(spotify ? ({ spotify } as never) : (undefined as never), cache as never, {} as never);

  return { cache, command, interaction };
};

const makeQueueInteraction = () => ({
  guild: { id: GUILD_ID },
  member: { user: { id: 'requester-id' } },
  channel: { id: 'text-channel-id' },
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.YT_DLP_COOKIES_PATH;
  process.env.YT_DLP_PATH = '/fake/yt-dlp';
  dependencyMocks.shuffle.mockImplementation((items: unknown[]) => items);
  dependencyMocks.createAudioPlayer.mockImplementation(makeAudioPlayer);
  dependencyMocks.createAudioResource.mockImplementation((sourceStream: Readable) => ({
    sourceStream,
    volume: { setVolume: vi.fn() },
  }));
  dependencyMocks.entersState.mockResolvedValue(undefined);
  dependencyMocks.spawnSync.mockReturnValue({
    success: true,
    stdout: new TextEncoder().encode(VALID_MEDIA_RESPONSE),
  });
  dependencyMocks.getGuildSettings.mockResolvedValue({
    playlistLimit: 50,
    queueAddResponseEphemeral: false,
    secondsToWaitAfterQueueEmpties: 0,
  });
  dependencyMocks.getMemberVoiceChannel.mockReturnValue([{ id: 'voice-channel-id' }]);
  dependencyMocks.getMostPopularVoiceChannel.mockReturnValue([{ id: 'fallback-channel-id' }]);
  spyOn(Bun, 'spawn').mockImplementation(((cmdAndArgs: string[], options: unknown) =>
    makeSpawnProc(dependencyMocks.spawnSync(cmdAndArgs, options))) as never);
  globalThis.fetch = dependencyMocks.fetch as never;
});

afterEach(() => {
  if (ORIGINAL_YT_DLP_COOKIES_PATH === undefined) {
    delete process.env.YT_DLP_COOKIES_PATH;
  } else {
    process.env.YT_DLP_COOKIES_PATH = ORIGINAL_YT_DLP_COOKIES_PATH;
  }

  if (ORIGINAL_YT_DLP_PATH === undefined) {
    delete process.env.YT_DLP_PATH;
  } else {
    process.env.YT_DLP_PATH = ORIGINAL_YT_DLP_PATH;
  }

  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('PLAY-06 autocomplete preservation', () => {
  it.each([
    ['', 'blank input'],
    ['   ', 'whitespace input'],
    ['https://www.youtube.com/watch?v=abcdefghijk', 'HTTP URL'],
    ['spotify:track:track-id', 'Spotify URL'],
  ])('returns no suggestions for %s (%s)', async (query) => {
    const { cache, command, interaction } = makeAutocompleteHarness(query);

    await command.handleAutocompleteInteraction(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith([]);
    expect(cache.wrap).not.toHaveBeenCalled();
    expect(dependencyMocks.fetch).not.toHaveBeenCalled();
  });

  it('treats unsupported custom schemes as free-text autocomplete queries', async () => {
    dependencyMocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ['Queen:Bohemian Rhapsody', ['Bohemian Rhapsody Queen']],
    });
    const { cache, command, interaction } = makeAutocompleteHarness('  Queen:Bohemian Rhapsody  ');

    await command.handleAutocompleteInteraction(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: '▶️ Bohemian Rhapsody Queen', value: 'Bohemian Rhapsody Queen' },
    ]);
    expect(cache.wrap).toHaveBeenCalledWith(expect.any(Function), 'Queen:Bohemian Rhapsody', undefined, 10, {
      expiresIn: 3600,
      key: 'autocomplete:Queen:Bohemian Rhapsody',
    });
  });

  it('deduplicates Spotify albums before allocating slots so available tracks fill the ten-result cap', async () => {
    dependencyMocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ['mix', Array.from({ length: 10 }, (_, index) => `YouTube ${index + 1}`)],
    });
    const album = (id: string) => ({ id, name: 'Duplicate Album', artists: [{ name: 'Album Artist' }] });
    const track = (index: number) => ({
      id: `track-${index}`,
      name: `Track ${index}`,
      artists: [{ name: `Track Artist ${index}` }],
    });
    const spotify = {
      search: vi.fn().mockResolvedValue({
        body: {
          albums: { items: [album('album-1'), album('album-duplicate')] },
          tracks: { items: [track(1), { ...track(1), id: 'duplicate-track-id' }, track(2), track(3), track(4)] },
        },
      }),
    };
    const { command, interaction } = makeAutocompleteHarness('mix', spotify);

    await command.handleAutocompleteInteraction(interaction as never);

    const choices = interaction.respond.mock.calls[0][0] as Array<{ name: string; value: string }>;
    expect(choices).toHaveLength(10);
    expect(choices.filter((choice) => choice.value.startsWith('spotify:album:'))).toHaveLength(1);
    expect(choices.filter((choice) => choice.value.startsWith('spotify:track:'))).toHaveLength(4);
    expect(new Set(choices.map((choice) => choice.name)).size).toBe(10);
  });

  it('fills the Spotify half from unique albums when no tracks are available', async () => {
    dependencyMocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ['albums', Array.from({ length: 10 }, (_, index) => `YouTube ${index + 1}`)],
    });
    const albums = Array.from({ length: 5 }, (_, index) => ({
      id: `album-${index + 1}`,
      name: `Album ${index + 1}`,
      artists: [{ name: `Album Artist ${index + 1}` }],
    }));
    const spotify = {
      search: vi.fn().mockResolvedValue({
        body: {
          albums: { items: [...albums, { ...albums[0], id: 'duplicate-album-id' }] },
          tracks: { items: [] },
        },
      }),
    };
    const { command, interaction } = makeAutocompleteHarness('albums', spotify);

    await command.handleAutocompleteInteraction(interaction as never);

    const choices = interaction.respond.mock.calls[0][0] as Array<{ name: string; value: string }>;
    expect(choices).toHaveLength(10);
    expect(choices.filter((choice) => choice.value.startsWith('spotify:album:'))).toHaveLength(5);
    expect(choices.filter((choice) => choice.value.startsWith('spotify:track:'))).toHaveLength(0);
    expect(choices.filter((choice) => choice.name.startsWith('▶️'))).toHaveLength(5);
    expect(new Set(choices.map((choice) => choice.name)).size).toBe(10);
  });

  it('backfills a track-short mixed distribution with remaining unique albums', async () => {
    dependencyMocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ['mixed', Array.from({ length: 10 }, (_, index) => `YouTube ${index + 1}`)],
    });
    const albums = Array.from({ length: 3 }, (_, index) => ({
      id: `album-${index + 1}`,
      name: `Album ${index + 1}`,
      artists: [{ name: `Album Artist ${index + 1}` }],
    }));
    const tracks = Array.from({ length: 2 }, (_, index) => ({
      id: `track-${index + 1}`,
      name: `Track ${index + 1}`,
      artists: [{ name: `Track Artist ${index + 1}` }],
    }));
    const spotify = {
      search: vi.fn().mockResolvedValue({
        body: {
          albums: { items: [...albums, { ...albums[0], id: 'duplicate-album-id' }] },
          tracks: { items: [...tracks, { ...tracks[0], id: 'duplicate-track-id' }] },
        },
      }),
    };
    const { command, interaction } = makeAutocompleteHarness('mixed', spotify);

    await command.handleAutocompleteInteraction(interaction as never);

    const choices = interaction.respond.mock.calls[0][0] as Array<{ name: string; value: string }>;
    expect(choices).toHaveLength(10);
    expect(choices.filter((choice) => choice.value.startsWith('spotify:album:'))).toHaveLength(3);
    expect(choices.filter((choice) => choice.value.startsWith('spotify:track:'))).toHaveLength(2);
    expect(choices.filter((choice) => choice.name.startsWith('▶️'))).toHaveLength(5);
    expect(new Set(choices.map((choice) => choice.name)).size).toBe(10);
  });

  it('degrades to the capped YouTube-only result set when Spotify autocomplete fails', async () => {
    dependencyMocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ['mix', Array.from({ length: 12 }, (_, index) => `YouTube ${index + 1}`)],
    });
    const spotifyError = new Error('Spotify unavailable');
    const spotify = { search: vi.fn().mockRejectedValue(spotifyError) };
    const { command, interaction } = makeAutocompleteHarness('mix', spotify);

    await command.handleAutocompleteInteraction(interaction as never);

    const choices = interaction.respond.mock.calls[0][0] as Array<{ name: string; value: string }>;
    expect(choices).toHaveLength(10);
    expect(choices).toEqual(
      Array.from({ length: 10 }, (_, index) => ({
        name: `▶️ YouTube ${index + 1}`,
        value: `YouTube ${index + 1}`,
      })),
    );
    expect(spotify.search).toHaveBeenCalledWith('mix', ['album', 'track'], { limit: 10 });
  });
});

describe('PLAY-09 shuffled additions preservation', () => {
  it('shuffles only the resolved batch while existing history, current entry, and upcoming queue stay unchanged', async () => {
    const player = new Player({} as never, GUILD_ID);
    player.add(makeQueuedSong('History'));
    player.add(makeQueuedSong('Current'));
    player.add(makeQueuedSong('Existing upcoming'));
    player.manualForward(1);
    player.voiceConnection = {} as never;
    player.status = STATUS.PLAYING;
    const resolvedSongs = [makeSong('New one'), makeSong('New two'), makeSong('New three')];
    const getSongs = { getSongs: vi.fn().mockResolvedValue([resolvedSongs, '']) };
    const playerManager = { get: vi.fn(() => player) };
    const cache = { wrap: vi.fn() };
    const service = new AddQueryToQueue(
      getSongs as never,
      playerManager as never,
      { ENABLE_SPONSORBLOCK: false, SPONSORBLOCK_TIMEOUT: 5 } as never,
      cache as never,
      {} as never,
    );
    const interaction = makeQueueInteraction();
    dependencyMocks.shuffle.mockImplementation((items: unknown[]) => [...items].reverse());

    await service.addToQueue({
      query: 'playlist',
      addToFrontOfQueue: false,
      shuffleAdditions: true,
      shouldSplitChapters: false,
      skipCurrentTrack: false,
      interaction: interaction as never,
    });

    const queue = (player as unknown as { queue: { getPosition(): number; getUpcoming(): QueuedSong[] } }).queue;
    expect(dependencyMocks.shuffle).toHaveBeenCalledOnce();
    expect(dependencyMocks.shuffle).toHaveBeenCalledWith(resolvedSongs);
    expect(queue.getPosition()).toBe(1);
    expect(player.getCurrent()?.title).toBe('Current');
    expect(player.getQueue().map((song) => song.title)).toEqual([
      'Existing upcoming',
      'New three',
      'New two',
      'New one',
    ]);
  });
});

describe('PLAY-13 private cookie-copy preservation', () => {
  it('runs without a cookie argument when no cookie source is configured', async () => {
    delete process.env.YT_DLP_COOKIES_PATH;
    process.env.YT_DLP_PATH = '/fake/yt-dlp';

    await expect(getYouTubeMediaSource('abcdefghijk')).resolves.toEqual({
      url: 'https://media.example/audio.webm',
      headers: { 'User-Agent': 'Fourier test' },
      isLive: false,
    });

    expect(dependencyMocks.spawnSync).toHaveBeenCalledOnce();
    const [cmdAndArgs] = dependencyMocks.spawnSync.mock.calls[0] as [string[]];
    expect(cmdAndArgs[0]).toBe('/fake/yt-dlp');
    expect(cmdAndArgs).not.toContain('--cookies');
    expect(cmdAndArgs.at(-1)).toBe('https://www.youtube.com/watch?v=abcdefghijk');
  });

  it('copies configured cookies with private modes during extraction and removes the copy after success', async () => {
    const fixtureDirectory = await fs.mkdtemp(path.join(tmpdir(), 'fourier-playback-gaps-fixture-'));
    const sourcePath = path.join(fixtureDirectory, 'mounted-cookies.txt');
    await fs.writeFile(sourcePath, 'private-cookie-bytes', 'utf8');
    process.env.YT_DLP_COOKIES_PATH = sourcePath;
    process.env.YT_DLP_PATH = '/fake/yt-dlp';
    let temporaryCookiesPath = '';
    let temporaryDirectory = '';

    dependencyMocks.spawnSync.mockImplementation((cmdAndArgs: string[]) => {
      const cookiesIndex = cmdAndArgs.indexOf('--cookies');
      temporaryCookiesPath = cmdAndArgs[cookiesIndex + 1];
      temporaryDirectory = path.dirname(temporaryCookiesPath);
      const directoryStats = statSync(temporaryDirectory);
      const fileStats = statSync(temporaryCookiesPath);
      const contents = readFileSync(temporaryCookiesPath, 'utf8');
      expect(temporaryCookiesPath).not.toBe(sourcePath);
      if (process.platform !== 'win32') {
        expect(directoryStats.mode & 0o777).toBe(0o700);
        expect(fileStats.mode & 0o777).toBe(0o600);
      }
      expect(contents).toBe('private-cookie-bytes');
      return { success: true, stdout: new TextEncoder().encode(VALID_MEDIA_RESPONSE) };
    });

    try {
      await getYouTubeMediaSource('https://www.youtube.com/watch?v=abcdefghijk');

      await expect(fs.access(temporaryDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(sourcePath, 'utf8')).resolves.toBe('private-cookie-bytes');
    } finally {
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it('removes the private cookie copy when extraction fails', async () => {
    const fixtureDirectory = await fs.mkdtemp(path.join(tmpdir(), 'fourier-playback-gaps-fixture-'));
    const sourcePath = path.join(fixtureDirectory, 'mounted-cookies.txt');
    await fs.writeFile(sourcePath, 'private-cookie-bytes', 'utf8');
    process.env.YT_DLP_COOKIES_PATH = sourcePath;
    let temporaryDirectory = '';

    dependencyMocks.spawnSync.mockImplementation((cmdAndArgs: string[]) => {
      const cookiesIndex = cmdAndArgs.indexOf('--cookies');
      const temporaryCookiesPath = cmdAndArgs[cookiesIndex + 1];
      temporaryDirectory = path.dirname(temporaryCookiesPath);
      expect(existsSync(temporaryCookiesPath)).toBe(true);
      return {
        success: false,
        stdout: new TextEncoder().encode(''),
        stderr: new TextEncoder().encode('extractor process failed'),
        exitCode: 1,
      };
    });

    try {
      await expect(getYouTubeMediaSource('abcdefghijk')).rejects.toThrow(
        'yt-dlp failed to extract media: extractor process failed',
      );
      await expect(fs.access(temporaryDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
    }
  });
});

describe('PLAY-14 yt-dlp unavailable classification preservation', () => {
  it.each([
    ['This video is not available', 'unavailable'],
    ['Video unavailable', 'unavailable'],
    ['Private video', 'unavailable'],
    ['Video has been removed', 'unavailable'],
    ['This is members-only content', 'unavailable'],
    ['Sign in to confirm your age', 'age-restricted'],
  ])('classifies %s as %s', async (detail, reason) => {
    dependencyMocks.spawnSync.mockReturnValue({
      success: false,
      stdout: new TextEncoder().encode(''),
      stderr: new TextEncoder().encode(`ERROR: ${detail}`),
      exitCode: 1,
    });

    await expect(getYouTubeMediaSource('abcdefghijk')).rejects.toMatchObject({
      name: 'YtDlpMediaUnavailableError',
      reason,
      message: `yt-dlp failed to extract media: ERROR: ${detail}`,
    });
  });

  it('surfaces a general extraction failure without misclassifying it as unavailable', async () => {
    dependencyMocks.spawnSync.mockReturnValue({
      success: false,
      stdout: new TextEncoder().encode(''),
      stderr: new TextEncoder().encode('ERROR: upstream TLS handshake failed'),
      exitCode: 1,
    });

    try {
      await getYouTubeMediaSource('abcdefghijk');
      throw new Error('Expected extraction to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(YtDlpMediaUnavailableError);
      expect((error as Error).message).toBe('yt-dlp failed to extract media: ERROR: upstream TLS handshake failed');
    }
  });
});

describe('PLAY-14 unplayable queue continuation preservation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    [new YtDlpMediaUnavailableError('video unavailable', 'unavailable'), 'unavailable media'],
    [new YtDlpMediaUnavailableError('private video', 'unavailable'), 'private media'],
    [new YtDlpMediaUnavailableError('video has been removed', 'unavailable'), 'removed media'],
    [
      new YtDlpMediaUnavailableError('sign in to confirm your age', 'age-restricted'),
      'age-restricted media without a fallback',
    ],
    [new FfmpegMediaUnavailableError(new Error('Server returned 403 Forbidden')), 'rejected FFmpeg media URL'],
    [{ statusCode: 410 }, 'HTTP 410 media'],
  ])('advances exactly once past %s (%s)', async (playbackError) => {
    const warning = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getStream, player } = makeReadyPlayer();
    const unavailable = makeQueuedSong('Unavailable');
    const next = makeQueuedSong('Next playable');
    player.add(unavailable);
    player.add(next);
    getStream.mockRejectedValueOnce(playbackError).mockResolvedValueOnce(Readable.from([]));
    const manualForward = spyOn(player, 'manualForward');

    await player.play();

    expect(manualForward).toHaveBeenCalledOnce();
    expect(manualForward).toHaveBeenCalledWith(1);
    expect(player.getCurrent()).toBe(next);
    expect(player.getQueue()).toEqual([]);
    expect(player.status).toBe(STATUS.PLAYING);
    expect(getStream).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledOnce();
  });

  it('finishes an unavailable final entry in IDLE and schedules only the configured idle timer', async () => {
    const warning = spyOn(console, 'warn').mockImplementation(() => undefined);
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout');
    dependencyMocks.getGuildSettings.mockResolvedValue({
      autoAnnounceNextSong: false,
      secondsToWaitAfterQueueEmpties: 7,
    });
    const { getStream, player, voiceConnection } = makeReadyPlayer();
    player.add(makeQueuedSong('Unavailable final entry'));
    getStream.mockRejectedValueOnce(new YtDlpMediaUnavailableError('private video'));
    const manualForward = spyOn(player, 'manualForward');

    await player.play();

    expect(manualForward).toHaveBeenCalledOnce();
    expect(player.getCurrent()).toBeNull();
    expect(player.status).toBe(STATUS.IDLE);
    expect(player.getPosition()).toBe(0);
    expect(setTimeoutSpy).toHaveBeenCalledOnce();
    expect(voiceConnection.destroy).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
  });

  it('surfaces general playback extraction errors without advancing the queue', async () => {
    const extractionError = new Error('ffmpeg input failed');
    const { getStream, player } = makeReadyPlayer();
    const current = makeQueuedSong('Current');
    player.add(current);
    player.add(makeQueuedSong('Must remain upcoming'));
    getStream.mockRejectedValueOnce(extractionError);
    const manualForward = spyOn(player, 'manualForward');

    await expect(player.play()).rejects.toBe(extractionError);

    expect(manualForward).not.toHaveBeenCalled();
    expect(player.getCurrent()).toBe(current);
    expect(player.getQueue().map((song) => song.title)).toEqual(['Must remain upcoming']);
    expect(player.status).toBe(STATUS.PAUSED);
  });
});

describe('CTRL-20 audio-idle advance preservation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('ignores Idle emitted when a manual transition programmatically stops the prior audio player', async () => {
    dependencyMocks.getGuildSettings.mockResolvedValue({
      autoAnnounceNextSong: true,
      secondsToWaitAfterQueueEmpties: 0,
    });
    const { createReadStream, player } = makeProductionStreamPlayer();
    player.add(makeQueuedSong('First'));
    player.add(makeQueuedSong('Second'));
    player.add(makeQueuedSong('Third'));
    const send = vi.fn().mockResolvedValue(undefined);
    Object.assign(player, { currentChannel: { send } });
    await player.play();
    const priorAudioPlayer = getPrivatePlayer(player).audioPlayer!;
    priorAudioPlayer.stop.mockReturnValue(true);
    const nextStreamStarted = makeDeferred<void>();
    const nextStream = makeDeferred<Readable>();
    createReadStream.mockImplementationOnce(() => {
      nextStreamStarted.resolve(undefined);
      return nextStream.promise;
    });

    const forward = player.forward(1);
    await nextStreamStarted.promise;
    priorAudioPlayer.emit('idle', { status: 'playing' }, { status: 'idle' });
    await flushAsyncWork();
    nextStream.resolve(Readable.from([]));
    await forward;

    expect(priorAudioPlayer.stop).toHaveBeenCalled();
    expect(player.getCurrent()?.title).toBe('Second');
    expect(player.getQueue().map((song) => song.title)).toEqual(['Third']);
    expect(createReadStream).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores Idle synchronously emitted by a same-entry programmatic replacement', async () => {
    dependencyMocks.getGuildSettings.mockResolvedValue({
      autoAnnounceNextSong: true,
      secondsToWaitAfterQueueEmpties: 0,
    });
    const { createReadStream, player } = makeProductionStreamPlayer();
    const current = makeQueuedSong('Current');
    player.add(current);
    player.add(makeQueuedSong('Upcoming'));
    const send = vi.fn().mockResolvedValue(undefined);
    Object.assign(player, { currentChannel: { send } });
    await player.play();
    const priorAudioPlayer = getPrivatePlayer(player).audioPlayer!;
    let emittedIdle = false;
    priorAudioPlayer.stop.mockImplementation(() => {
      if (!emittedIdle) {
        emittedIdle = true;
        priorAudioPlayer.emit('idle', { status: 'playing' }, { status: 'idle' });
      }

      return true;
    });

    await player.play();
    await flushAsyncWork();

    expect(player.getCurrent()).toBe(current);
    expect(player.getQueue().map((song) => song.title)).toEqual(['Upcoming']);
    expect(createReadStream).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves same-entry paused resume on the current audio player', async () => {
    const { createReadStream, player } = makeProductionStreamPlayer();
    const current = makeQueuedSong('Current');
    player.add(current);
    player.add(makeQueuedSong('Upcoming'));
    await player.play();
    const audioPlayer = getPrivatePlayer(player).audioPlayer!;

    player.pause();
    await player.play();

    expect(player.getCurrent()).toBe(current);
    expect(player.getQueue().map((song) => song.title)).toEqual(['Upcoming']);
    expect(player.status).toBe(STATUS.PLAYING);
    expect(getPrivatePlayer(player).audioPlayer).toBe(audioPlayer);
    expect(audioPlayer.unpause).toHaveBeenCalledOnce();
    expect(createReadStream).toHaveBeenCalledOnce();
  });

  it('announces only the natural idle advance, not a manual forward', async () => {
    dependencyMocks.getGuildSettings.mockResolvedValue({
      autoAnnounceNextSong: true,
      secondsToWaitAfterQueueEmpties: 0,
    });
    const { player } = makeReadyPlayer();
    player.add(makeQueuedSong('First'));
    player.add(makeQueuedSong('Second'));
    player.add(makeQueuedSong('Third'));
    const send = vi.fn().mockResolvedValue(undefined);
    Object.assign(player, { currentChannel: { send } });
    await player.play();

    await player.forward(1);
    expect(player.getCurrent()?.title).toBe('Second');
    expect(send).not.toHaveBeenCalled();

    getPrivatePlayer(player).audioPlayer!.emit('idle', { status: 'playing' }, { status: 'idle' });
    await flushAsyncWork();

    expect(player.getCurrent()?.title).toBe('Third');
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ embeds: [{ title: 'playing' }] });
  });

  it('restarts the same entry from zero when song loop is enabled', async () => {
    const { getStream, player } = makeReadyPlayer();
    const repeated = makeQueuedSong('Repeated');
    player.add(repeated);
    await player.play();
    const entryId = player.getCurrentQueueEntryId();
    jest.advanceTimersByTime(4_000);
    expect(player.getPosition()).toBe(4);
    player.loopCurrentSong = true;

    await getPrivatePlayer(player).onAudioPlayerIdle({ status: 'playing' }, { status: 'idle' });

    expect(player.getCurrent()).toBe(repeated);
    expect(player.getCurrentQueueEntryId()).toBe(entryId);
    expect(player.getPosition()).toBe(0);
    expect(player.status).toBe(STATUS.PLAYING);
    expect(getStream).toHaveBeenCalledTimes(2);
    expect(getStream).toHaveBeenLastCalledWith(repeated, { seek: 0, to: 100 });
  });

  it('re-adds each naturally completed entry so queue loop cycles in order', async () => {
    const { getStream, player } = makeReadyPlayer();
    const first = makeQueuedSong('First');
    const second = makeQueuedSong('Second');
    player.add(first);
    player.add(second);
    player.loopCurrentQueue = true;
    await player.play();
    const originalFirstEntryId = player.getCurrentQueueEntryId();

    await getPrivatePlayer(player).onAudioPlayerIdle({ status: 'playing' }, { status: 'idle' });
    const secondEntryId = player.getCurrentQueueEntryId();
    expect(player.getCurrent()).toBe(second);
    expect(player.getQueue()).toEqual([first]);

    await getPrivatePlayer(player).onAudioPlayerIdle({ status: 'playing' }, { status: 'idle' });

    expect(player.getCurrent()).toBe(first);
    expect(player.getQueue()).toEqual([second]);
    expect(player.getCurrentQueueEntryId()).not.toBe(originalFirstEntryId);
    expect(player.getCurrentQueueEntryId()).not.toBe(secondEntryId);
    expect(player.status).toBe(STATUS.PLAYING);
    expect(getStream).toHaveBeenCalledTimes(3);
  });

  it('contains and logs a rejected idle handler instead of leaking an unhandled rejection', async () => {
    const { player } = makeReadyPlayer();
    player.add(makeQueuedSong('First'));
    player.add(makeQueuedSong('Second'));
    await player.play();
    const idleError = new Error('natural advance failed');
    spyOn(player, 'forward').mockRejectedValue(idleError);
    let resolveLogged!: (args: unknown[]) => void;
    const logged = new Promise<unknown[]>((resolve) => {
      resolveLogged = resolve;
    });
    const consoleError = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      resolveLogged(args);
    });
    const audioPlayer = getPrivatePlayer(player).audioPlayer!;

    audioPlayer.emit('idle', { status: 'playing' }, { status: 'idle' });

    await expect(logged).resolves.toEqual([`Audio player idle handler failed for guild ${GUILD_ID}:`, idleError]);
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
