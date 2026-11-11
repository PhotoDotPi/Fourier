import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { MediaSource, type QueuedSong, STATUS } from '../src/services/player.js';

const fontInitCalls = { value: 0 };
const ORIGINAL_FETCH = globalThis.fetch;

const musicardMocks = {
  Bloom: vi.fn(),
  initializeFonts: vi.fn(() => {
    fontInitCalls.value += 1;
  }),
};

mock.module('musicard', () => ({
  Bloom: musicardMocks.Bloom,
  GlobalFonts: {},
  initializeFonts: musicardMocks.initializeFonts,
  registerFont: vi.fn(),
}));

import MusicCardService from '../src/services/musicCard.js';

const GUILD_ID = 'guild-id';

const makeSong = (overrides: Partial<QueuedSong> = {}): QueuedSong => ({
  title: 'Test track',
  artist: 'Test artist',
  url: 'video-id',
  length: 300,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: MediaSource.Youtube,
  addedInChannelId: 'text-channel-id',
  requestedBy: 'requester-id',
  ...overrides,
});

const makeMeta = (
  overrides: { duration?: number; isLive?: boolean; artworkUrl?: string; explicit?: boolean } = {},
) => ({
  title: 'Test track',
  artist: 'Test artist',
  album: 'Test album',
  duration: overrides.duration ?? 300,
  position: 0,
  artworkUrl: 'https://art.example/600x600bb.jpg',
  explicit: overrides.explicit ?? false,
  thumbnailUrl: 'https://img.example/video.jpg',
  isLive: overrides.isLive ?? false,
  source: MediaSource.Youtube,
  ...overrides,
});

const makePlayer = ({
  song = makeSong(),
  position = 42,
  status = STATUS.PLAYING,
  guildId = GUILD_ID,
}: {
  song?: QueuedSong | null;
  position?: number;
  status?: STATUS;
  guildId?: string;
} = {}) => ({
  guildId,
  status,
  getCurrent: vi.fn(() => song),
  getPosition: vi.fn(() => position),
  getCurrentQueueEntryId: vi.fn(() => 7),
});

const lastBloomCall = () =>
  musicardMocks.Bloom.mock.calls.at(-1)?.[0] as Record<string, unknown> & {
    progressBar: number;
    timeAdjust: { timeStart: string; timeEnd: string };
    trackName: string;
    artistName: string;
    albumArt: string | Buffer;
    styleConfig: {
      artistStyle: { textColor: string };
      trackStyle: { textColor: string };
      timeStyle: { textColor: string };
      progressBarStyle: { barColor: string };
      explicitStyle: { iconColor: string };
    };
    backgroundColor: string;
  };

beforeEach(() => {
  vi.clearAllMocks();
  musicardMocks.Bloom.mockResolvedValue(Buffer.from('fake-card'));
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('music card generation', () => {
  it('renders a card with the frozen brand palette and configured fonts', async () => {
    const service = new MusicCardService();
    const result = await service.generate({
      trackName: 'Test track',
      artistName: 'Test artist',
      albumArt: null,
      duration: 300,
      position: 42,
      isExplicit: false,
      isPaused: false,
    });

    expect(result.buffer).toEqual(Buffer.from('fake-card'));
    expect(musicardMocks.initializeFonts).toHaveBeenCalledOnce();
    const call = lastBloomCall();
    expect(call.trackName).toBe('Test track');
    expect(call.artistName).toBe('Test artist');
    expect(call.albumArt).toContain('via.placeholder.com');
    expect(call.backgroundColor).toBe('black');
    expect(call.styleConfig.trackStyle.textColor).toBe('#ffffff');
    expect(call.styleConfig.artistStyle.textColor).toBe('#b8b8d4');
    expect(call.styleConfig.timeStyle.textColor).toBe('#a0a0c0');
    expect(call.styleConfig.progressBarStyle.barColor).toBe('#9b6cf6');
    expect(call.styleConfig.explicitStyle.iconColor).toBe('#ff4444');
  });

  it('initializes fonts at most once across many renders', async () => {
    const service = new MusicCardService();
    await service.generate({
      trackName: 'a',
      artistName: 'b',
      albumArt: null,
      duration: 10,
      position: 0,
      isExplicit: false,
      isPaused: false,
    });
    await service.generate({
      trackName: 'c',
      artistName: 'd',
      albumArt: null,
      duration: 10,
      position: 0,
      isExplicit: false,
      isPaused: false,
    });

    expect(fontInitCalls.value).toBe(1);
  });
});

describe('music card progress clamping', () => {
  it('clamps a normal position to its percentage', async () => {
    const service = new MusicCardService();
    await service.generate({
      trackName: 'a',
      artistName: 'b',
      albumArt: null,
      duration: 300,
      position: 150,
      isExplicit: false,
      isPaused: false,
    });

    expect(lastBloomCall().progressBar).toBe(50);
  });

  it('clamps position beyond duration to 100', async () => {
    const service = new MusicCardService();
    await service.generate({
      trackName: 'a',
      artistName: 'b',
      albumArt: null,
      duration: 300,
      position: 400,
      isExplicit: false,
      isPaused: false,
    });

    expect(lastBloomCall().progressBar).toBe(100);
  });

  it('clamps negative position to 0', async () => {
    const service = new MusicCardService();
    await service.generate({
      trackName: 'a',
      artistName: 'b',
      albumArt: null,
      duration: 300,
      position: -10,
      isExplicit: false,
      isPaused: false,
    });

    expect(lastBloomCall().progressBar).toBe(0);
  });

  it('renders zero progress when the duration is unknown or zero', async () => {
    const service = new MusicCardService();
    await service.generate({
      trackName: 'a',
      artistName: 'b',
      albumArt: null,
      duration: 0,
      position: 999,
      isExplicit: false,
      isPaused: false,
    });
    await service.generate({
      trackName: 'c',
      artistName: 'd',
      albumArt: null,
      duration: Number.NaN,
      position: 999,
      isExplicit: false,
      isPaused: false,
    });

    expect(musicardMocks.Bloom).toHaveBeenCalledTimes(2);
    expect(lastBloomCall().progressBar).toBe(0);
  });
});

describe('music card time formatting', () => {
  it('formats timestamps as m:ss and includes hours when needed', async () => {
    const service = new MusicCardService();
    await service.generate({
      trackName: 'a',
      artistName: 'b',
      albumArt: null,
      duration: 3661,
      position: 65,
      isExplicit: false,
      isPaused: false,
    });

    const { timeAdjust } = lastBloomCall();
    expect(timeAdjust.timeStart).toBe('1:05');
    expect(timeAdjust.timeEnd).toBe('1:01:01');
  });

  it('defaults malformed positions to 0:00', async () => {
    const service = new MusicCardService();
    await service.generate({
      trackName: 'a',
      artistName: 'b',
      albumArt: null,
      duration: 100,
      position: Number.NaN,
      isExplicit: false,
      isPaused: false,
    });

    expect(lastBloomCall().timeAdjust.timeStart).toBe('0:00');
  });
});

describe('music card title truncation', () => {
  it('truncates long names with an ellipsis for the Bloom labels', async () => {
    const service = new MusicCardService();
    const longTitle = 'a'.repeat(80);
    await service.generate({
      trackName: longTitle,
      artistName: longTitle,
      albumArt: null,
      duration: 100,
      position: 0,
      isExplicit: false,
      isPaused: false,
    });

    const call = lastBloomCall();
    expect(call.trackName.length).toBe(30);
    expect(call.trackName.endsWith('...')).toBe(true);
    expect(call.artistName.length).toBe(30);
  });
});

describe('music card artwork resolution', () => {
  it('buffers remote artwork before handing it to Bloom', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })) as unknown as typeof fetch;
    try {
      const service = new MusicCardService();
      await service.generate({
        trackName: 'a',
        artistName: 'b',
        albumArt: 'https://art.example/cover.jpg',
        duration: 10,
        position: 0,
        isExplicit: false,
        isPaused: false,
      });

      expect(Buffer.isBuffer(lastBloomCall().albumArt)).toBe(true);
      expect((lastBloomCall().albumArt as Buffer).equals(Buffer.from([1, 2, 3]))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back when artwork fetch fails, times out, or returns non-image content', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input));
      if (String(input).includes('broken')) {
        throw new Error('network down');
      }
      if (String(input).includes('html')) {
        return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('', { status: 200, headers: { 'content-type': 'image/png' } });
    }) as unknown as typeof fetch;
    try {
      const service = new MusicCardService();
      await service.generate({
        trackName: 'a',
        artistName: 'b',
        albumArt: 'https://art.example/broken.jpg',
        duration: 10,
        position: 0,
        isExplicit: false,
        isPaused: false,
      });
      await service.generate({
        trackName: 'c',
        artistName: 'd',
        albumArt: 'https://art.example/html.png',
        duration: 10,
        position: 0,
        isExplicit: false,
        isPaused: false,
      });
      await service.generate({
        trackName: 'e',
        artistName: 'f',
        albumArt: 'https://art.example/empty.png',
        duration: 10,
        position: 0,
        isExplicit: false,
        isPaused: false,
      });

      expect(musicardMocks.Bloom).toHaveBeenCalledTimes(3);
      expect(String(lastBloomCall().albumArt)).toContain('via.placeholder.com');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('passes a local buffer through without fetching', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    try {
      const service = new MusicCardService();
      const buffer = Buffer.from([9, 8, 7]);
      await service.generate({
        trackName: 'a',
        artistName: 'b',
        albumArt: buffer,
        duration: 10,
        position: 0,
        isExplicit: false,
        isPaused: false,
      });

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(lastBloomCall().albumArt).toBe(buffer);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('music card generation fallback', () => {
  it('returns null instead of throwing when Bloom fails', async () => {
    musicardMocks.Bloom.mockRejectedValue(new Error('canvas exploded'));

    const service = new MusicCardService();
    await expect(
      service.generateSafe({
        trackName: 'a',
        artistName: 'b',
        albumArt: null,
        duration: 10,
        position: 0,
        isExplicit: false,
        isPaused: false,
      }),
    ).resolves.toBeNull();
  });
});

describe('music card caching', () => {
  it('reuses a cached card within the same 30-second progress bucket', async () => {
    const service = new MusicCardService();
    const player = makePlayer({ position: 95 });

    const first = await service.getOrGenerateForPlayer(player as never, makeMeta());
    const sameBucket = await service.getOrGenerateForPlayer(player as never, makeMeta());

    expect(first).toEqual({ buffer: Buffer.from('fake-card') });
    expect(sameBucket).toBe(first);
    expect(musicardMocks.Bloom).toHaveBeenCalledOnce();
  });

  it('re-renders when the progress bucket, status, or artwork changes', async () => {
    const service = new MusicCardService();
    const player = makePlayer({ position: 95 });
    const meta = makeMeta();

    await service.getOrGenerateForPlayer(player as never, meta);
    await service.getOrGenerateForPlayer(makePlayer({ position: 129 }) as never, meta);
    await service.getOrGenerateForPlayer(makePlayer({ status: STATUS.PAUSED }) as never, meta);
    await service.getOrGenerateForPlayer(player as never, makeMeta({ artworkUrl: 'https://other.example/art.jpg' }));

    expect(musicardMocks.Bloom).toHaveBeenCalledTimes(4);
  });

  it('isolates cache entries per guild', async () => {
    const service = new MusicCardService();

    await service.getOrGenerateForPlayer(makePlayer({ guildId: 'guild-a' }) as never, makeMeta());
    await service.getOrGenerateForPlayer(makePlayer({ guildId: 'guild-b' }) as never, makeMeta());

    expect(musicardMocks.Bloom).toHaveBeenCalledTimes(2);
  });

  it('trims the cache back after growing beyond the cap', async () => {
    const service = new MusicCardService();
    const cache = (service as unknown as { cache: Map<string, unknown> }).cache;

    for (let index = 0; index < 80; index += 1) {
      const player = makePlayer({ song: makeSong({ url: `video-${index}`, offset: index }) });
      await service.getOrGenerateForPlayer(player as never, makeMeta({ duration: 100 + index }));
      expect(cache.size).toBeLessThanOrEqual(64);
    }
  });

  it('returns null and renders nothing when the track cannot render a card', async () => {
    const service = new MusicCardService();
    const live = await service.getOrGenerateForPlayer(makePlayer() as never, makeMeta({ isLive: true }));
    const zero = await service.getOrGenerateForPlayer(makePlayer() as never, makeMeta({ duration: 0 }));

    expect(live).toEqual({ buffer: Buffer.from('fake-card') });
    expect(zero).toBeNull();
    expect(musicardMocks.Bloom).toHaveBeenCalledTimes(1);
  });

  it('returns null without rendering when no song is current', async () => {
    const service = new MusicCardService();
    const result = await service.getOrGenerateForPlayer(makePlayer({ song: null }) as never, makeMeta());

    expect(result).toBeNull();
    expect(musicardMocks.Bloom).not.toHaveBeenCalled();
  });
});
