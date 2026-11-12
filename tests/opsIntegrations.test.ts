import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';

const sanitize = (input: string) =>
  input
    .replace(/https?:\/\/\S+/gi, '[media URL]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
const getDetail = (error: unknown) => (error instanceof Error ? error.message : String(error));

class FfmpegMediaUnavailableErrorMock extends Error {
  reason: string;
  constructor(error: unknown, reason = 'unavailable') {
    super(`FFmpeg could not start audio transcoding: ${sanitize(getDetail(error))}`);
    this.name = 'FfmpegMediaUnavailableError';
    this.reason = reason;
  }
}

class FfmpegStartupErrorMock extends Error {
  constructor(error: unknown) {
    super(`FFmpeg could not initialize audio transcoding: ${sanitize(getDetail(error))}`);
    this.name = 'FfmpegStartupError';
  }
}

class FfmpegProcessErrorMock extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegProcessError';
  }
}

const dependencyMocks = {
  FfmpegMediaUnavailableError: FfmpegMediaUnavailableErrorMock,
  FfmpegProcessError: FfmpegProcessErrorMock,
  FfmpegStartupError: FfmpegStartupErrorMock,
  createAudioPlayer: vi.fn(),
  createAudioResource: vi.fn(),
  createReadStreamFromFfmpeg: vi.fn(),
  debug: vi.fn(),
  entersState: vi.fn(),
  getGuildSettings: vi.fn(),
  joinVoiceChannel: vi.fn(),
  sleep: vi.fn(),
  spawn: vi.fn(),
  spotifyClientCredentialsGrant: vi.fn(),
  spotifyConstructorOptions: [] as unknown[],
  spotifySetAccessToken: vi.fn(),
};

mock.module('@discordjs/voice', () => ({
  AudioPlayerStatus: { Idle: 'idle' },
  VoiceConnectionDisconnectReason: { WebSocketClose: 'websocket-close' },
  VoiceConnectionStatus: {
    Connecting: 'connecting',
    Disconnected: 'disconnected',
    Destroyed: 'destroyed',
    Ready: 'ready',
    Signalling: 'signalling',
  },
  StreamType: { WebmOpus: 'webm-opus' },
  createAudioPlayer: dependencyMocks.createAudioPlayer,
  createAudioResource: dependencyMocks.createAudioResource,
  entersState: dependencyMocks.entersState,
  joinVoiceChannel: dependencyMocks.joinVoiceChannel,
}));

mock.module('../src/services/voiceConnectionRecovery.js', () => ({
  destroyVoiceConnection: (connection: { state: { status: string } }) => {
    if (connection.state.status !== 'destroyed') {
      (connection as unknown as { destroy: () => void }).destroy();
    }
  },
  recoverVoiceConnection: async (
    connection: {
      rejoin: () => boolean;
      rejoinAttempts: number;
      state: { status: string; reason?: string; closeCode?: number };
    },
    options: { isCurrent: (c: unknown) => boolean; dispose: (c: unknown) => void },
  ) => {
    const { entersState: waitForState } = dependencyMocks;
    const { isCurrent, dispose } = options;
    const VoiceConnectionStatus = {
      Connecting: 'connecting',
      Disconnected: 'disconnected',
      Destroyed: 'destroyed',
      Ready: 'ready',
      Signalling: 'signalling',
    } as const;
    const VoiceConnectionDisconnectReason = { WebSocketClose: 'websocket-close' } as const;

    if (!isCurrent(connection)) {
      dispose(connection);
      return;
    }
    if (connection.state.status !== VoiceConnectionStatus.Disconnected) {
      if (connection.state.status === VoiceConnectionStatus.Destroyed) {
        dispose(connection);
      }
      return;
    }
    if (
      connection.state.reason === VoiceConnectionDisconnectReason.WebSocketClose &&
      connection.state.closeCode === 4014
    ) {
      try {
        await Promise.race([
          waitForState(connection, VoiceConnectionStatus.Connecting, 5_000),
          waitForState(connection, VoiceConnectionStatus.Signalling, 5_000),
        ]);
        if (!isCurrent(connection) || (connection.state.status as string) === VoiceConnectionStatus.Destroyed) {
          dispose(connection);
        }
        return;
      } catch {
        dispose(connection);
        return;
      }
    }
    if (connection.rejoinAttempts < 5) {
      await dependencyMocks.sleep((connection.rejoinAttempts + 1) * 5_000);
      if (!isCurrent(connection)) {
        dispose(connection);
        return;
      }
      if (connection.state.status !== VoiceConnectionStatus.Disconnected) {
        if (connection.state.status === VoiceConnectionStatus.Destroyed) {
          dispose(connection);
        }
        return;
      }
      if (connection.rejoin()) {
        return;
      }
    }
    dispose(connection);
  },
}));

mock.module('../src/services/ffmpegProcess.js', () => ({
  createReadStream: (...args: unknown[]) => dependencyMocks.createReadStreamFromFfmpeg(...args),
  FfmpegMediaUnavailableError: dependencyMocks.FfmpegMediaUnavailableError,
  FfmpegStartupError: dependencyMocks.FfmpegStartupError,
  FfmpegProcessError: dependencyMocks.FfmpegProcessError,
}));

mock.module('prism-media', () => {
  const { Transform } = require('node:stream');

  return {
    default: {
      opus: {
        WebmDemuxer: class extends Transform {
          _transform(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
            if (chunk.includes(1)) {
              this.push(Buffer.from([0xf8, 0xff, 0xfe]));
            }

            done();
          }
        },
      },
    },
  };
});

mock.module('spotify-web-api-node', () => ({
  default: class {
    clientCredentialsGrant = dependencyMocks.spotifyClientCredentialsGrant;
    setAccessToken = dependencyMocks.spotifySetAccessToken;

    constructor(options: unknown) {
      dependencyMocks.spotifyConstructorOptions.push(options);
    }
  },
}));

mock.module('../src/services/fileCache.js', () => ({
  default: class {},
}));

mock.module('../src/utils/buildEmbed.js', () => ({
  buildPlayingMessageEmbed: vi.fn(() => ({ title: 'playing' })),
}));

mock.module('../src/utils/getGuildSettings.js', () => ({
  getGuildSettings: dependencyMocks.getGuildSettings,
}));

mock.module('../src/utils/debug.js', () => ({
  default: dependencyMocks.debug,
}));

import Player, {
  FfmpegMediaUnavailableError,
  FfmpegStartupError,
  MediaSource,
  type QueuedSong,
} from '../src/services/player.js';
import ThirdParty from '../src/services/thirdParty.js';
import prepareYtDlp from '../src/utils/prepareYtDlp.js';
import {
  ensureExecutable,
  getExecutable,
  getYouTubeMediaSource,
  getYtDlpVersion,
  updateYtDlp,
} from '../src/utils/ytDlp.js';

const GUILD_ID = 'guild-id';
const ORIGINAL_ENV = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  FOURIER_BUNDLED_YT_DLP_PATH: process.env.FOURIER_BUNDLED_YT_DLP_PATH,
  PATH: process.env.PATH,
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  YT_DLP_COOKIES_PATH: process.env.YT_DLP_COOKIES_PATH,
  YT_DLP_PATH: process.env.YT_DLP_PATH,
};
const VALID_MEDIA_RESPONSE = JSON.stringify({
  requested_downloads: [
    {
      url: 'https://media.example/requested.webm',
      http_headers: {
        Authorization: 'Bearer media-token',
        'User-Agent': 'Fourier ops test',
        Empty: '',
        Missing: null,
      },
    },
  ],
  http_headers: { 'X-Fallback': 'not-used' },
  is_live: true,
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

const makeDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
};

const flushAsyncWork = async () => {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
  }
};

const classifyFfmpegError = (error: unknown): Error => {
  const { FfmpegMediaUnavailableError, FfmpegStartupError } = dependencyMocks;
  if (error instanceof FfmpegMediaUnavailableError || error instanceof FfmpegStartupError) {
    return error;
  }

  if (error instanceof Error && /Server returned (?:404|410)|404 Not Found|410 Gone/i.test(error.message)) {
    return new FfmpegMediaUnavailableError(error, 'not-found');
  }

  const detail = error instanceof Error ? error.message : String(error);
  if (/Invalid data found when processing input/i.test(detail)) {
    return new FfmpegMediaUnavailableError(error, 'invalid-output');
  }

  return new FfmpegStartupError(error);
};

const makeFfmpegReadStreamResult = ({
  startupError,
  hangOutput = false,
  emptyOutput = false,
  headerOnlyOutput = false,
  startupErrorAfterOutput,
}: {
  startupError?: Error;
  hangOutput?: boolean;
  emptyOutput?: boolean;
  headerOnlyOutput?: boolean;
  startupErrorAfterOutput?: Error;
} = {}): Promise<Readable> => {
  return new Promise((resolve, reject) => {
    if (hangOutput) {
      return;
    }

    if (startupError) {
      reject(classifyFfmpegError(startupError));
      return;
    }

    const stream = new PassThrough();

    if (!emptyOutput && !headerOnlyOutput) {
      stream.write(Buffer.from([1]));
    }

    if (headerOnlyOutput) {
      stream.end();
      reject(
        new dependencyMocks.FfmpegMediaUnavailableError(
          new Error('FFmpeg produced no playable Opus audio.'),
          'invalid-output',
        ),
      );
      return;
    }

    if (startupErrorAfterOutput) {
      stream.end();
      reject(classifyFfmpegError(startupErrorAfterOutput));
      return;
    }

    if (emptyOutput) {
      reject(
        new dependencyMocks.FfmpegMediaUnavailableError(
          new Error('FFmpeg produced no playable Opus audio.'),
          'invalid-output',
        ),
      );
      return;
    }

    stream.end();
    resolve(stream);
  });
};

const makeExecutableLayout = async (includePython = true) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'fourier-ops-yt-dlp-'));
  const bin = path.join(root, 'bin');
  const executable = path.join(bin, 'yt-dlp');
  const python = path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python');
  await fs.mkdir(bin);
  await fs.writeFile(executable, '#!/bin/sh\n', { mode: 0o755 });
  if (includePython) {
    await fs.writeFile(python, '#!/bin/sh\n', { mode: 0o755 });
  }

  return { executable, python, root };
};

const loadSpotifyBindingHarness = async (clientId: string, clientSecret: string) => {
  process.env.DISCORD_TOKEN = 'synthetic-discord-token';
  process.env.YOUTUBE_API_KEY = 'synthetic-youtube-key';
  process.env.SPOTIFY_CLIENT_ID = clientId;
  process.env.SPOTIFY_CLIENT_SECRET = clientSecret;

  const discordActual = await import('discord.js');
  (mock.module as unknown as (specifier: string, factory: () => unknown, options: { overwrite: boolean }) => void)(
    'discord.js',
    () => ({ ...discordActual, Client: class {} }),
    { overwrite: true },
  );

  const { default: Play } = await import('../src/commands/play.js');

  return { Play };
};

const makeVoiceConnection = (overrides: Record<string, unknown> = {}) => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const connection = {
    destroy: vi.fn(),
    joinConfig: { channelId: 'voice-channel-id' },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return connection;
    }),
    receiver: { speaking: { on: vi.fn() } },
    rejoin: vi.fn(() => true),
    rejoinAttempts: 0,
    state: { status: 'ready' },
    subscribe: vi.fn(),
    ...overrides,
  };

  return { connection, handlers };
};

const getPrivatePlayer = (player: Player) =>
  player as unknown as {
    onVoiceConnectionDisconnect(connection: object): Promise<void>;
  };

beforeEach(() => {
  vi.clearAllMocks();
  dependencyMocks.spotifyConstructorOptions.length = 0;
  delete process.env.YT_DLP_COOKIES_PATH;
  delete process.env.YT_DLP_PATH;
  delete process.env.FOURIER_BUNDLED_YT_DLP_PATH;
  vi.spyOn(Bun, 'spawn').mockImplementation(((cmdAndArgs: string[], options: unknown) =>
    makeSpawnProc(dependencyMocks.spawn(cmdAndArgs, options))) as never);
  dependencyMocks.spawn.mockReturnValue({
    success: true,
    stdout: new TextEncoder().encode(VALID_MEDIA_RESPONSE),
  });
  dependencyMocks.createReadStreamFromFfmpeg.mockImplementation((_opts: { url: string }) =>
    makeFfmpegReadStreamResult(),
  );
  dependencyMocks.getGuildSettings.mockResolvedValue({
    defaultVolume: 100,
    turnDownVolumeWhenPeopleSpeak: false,
  });
  dependencyMocks.entersState.mockResolvedValue(undefined);
  dependencyMocks.sleep.mockResolvedValue(undefined);
});

afterEach(() => {
  try {
    vi.clearAllTimers();
  } catch {}
  try {
    vi.useRealTimers();
  } catch {}
  vi.restoreAllMocks();

  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('OPS-10 yt-dlp selection and update lifecycle', () => {
  it('prefers YT_DLP_PATH and reports the trimmed installed version when auto-update is disabled', async () => {
    process.env.YT_DLP_PATH = '/configured/yt-dlp';
    process.env.FOURIER_BUNDLED_YT_DLP_PATH = '/bundled/yt-dlp';
    process.env.PATH = '/path/that/would/otherwise/be/searched';
    dependencyMocks.spawn.mockReturnValue({
      success: true,
      stdout: new TextEncoder().encode(' 2026.07.12 \n'),
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(getExecutable()).toBe('/configured/yt-dlp');
    await expect(getYtDlpVersion()).resolves.toBe('2026.07.12');
    await prepareYtDlp({ YT_DLP_AUTO_UPDATE: false } as never);

    expect(dependencyMocks.spawn).toHaveBeenCalledWith(
      ['/configured/yt-dlp', '--version'],
      expect.objectContaining({ stderr: 'pipe', stdin: 'ignore' }),
    );
    expect(log).toHaveBeenCalledWith('ℹ YT_DLP_VERSION=2026.07.12 (/configured/yt-dlp)');
  });

  it('falls back from a blank configured path to the bundled executable and then the bundled bin/yt-dlp default', () => {
    process.env.YT_DLP_PATH = '   ';
    process.env.FOURIER_BUNDLED_YT_DLP_PATH = ' /bundled/yt-dlp ';
    expect(getExecutable()).toBe('/bundled/yt-dlp');

    delete process.env.FOURIER_BUNDLED_YT_DLP_PATH;
    expect(getExecutable()).toBe(path.join(process.cwd(), 'bin', 'yt-dlp'));
  });

  it.skipIf(process.platform === 'win32')(
    'repairs a bundled yt-dlp that lacks the executable bit so it can be spawned',
    async () => {
      const layout = await makeExecutableLayout(false);
      await fs.chmod(layout.executable, 0o644);
      process.env.YT_DLP_PATH = layout.executable;
      process.env.PATH = '/path/that/would/otherwise/be/searched';

      const resolved = await ensureExecutable();
      expect(resolved).toBe(await fs.realpath(layout.executable));
      const { mode } = await fs.stat(layout.executable);
      expect(mode & 0o100).toBe(0o100);

      dependencyMocks.spawn.mockReturnValue({
        success: true,
        stdout: new TextEncoder().encode('2026.07.12\n'),
      });
      await expect(getYtDlpVersion()).resolves.toBe('2026.07.12');
    },
  );

  it('prefers pip through the executable sibling virtualenv and re-probes the updated version', async () => {
    const layout = await makeExecutableLayout();
    const pythonExecutable = await fs.realpath(layout.python);
    process.env.YT_DLP_PATH = layout.executable;
    const versions = ['2026.01.01', '2026.07.12'];
    dependencyMocks.spawn.mockImplementation((cmdAndArgs: string[]) => {
      const [executable, ...args] = cmdAndArgs;

      if (args[0] === '--version') {
        return { success: true, stdout: new TextEncoder().encode(versions.shift()!) };
      }

      const normalizedExe = path.resolve(executable);
      if (normalizedExe === path.resolve(pythonExecutable)) {
        return { success: true, stdout: new TextEncoder().encode('') };
      }

      throw new Error(`Unexpected command: ${executable} ${args.join(' ')}`);
    });

    try {
      await expect(updateYtDlp()).resolves.toEqual({
        beforeVersion: '2026.01.01',
        afterVersion: '2026.07.12',
        updated: true,
        skipped: false,
        updateSucceeded: true,
        error: undefined,
      });
      const pipCall = dependencyMocks.spawn.mock.calls.find((call: unknown[]) => {
        const [cmdAndArgs] = call as [string[], ...unknown[]];
        const [executable, ...args] = cmdAndArgs;
        return path.resolve(executable) === path.resolve(pythonExecutable) && args[0] === '-m';
      });
      expect(pipCall).toBeDefined();
      expect(pipCall![0]).toEqual([
        pythonExecutable,
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        '--upgrade',
        'yt-dlp[default]',
      ]);
      expect(
        dependencyMocks.spawn.mock.calls.some((call: unknown[]) => {
          const [cmdAndArgs] = call as [string[], ...unknown[]];
          const [, ...args] = cmdAndArgs;
          return args[0] === '-U';
        }),
      ).toBe(false);
      const lastCall = dependencyMocks.spawn.mock.calls[dependencyMocks.spawn.mock.calls.length - 1];
      expect(lastCall![0]).toEqual([layout.executable, '--version']);
    } finally {
      await fs.rm(layout.root, { recursive: true, force: true });
    }
  });

  it('falls back to self-update when sibling-venv pip fails and still re-probes', async () => {
    const layout = await makeExecutableLayout();
    const pythonExecutable = await fs.realpath(layout.python);
    process.env.YT_DLP_PATH = layout.executable;
    const versions = ['2026.01.01', '2026.07.12'];
    dependencyMocks.spawn.mockImplementation((cmdAndArgs: string[]) => {
      const [executable, ...args] = cmdAndArgs;

      if (args[0] === '--version') {
        return { success: true, stdout: new TextEncoder().encode(versions.shift()!) };
      }

      const normalizedExe = path.resolve(executable);
      if (normalizedExe === path.resolve(pythonExecutable)) {
        return {
          success: false,
          stdout: new TextEncoder().encode(''),
          stderr: new TextEncoder().encode('pip update failed'),
          exitCode: 1,
        };
      }

      if (args[0] === '-U') {
        return { success: true, stdout: new TextEncoder().encode('') };
      }

      throw new Error(`Unexpected command: ${executable} ${args.join(' ')}`);
    });

    try {
      await expect(updateYtDlp()).resolves.toMatchObject({
        beforeVersion: '2026.01.01',
        afterVersion: '2026.07.12',
        updated: true,
        updateSucceeded: true,
      });
      const selfUpdateCall = dependencyMocks.spawn.mock.calls.find((call: unknown[]) => {
        const [cmdAndArgs] = call as [string[], ...unknown[]];
        const [, ...args] = cmdAndArgs;
        return args[0] === '-U';
      });
      expect(selfUpdateCall).toBeDefined();
      const lastCall = dependencyMocks.spawn.mock.calls[dependencyMocks.spawn.mock.calls.length - 1];
      expect(lastCall![0]).toEqual([layout.executable, '--version']);
    } finally {
      await fs.rm(layout.root, { recursive: true, force: true });
    }
  });

  it('keeps an installed version nonfatal after both update mechanisms fail', async () => {
    const layout = await makeExecutableLayout();
    const pythonExecutable = await fs.realpath(layout.python);
    process.env.YT_DLP_PATH = layout.executable;
    dependencyMocks.spawn.mockImplementation((cmdAndArgs: string[]) => {
      const [executable, ...args] = cmdAndArgs;

      if (args[0] === '--version') {
        return { success: true, stdout: new TextEncoder().encode('2026.01.01') };
      }

      const normalizedExe = path.resolve(executable);
      if (normalizedExe === path.resolve(pythonExecutable)) {
        return {
          success: false,
          stdout: new TextEncoder().encode(''),
          stderr: new TextEncoder().encode('pip update failed'),
          exitCode: 1,
        };
      }

      if (args[0] === '-U') {
        return {
          success: false,
          stdout: new TextEncoder().encode(''),
          stderr: new TextEncoder().encode('self update failed'),
          exitCode: 1,
        };
      }

      throw new Error(`Unexpected command: ${executable} ${args.join(' ')}`);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(prepareYtDlp({ YT_DLP_AUTO_UPDATE: true } as never)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith('⚠ yt-dlp update warning: pip update failed; self update failed');
      expect(log).toHaveBeenCalledWith(
        '⚠ YT_DLP_VERSION=2026.01.01 (update failed; continuing with installed version)',
      );
      const versionCalls = dependencyMocks.spawn.mock.calls.filter((call: unknown[]) => {
        const [cmdAndArgs] = call as [string[], ...unknown[]];
        const [, ...args] = cmdAndArgs;
        return args[0] === '--version';
      });
      expect(versionCalls).toHaveLength(2);
    } finally {
      await fs.rm(layout.root, { recursive: true, force: true });
    }
  });
});

describe('OPS-11 yt-dlp extraction and ffmpeg handoff', () => {
  it('uses the bounded single-video Node-runtime extraction contract and normalizes the selected download', async () => {
    process.env.YT_DLP_PATH = '/fake/yt-dlp';

    await expect(getYouTubeMediaSource('abcdefghijk')).resolves.toEqual({
      url: 'https://media.example/requested.webm',
      headers: {
        Authorization: 'Bearer media-token',
        'User-Agent': 'Fourier ops test',
      },
      isLive: true,
    });
    expect(dependencyMocks.spawn).toHaveBeenCalledWith(
      [
        '/fake/yt-dlp',
        '--dump-single-json',
        '--no-playlist',
        '--skip-download',
        '--no-warnings',
        '--no-cache-dir',
        '--js-runtimes',
        'node',
        '-f',
        'bestaudio/best',
        '-S',
        'proto:https',
        'https://www.youtube.com/watch?v=abcdefghijk',
      ],
      expect.objectContaining({ stderr: 'pipe', stdin: 'ignore' }),
    );
  });

  it('routes network media through the bounded-range reader with normalized headers', async () => {
    process.env.YT_DLP_PATH = '/fake/yt-dlp';
    const fileCache = {
      getEntryFor: vi.fn().mockResolvedValue(null),
    };
    const player = new Player(fileCache as never, GUILD_ID);
    const song: QueuedSong = {
      title: 'Long uncached track',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 3_600,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    const stream = await (
      player as unknown as {
        getStream(input: QueuedSong): Promise<Readable>;
      }
    ).getStream(song);

    expect(dependencyMocks.createReadStreamFromFfmpeg).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://media.example/requested.webm',
        networkStream: true,
        headers: expect.objectContaining({ Authorization: 'Bearer media-token' }),
      }),
    );

    stream.destroy();
    await flushAsyncWork();
  });

  it('rejects an FFmpeg startup failure before reporting a playable stream and redacts the signed URL', async () => {
    process.env.YT_DLP_PATH = '/fake/yt-dlp';
    const signedUrl = 'HTTPS://media.example/requested.webm?token=secret';
    dependencyMocks.createReadStreamFromFfmpeg.mockImplementation(() =>
      makeFfmpegReadStreamResult({
        startupError: new Error(`${signedUrl}: Server returned 404 Not Found`),
      }),
    );
    const fileCache = {
      getEntryFor: vi.fn().mockResolvedValue(null),
    };
    const player = new Player(fileCache as never, GUILD_ID);
    const song: QueuedSong = {
      title: 'Rejected media URL',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 3_600,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    const result = (
      player as unknown as {
        getStream(input: QueuedSong): Promise<Readable>;
      }
    ).getStream(song);

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        name: 'FfmpegMediaUnavailableError',
        message: expect.stringContaining('[media URL]'),
      }),
    );
    await expect(result).rejects.not.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('token=secret'),
      }),
    );
    await expect(result).rejects.toBeInstanceOf(FfmpegMediaUnavailableError);
  });

  it('rejects an empty FFmpeg output instead of reporting playback', async () => {
    dependencyMocks.createReadStreamFromFfmpeg.mockImplementation(() =>
      makeFfmpegReadStreamResult({ emptyOutput: true }),
    );
    const player = new Player(
      {
        getEntryFor: vi.fn().mockResolvedValue({ generation: 'cached-generation', path: '/cached/audio.webm' }),
      } as never,
      GUILD_ID,
    );
    const song: QueuedSong = {
      title: 'Empty media output',
      artist: 'Artist',
      url: 'https://media.example/empty.webm',
      length: 100,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.HLS,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    const result = (
      player as unknown as {
        getStream(input: QueuedSong): Promise<Readable>;
      }
    ).getStream(song);
    await expect(result).rejects.toMatchObject({
      name: 'FfmpegMediaUnavailableError',
      message: expect.stringContaining('produced no playable Opus audio'),
    });
  });

  it('propagates a startup timeout error for retry instead of skipping the queue', async () => {
    const startupDelay = makeDeferred<void>();
    dependencyMocks.createReadStreamFromFfmpeg.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          startupDelay.promise.then(
            () => {},
            () => {
              reject(
                new dependencyMocks.FfmpegStartupError(
                  new Error('FFmpeg produced no playable audio within 20 seconds.'),
                ),
              );
            },
          );
        }),
    );
    const player = new Player(
      {
        getEntryFor: vi.fn().mockResolvedValue({ generation: 'cached-generation', path: '/cached/audio.webm' }),
      } as never,
      GUILD_ID,
    );
    const song: QueuedSong = {
      title: 'Slow startup',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 100,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    const result = (
      player as unknown as {
        getStream(input: QueuedSong): Promise<Readable>;
      }
    ).getStream(song);

    startupDelay.reject(new Error('FFmpeg produced no playable audio within 20 seconds.'));
    await expect(result).rejects.toMatchObject({
      name: 'FfmpegStartupError',
    });
  });

  it('waits for the FFmpeg result before classifying output EOF', async () => {
    dependencyMocks.createReadStreamFromFfmpeg.mockImplementation(() =>
      makeFfmpegReadStreamResult({
        emptyOutput: true,
        startupErrorAfterOutput: new Error('Server returned 403 Forbidden'),
      }),
    );
    const player = new Player(
      {
        getEntryFor: vi.fn().mockResolvedValue({ generation: 'cached-generation', path: '/cached/audio.webm' }),
      } as never,
      GUILD_ID,
    );
    const song: QueuedSong = {
      title: 'EOF before process result',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 100,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    await expect(
      (
        player as unknown as {
          getStream(input: QueuedSong): Promise<Readable>;
        }
      ).getStream(song),
    ).rejects.toBeInstanceOf(FfmpegStartupError);
  });

  it('does not accept a container header without a playable Opus packet', async () => {
    dependencyMocks.createReadStreamFromFfmpeg.mockImplementation(() =>
      makeFfmpegReadStreamResult({
        headerOnlyOutput: true,
      }),
    );
    const player = new Player(
      {
        getEntryFor: vi.fn().mockResolvedValue({ generation: 'cached-generation', path: '/cached/audio.webm' }),
      } as never,
      GUILD_ID,
    );
    const song: QueuedSong = {
      title: 'Header-only output',
      artist: 'Artist',
      url: 'https://media.example/header-only.webm',
      length: 100,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.HLS,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    await expect(
      (
        player as unknown as {
          getStream(input: QueuedSong): Promise<Readable>;
        }
      ).getStream(song),
    ).rejects.toBeInstanceOf(FfmpegMediaUnavailableError);
  });

  it('invalidates a corrupt cached input and retries from a fresh media URL', async () => {
    dependencyMocks.createReadStreamFromFfmpeg
      .mockImplementationOnce(() => makeFfmpegReadStreamResult({ headerOnlyOutput: true }))
      .mockImplementationOnce(() => makeFfmpegReadStreamResult());
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const player = new Player(
      {
        getEntryFor: vi
          .fn()
          .mockResolvedValueOnce({ generation: 'corrupt-generation', path: '/cached/corrupt.webm' })
          .mockResolvedValueOnce(null),
        invalidate,
      } as never,
      GUILD_ID,
    );
    const song: QueuedSong = {
      title: 'Corrupt cached input',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 3_600,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    const stream = await (
      player as unknown as {
        getStream(input: QueuedSong): Promise<Readable>;
      }
    ).getStream(song);

    expect(invalidate).toHaveBeenCalledWith(expect.any(String), 'corrupt-generation');
    expect(dependencyMocks.createReadStreamFromFfmpeg).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ url: '/cached/corrupt.webm' }),
    );
    expect(dependencyMocks.createReadStreamFromFfmpeg).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ url: 'https://media.example/requested.webm' }),
    );
    stream.destroy();
  });

  it('preserves infrastructure-level FFmpeg startup failures', async () => {
    dependencyMocks.createReadStreamFromFfmpeg.mockImplementation(() =>
      makeFfmpegReadStreamResult({
        startupError: new Error('spawn ffmpeg ENOENT'),
      }),
    );
    const player = new Player(
      {
        getEntryFor: vi.fn().mockResolvedValue({ generation: 'cached-generation', path: '/cached/audio.webm' }),
      } as never,
      GUILD_ID,
    );
    const song: QueuedSong = {
      title: 'Host failure',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 100,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    await expect(
      (
        player as unknown as {
          getStream(input: QueuedSong): Promise<Readable>;
        }
      ).getStream(song),
    ).rejects.toBeInstanceOf(FfmpegStartupError);
  });

  it('preserves transient HTTP failures for retry instead of skipping the queue', async () => {
    dependencyMocks.createReadStreamFromFfmpeg.mockImplementation(() =>
      makeFfmpegReadStreamResult({
        startupError: new Error('Server returned 403 Forbidden'),
      }),
    );
    const player = new Player(
      {
        getEntryFor: vi.fn().mockResolvedValue({ generation: 'cached-generation', path: '/cached/audio.webm' }),
      } as never,
      GUILD_ID,
    );
    const song: QueuedSong = {
      title: 'Transient media failure',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 100,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    await expect(
      (
        player as unknown as {
          getStream(input: QueuedSong): Promise<Readable>;
        }
      ).getStream(song),
    ).rejects.toBeInstanceOf(FfmpegStartupError);
  });

  it('enables caching only for short non-live YouTube tracks without a seek', async () => {
    dependencyMocks.spawn.mockReturnValue({
      success: true,
      stdout: new TextEncoder().encode(
        JSON.stringify({
          ...JSON.parse(VALID_MEDIA_RESPONSE),
          is_live: false,
        }),
      ),
    });
    const player = new Player(
      {
        getEntryFor: vi.fn().mockResolvedValue(null),
      } as never,
      GUILD_ID,
    );
    const song: QueuedSong = {
      title: 'Short cacheable track',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 60,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    const stream = await (
      player as unknown as {
        getStream(input: QueuedSong): Promise<Readable>;
      }
    ).getStream(song);

    expect(dependencyMocks.createReadStreamFromFfmpeg).toHaveBeenCalledWith(
      expect.objectContaining({
        cache: true,
        url: 'https://media.example/requested.webm',
      }),
    );
    stream.destroy();
  });

  it('does not cache livestreams or long videos', async () => {
    dependencyMocks.spawn.mockReturnValue({
      success: true,
      stdout: new TextEncoder().encode(
        JSON.stringify({
          ...JSON.parse(VALID_MEDIA_RESPONSE),
          is_live: true,
        }),
      ),
    });
    const player = new Player(
      {
        getEntryFor: vi.fn().mockResolvedValue(null),
      } as never,
      GUILD_ID,
    );
    const longSong: QueuedSong = {
      title: 'Long uncached track',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 3_600,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    const stream = await (
      player as unknown as {
        getStream(input: QueuedSong): Promise<Readable>;
      }
    ).getStream(longSong);

    expect(dependencyMocks.createReadStreamFromFfmpeg).toHaveBeenCalledWith(expect.objectContaining({ cache: false }));
    stream.destroy();
  });
});

describe('OPS-12 optional Spotify bindings', () => {
  it('advertises Spotify when both credentials produce a Spotify-backed Play command', async () => {
    const { Play } = await loadSpotifyBindingHarness(' client-id ', ' client-secret ');
    const command = new Play({ spotify: {} } as never, {} as never, {} as never);
    const queryOption = command.slashCommand.toJSON().options?.find((option) => option.name === 'query');

    expect(queryOption?.description).toBe('YouTube URL, Spotify URL, or search query');
  });

  it.each([
    ['', 'client-secret', 'missing ID'],
    ['client-id', '', 'missing secret'],
    ['   ', 'client-secret', 'blank ID'],
    ['client-id', ' \t ', 'blank secret'],
  ])('keeps YouTube-only description when credentials have %s / %s (%s)', async (clientId, clientSecret) => {
    const { Play } = await loadSpotifyBindingHarness(clientId, clientSecret);
    const command = new Play(undefined as never, {} as never, {} as never);
    const queryOption = command.slashCommand.toJSON().options?.find((option) => option.name === 'query');

    expect(queryOption?.description).toBe('YouTube URL or search query');
  });
});

describe('OPS-12 Spotify token lifecycle', () => {
  const drainCredentialRetries = async () => {
    for (let step = 0; step < 10; step++) {
      vi.advanceTimersByTime(1);
      await flushAsyncWork();
    }
    vi.advanceTimersByTime(31_000);
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('installs the token, refreshes at half-life, and cleans up the pending timer', async () => {
    dependencyMocks.spotifyClientCredentialsGrant
      .mockResolvedValueOnce({ body: { access_token: 'token-one', expires_in: 120 } })
      .mockResolvedValueOnce({ body: { access_token: 'token-two', expires_in: 240 } });
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const service = new ThirdParty({
      SPOTIFY_CLIENT_ID: 'client-id',
      SPOTIFY_CLIENT_SECRET: 'client-secret',
    } as never);
    await flushAsyncWork();

    expect(dependencyMocks.spotifyConstructorOptions).toEqual([
      {
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
    ]);
    expect(dependencyMocks.spotifySetAccessToken).toHaveBeenNthCalledWith(1, 'token-one');
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(60_000);
    await flushAsyncWork();

    expect(dependencyMocks.spotifyClientCredentialsGrant).toHaveBeenCalledTimes(2);
    expect(dependencyMocks.spotifySetAccessToken).toHaveBeenNthCalledWith(2, 'token-two');
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 120_000);
    expect(vi.getTimerCount()).toBe(1);

    service.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds credential-grant retry to five retries before a successful sixth attempt', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      dependencyMocks.spotifyClientCredentialsGrant.mockRejectedValueOnce(new Error(`attempt ${attempt + 1}`));
    }

    dependencyMocks.spotifyClientCredentialsGrant.mockResolvedValueOnce({
      body: { access_token: 'eventual-token', expires_in: 120 },
    });
    const service = new ThirdParty({
      SPOTIFY_CLIENT_ID: 'client-id',
      SPOTIFY_CLIENT_SECRET: 'client-secret',
    } as never);
    await flushAsyncWork();

    await drainCredentialRetries();
    await flushAsyncWork();

    expect(dependencyMocks.spotifyClientCredentialsGrant).toHaveBeenCalledTimes(6);
    expect(dependencyMocks.spotifySetAccessToken).toHaveBeenCalledOnce();
    expect(dependencyMocks.spotifySetAccessToken).toHaveBeenCalledWith('eventual-token');
    expect(vi.getTimerCount()).toBe(1);

    service.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs exhausted refresh failure and reschedules one attempt after 60 seconds', async () => {
    dependencyMocks.spotifyClientCredentialsGrant.mockRejectedValue(new Error('Spotify auth unavailable'));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const service = new ThirdParty({
      SPOTIFY_CLIENT_ID: 'client-id',
      SPOTIFY_CLIENT_SECRET: 'client-secret',
    } as never);
    await flushAsyncWork();

    await drainCredentialRetries();
    await flushAsyncWork();

    expect(dependencyMocks.spotifyClientCredentialsGrant).toHaveBeenCalledTimes(6);
    expect(dependencyMocks.spotifySetAccessToken).not.toHaveBeenCalled();
    expect(dependencyMocks.debug).toHaveBeenCalledWith(
      'Spotify token refresh failed: %O',
      expect.objectContaining({ message: 'Spotify auth unavailable' }),
    );
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    expect(vi.getTimerCount()).toBe(1);

    service.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('OPS-13 transient voice recovery', () => {
  it.each(['connecting', 'signalling'])(
    'keeps a 4014 connection when it recovers through %s',
    async (recoveredStatus) => {
      const never = new Promise<void>(() => undefined);
      dependencyMocks.entersState.mockImplementation(async (_connection, status: string) =>
        status === recoveredStatus ? undefined : never,
      );
      const { connection } = makeVoiceConnection({
        state: {
          status: 'disconnected',
          reason: 'websocket-close',
          closeCode: 4014,
        },
      });
      const player = new Player({} as never, GUILD_ID);
      player.voiceConnection = connection as never;

      await getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);

      expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'connecting', 5_000);
      expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'signalling', 5_000);
      expect(connection.destroy).not.toHaveBeenCalled();
      expect(player.voiceConnection).toBe(connection as never);
    },
  );

  it('destroys a 4014 connection when both five-second recovery waits time out', async () => {
    dependencyMocks.entersState.mockRejectedValue(new Error('recovery timed out'));
    const { connection } = makeVoiceConnection({
      state: {
        status: 'disconnected',
        reason: 'websocket-close',
        closeCode: 4014,
      },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    await getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);

    expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'connecting', 5_000);
    expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'signalling', 5_000);
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
  });

  it('does not disconnect a replacement when an old 4014 recovery wait later times out', async () => {
    const oldRecovery = makeDeferred<void>();
    dependencyMocks.entersState.mockReturnValue(oldRecovery.promise);
    const { connection: oldConnection } = makeVoiceConnection({
      state: {
        status: 'disconnected',
        reason: 'websocket-close',
        closeCode: 4014,
      },
    });
    const { connection: replacement } = makeVoiceConnection({
      state: { status: 'disconnected' },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = oldConnection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(oldConnection);
    await flushAsyncWork();
    player.voiceConnection = replacement as never;
    oldRecovery.reject(new Error('old 4014 recovery timed out'));
    await recovery;

    expect(oldConnection.destroy).toHaveBeenCalledOnce();
    expect(replacement.rejoin).not.toHaveBeenCalled();
    expect(replacement.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(replacement as never);
  });

  it('cleans up an old 4014 connection that recovers after it was replaced', async () => {
    const oldRecovery = makeDeferred<void>();
    dependencyMocks.entersState.mockReturnValue(oldRecovery.promise);
    const { connection: oldConnection } = makeVoiceConnection({
      state: {
        status: 'disconnected',
        reason: 'websocket-close',
        closeCode: 4014,
      },
    });
    const { connection: replacement } = makeVoiceConnection({
      state: { status: 'disconnected' },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = oldConnection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(oldConnection);
    await flushAsyncWork();
    player.voiceConnection = replacement as never;
    oldRecovery.resolve(undefined);
    await recovery;

    expect(oldConnection.destroy).toHaveBeenCalledOnce();
    expect(replacement.rejoin).not.toHaveBeenCalled();
    expect(replacement.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(replacement as never);
  });

  it('does not destroy an already Destroyed stale connection or touch its replacement', async () => {
    const { connection: oldConnection } = makeVoiceConnection({
      state: { status: 'destroyed' },
    });
    const { connection: replacement } = makeVoiceConnection({
      state: { status: 'disconnected' },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = replacement as never;

    await getPrivatePlayer(player).onVoiceConnectionDisconnect(oldConnection);

    expect(oldConnection.destroy).not.toHaveBeenCalled();
    expect(replacement.rejoin).not.toHaveBeenCalled();
    expect(replacement.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(replacement as never);
  });

  it('backs off in five-second increments and rejoins below five attempts', async () => {
    const backoff = makeDeferred<void>();
    dependencyMocks.sleep.mockReturnValue(backoff.promise);
    const { connection } = makeVoiceConnection({
      rejoinAttempts: 2,
      state: { status: 'disconnected' },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);
    expect(dependencyMocks.sleep).toHaveBeenCalledWith(15_000);
    backoff.resolve(undefined);
    await recovery;

    expect(connection.rejoin).toHaveBeenCalledOnce();
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(connection as never);
  });

  it('does not destroy a connection that becomes Ready during disconnect backoff', async () => {
    const backoff = makeDeferred<void>();
    dependencyMocks.sleep.mockReturnValue(backoff.promise);
    const { connection } = makeVoiceConnection({
      rejoinAttempts: 1,
      state: { status: 'disconnected' },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);
    expect(dependencyMocks.sleep).toHaveBeenCalledWith(10_000);

    connection.state.status = 'ready';
    backoff.resolve(undefined);
    await recovery;

    expect(connection.rejoin).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(connection as never);
  });

  it('clears a current connection that becomes Destroyed during transient backoff without destroying it again', async () => {
    const backoff = makeDeferred<void>();
    dependencyMocks.sleep.mockReturnValue(backoff.promise);
    const { connection } = makeVoiceConnection({
      rejoinAttempts: 1,
      state: { status: 'disconnected' },
    });
    const player = new Player({} as never, GUILD_ID);
    const audioPlayer = { stop: vi.fn() };
    player.voiceConnection = connection as never;
    Object.assign(player, {
      audioPlayer,
      audioResource: { volume: {} },
      currentChannel: { id: 'old-channel' },
    });

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);
    connection.state.status = 'destroyed';
    backoff.resolve(undefined);
    await recovery;

    const state = player as unknown as {
      audioPlayer: object | null;
      audioResource: object | null;
      currentChannel?: object;
    };
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(connection.rejoin).not.toHaveBeenCalled();
    expect(audioPlayer.stop).toHaveBeenCalledWith(true);
    expect(player.voiceConnection).toBeNull();
    expect(state.audioPlayer).toBeNull();
    expect(state.audioResource).toBeNull();
    expect(state.currentChannel).toBeUndefined();
  });

  it('does not rejoin or destroy a replacement when an old transient backoff later releases', async () => {
    const backoff = makeDeferred<void>();
    dependencyMocks.sleep.mockReturnValue(backoff.promise);
    const { connection: oldConnection } = makeVoiceConnection({
      rejoinAttempts: 1,
      state: { status: 'disconnected' },
    });
    const { connection: replacement } = makeVoiceConnection({
      rejoinAttempts: 0,
      state: { status: 'disconnected' },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = oldConnection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(oldConnection);
    expect(dependencyMocks.sleep).toHaveBeenCalledWith(10_000);
    player.voiceConnection = replacement as never;
    backoff.resolve(undefined);
    await recovery;

    expect(oldConnection.rejoin).not.toHaveBeenCalled();
    expect(oldConnection.destroy).toHaveBeenCalledOnce();
    expect(replacement.rejoin).not.toHaveBeenCalled();
    expect(replacement.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(replacement as never);
  });

  it('clears a current 4014 connection already Destroyed when its recovery wait rejects', async () => {
    const oldRecovery = makeDeferred<void>();
    dependencyMocks.entersState.mockReturnValue(oldRecovery.promise);
    const { connection } = makeVoiceConnection({
      state: {
        status: 'disconnected',
        reason: 'websocket-close',
        closeCode: 4014,
      },
    });
    const player = new Player({} as never, GUILD_ID);
    const audioPlayer = { stop: vi.fn() };
    player.voiceConnection = connection as never;
    Object.assign(player, {
      audioPlayer,
      audioResource: { volume: {} },
      currentChannel: { id: 'old-channel' },
    });

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);
    await flushAsyncWork();
    connection.state.status = 'destroyed';
    oldRecovery.reject(new Error('4014 recovery ended after destruction'));
    await recovery;

    const state = player as unknown as {
      audioPlayer: object | null;
      audioResource: object | null;
      currentChannel?: object;
    };
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(audioPlayer.stop).toHaveBeenCalledWith(true);
    expect(player.voiceConnection).toBeNull();
    expect(state.audioPlayer).toBeNull();
    expect(state.audioResource).toBeNull();
    expect(state.currentChannel).toBeUndefined();
  });

  it('destroys a still-disconnected connection when rejoin fails below five attempts', async () => {
    const { connection } = makeVoiceConnection({
      rejoin: vi.fn(() => false),
      rejoinAttempts: 0,
      state: { status: 'disconnected' },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    await getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);

    expect(dependencyMocks.sleep).toHaveBeenCalledWith(5_000);
    expect(connection.rejoin).toHaveBeenCalledOnce();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
  });

  it('destroys immediately when rejoin attempts are exhausted', async () => {
    const { connection } = makeVoiceConnection({
      rejoinAttempts: 5,
      state: { status: 'disconnected' },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    await getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);

    expect(dependencyMocks.sleep).not.toHaveBeenCalled();
    expect(connection.rejoin).not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
  });

  it('keeps a newer connection when an older initial Ready wait rejects and ignores the old Ready callback', async () => {
    const readyA = makeDeferred<void>();
    const readyB = makeDeferred<void>();
    const { connection: connectionA, handlers: handlersA } = makeVoiceConnection({
      rejoinAttempts: 2,
      state: { status: 'connecting' },
    });
    const { connection: connectionB } = makeVoiceConnection({
      state: { status: 'connecting' },
    });
    dependencyMocks.joinVoiceChannel.mockReturnValueOnce(connectionA).mockReturnValueOnce(connectionB);
    dependencyMocks.entersState.mockImplementation((_connection: unknown) =>
      _connection === connectionA ? readyA.promise : readyB.promise,
    );
    const player = new Player({} as never, GUILD_ID);
    const registerVoiceActivityListener = vi.spyOn(player, 'registerVoiceActivityListener');
    const channelA = {
      id: 'voice-channel-a',
      guild: { id: GUILD_ID, voiceAdapterCreator: {} },
    };
    const channelB = {
      id: 'voice-channel-b',
      guild: { id: GUILD_ID, voiceAdapterCreator: {} },
    };

    const connectingA = player.connect(channelA as never);
    await flushAsyncWork();
    const connectingB = player.connect(channelB as never);
    await flushAsyncWork();
    expect(player.voiceConnection).toBe(connectionB as never);

    handlersA.get('stateChange')!({ status: 'connecting' }, { status: 'ready' });
    connectionA.state.status = 'disconnected';
    readyA.reject(new Error('connection A Ready timeout'));
    await expect(connectingA).rejects.toThrow(
      'Failed to connect to the voice channel (last state: disconnected, rejoin attempts: 2, recent states: connecting -> ready).',
    );

    readyB.resolve(undefined);
    await connectingB;

    expect(connectionA.destroy).toHaveBeenCalled();
    expect(connectionB.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(connectionB as never);
    expect(registerVoiceActivityListener).not.toHaveBeenCalled();
  });

  it('uses a 60-second initial Ready wait and preserves status, attempts, and recent-state diagnostics', async () => {
    const ready = makeDeferred<void>();
    dependencyMocks.entersState.mockReturnValue(ready.promise);
    const { connection, handlers } = makeVoiceConnection({
      rejoinAttempts: 3,
      state: { status: 'connecting' },
    });
    dependencyMocks.joinVoiceChannel.mockReturnValue(connection);
    const player = new Player({} as never, GUILD_ID);
    const channel = {
      id: 'voice-channel-id',
      guild: {
        id: GUILD_ID,
        voiceAdapterCreator: {},
      },
    };

    const connecting = player.connect(channel as never);
    await flushAsyncWork();
    expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'ready', 60_000);

    handlers.get('stateChange')!({ status: 'connecting' }, { status: 'signalling' });
    handlers.get('stateChange')!({ status: 'signalling' }, { status: 'disconnected' });
    connection.state.status = 'disconnected';
    ready.reject(new Error('initial Ready timeout'));

    await expect(connecting).rejects.toThrow(
      'Failed to connect to the voice channel (last state: disconnected, rejoin attempts: 3, recent states: connecting -> signalling -> disconnected).',
    );
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
  });
});
