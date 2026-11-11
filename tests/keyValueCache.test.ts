import { describe, expect, it, mock, vi } from 'bun:test';

const FIXED_NOW_MS = Date.parse('2026-07-12T14:00:00.000Z');

const useFixedDate = () => {
  const RealDate = globalThis.Date;
  class FixedDate extends RealDate {
    constructor(...args: never[]) {
      if (args.length === 0) {
        super(FIXED_NOW_MS);
      } else {
        super(...(args as unknown as ConstructorParameters<typeof Date>));
      }
    }

    static now(): number {
      return FIXED_NOW_MS;
    }
  }

  globalThis.Date = FixedDate as unknown as typeof Date;
  return () => {
    globalThis.Date = RealDate;
  };
};

const dbState = {
  findByKey: undefined as ReturnType<typeof makeKvRepo>['findByKey'] | undefined,
  deleteByKey: undefined as ReturnType<typeof makeKvRepo>['deleteByKey'] | undefined,
  upsertKeyValue: undefined as ReturnType<typeof makeKvRepo>['upsertKeyValue'] | undefined,
};

mock.module('../src/db/repositories/keyValueCache.js', () => ({
  findByKey: vi.fn(async (key: string) => dbState.findByKey?.(key) ?? null),
  deleteByKey: vi.fn(async (key: string) => dbState.deleteByKey?.(key)),
  upsertKeyValue: vi.fn(async (key: string, value: string, expiresAt: Date) =>
    dbState.upsertKeyValue?.(key, value, expiresAt),
  ),
}));
mock.module('../src/utils/debug.js', () => ({ default: vi.fn() }));
mock.module('../src/utils/getGuildSettings.js', () => ({ getGuildSettings: vi.fn() }));
mock.module('sponsorblock-api', () => ({
  SponsorBlock: class {
    async getSegments() {
      return [];
    }
  },
  ResponseError: class ResponseError extends Error {
    status: number;

    constructor(status: number, message?: string) {
      super(message ?? `ResponseError: ${status}`);
      this.name = 'ResponseError';
      this.status = status;
    }
  },
}));

const makeKvRepo = () => ({
  findByKey: vi.fn(),
  deleteByKey: vi.fn(),
  upsertKeyValue: vi.fn(),
});

const loadKeyValueCache = async (repo: ReturnType<typeof makeKvRepo>) => {
  dbState.findByKey = repo.findByKey;
  dbState.deleteByKey = repo.deleteByKey;
  dbState.upsertKeyValue = repo.upsertKeyValue;
  const { default: KeyValueCacheProvider } = await import('../src/services/keyValueCache.js');

  return new KeyValueCacheProvider();
};

describe('KeyValueCacheProvider expiration and persistence', () => {
  it('returns an unexpired parsed JSON hit without invoking or rewriting it', async () => {
    const restoreDate = useFixedDate();
    const repo = makeKvRepo();
    repo.findByKey.mockResolvedValue({
      expiresAt: new Date('2026-07-12T14:00:01.000Z'),
      key: 'unexpired-key',
      value: JSON.stringify({ nested: ['cached', 42] }),
    });
    const wrapped = vi.fn().mockResolvedValue({ wrong: true });

    try {
      const cache = await loadKeyValueCache(repo);

      await expect(cache.wrap(wrapped, { expiresIn: 60, key: 'unexpired-key' })).resolves.toEqual({
        nested: ['cached', 42],
      });
      expect(wrapped).not.toHaveBeenCalled();
      expect(repo.deleteByKey).not.toHaveBeenCalled();
      expect(repo.upsertKeyValue).not.toHaveBeenCalled();
    } finally {
      restoreDate();
      vi.clearAllMocks();
      vi.restoreAllMocks();
    }
  });

  it('deletes an expired row before refreshing and persists the replacement JSON', async () => {
    const restoreDate = useFixedDate();
    const repo = makeKvRepo();
    repo.findByKey.mockResolvedValue({
      expiresAt: new Date('2026-07-12T13:59:59.999Z'),
      key: 'expired-key',
      value: JSON.stringify({ stale: true }),
    });
    repo.deleteByKey.mockResolvedValue(undefined);
    repo.upsertKeyValue.mockResolvedValue(undefined);
    const wrapped = vi.fn().mockImplementation(async () => {
      expect(repo.deleteByKey).toHaveBeenCalledWith('expired-key');
      return { fresh: true };
    });

    try {
      const cache = await loadKeyValueCache(repo);

      await expect(cache.wrap(wrapped, { expiresIn: 30, key: 'expired-key' })).resolves.toEqual({ fresh: true });
      expect(repo.upsertKeyValue).toHaveBeenCalledWith(
        'expired-key',
        JSON.stringify({ fresh: true }),
        new Date('2026-07-12T14:00:30.000Z'),
      );
    } finally {
      restoreDate();
      vi.clearAllMocks();
      vi.restoreAllMocks();
    }
  });

  it('upserts a cache miss as JSON with the exact requested expiration', async () => {
    const restoreDate = useFixedDate();
    const repo = makeKvRepo();
    repo.findByKey.mockResolvedValue(null);
    repo.upsertKeyValue.mockResolvedValue(undefined);
    const result = { items: [{ id: 1 }], nullable: null };

    try {
      const cache = await loadKeyValueCache(repo);

      await expect(
        cache.wrap(vi.fn().mockResolvedValue(result), { expiresIn: 75, key: 'cache-miss-key' }),
      ).resolves.toEqual(result);
      expect(repo.deleteByKey).not.toHaveBeenCalled();
      expect(repo.upsertKeyValue).toHaveBeenCalledWith(
        'cache-miss-key',
        JSON.stringify(result),
        new Date('2026-07-12T14:01:15.000Z'),
      );
    } finally {
      restoreDate();
      vi.clearAllMocks();
      vi.restoreAllMocks();
    }
  });
});

describe('key-value cache TTL call-site contracts', () => {
  it('uses one hour for search, details, autocomplete, and SponsorBlock, but one minute for playlist reads', async () => {
    dbState.findByKey = undefined;
    dbState.deleteByKey = undefined;
    dbState.upsertKeyValue = undefined;

    try {
      const [{ default: YoutubeAPI }, { default: Play }, { default: AddQueryToQueue }] = await Promise.all([
        import('../src/services/youtubeApi.js'),
        import('../src/commands/play.js'),
        import('../src/services/addQueryToQueue.js'),
      ]);
      const video = {
        contentDetails: { duration: 'PT3M', videoId: 'video-id' },
        id: 'video-id',
        snippet: {
          channelTitle: 'Test artist',
          description: '',
          liveBroadcastContent: 'none',
          thumbnails: { medium: { url: 'https://img.example/video.jpg' } },
          title: 'Test song',
        },
      };

      const searchCache = {
        wrap: vi
          .fn()
          .mockResolvedValueOnce({ items: [{ id: { videoId: 'video-id' } }] })
          .mockResolvedValueOnce({ items: [video] }),
      };
      const searchApi = new YoutubeAPI({ YOUTUBE_API_KEY: 'isolated-key' } as never, searchCache as never);
      await searchApi.search('isolated query', false);

      const playlistCache = {
        wrap: vi
          .fn()
          .mockResolvedValueOnce({
            items: [
              {
                contentDetails: { itemCount: 1 },
                id: 'playlist-id',
                snippet: { title: 'Test playlist' },
              },
            ],
          })
          .mockResolvedValueOnce({
            items: [{ contentDetails: { videoId: 'video-id' }, id: 'playlist-item-id' }],
          })
          .mockResolvedValueOnce({ items: [video] }),
      };
      const playlistApi = new YoutubeAPI({ YOUTUBE_API_KEY: 'isolated-key' } as never, playlistCache as never);
      await playlistApi.getPlaylist('playlist-id', false);

      const autocompleteCache = { wrap: vi.fn().mockResolvedValue([]) };
      const play = new Play(undefined as never, autocompleteCache as never, {} as never);
      const autocompleteInteraction = {
        options: { getString: vi.fn(() => 'isolated query') },
        respond: vi.fn().mockResolvedValue(undefined),
      };
      await play.handleAutocompleteInteraction(autocompleteInteraction as never);

      const sponsorBlockCache = { wrap: vi.fn().mockResolvedValue([]) };
      const addQueryToQueue = new AddQueryToQueue(
        {} as never,
        {} as never,
        { ENABLE_SPONSORBLOCK: true, SPONSORBLOCK_TIMEOUT: 5 } as never,
        sponsorBlockCache as never,
        {} as never,
      );
      await (
        addQueryToQueue as unknown as {
          skipNonMusicSegments(song: object): Promise<object>;
        }
      ).skipNonMusicSegments({
        artist: 'Test artist',
        isLive: false,
        length: 180,
        offset: 0,
        playlist: null,
        source: 0,
        thumbnailUrl: null,
        title: 'Test song',
        url: 'video-id',
      });

      const expirationValues = (cacheWrap: ReturnType<typeof vi.fn>) =>
        cacheWrap.mock.calls.map((call) => (call.at(-1) as { expiresIn: number }).expiresIn);
      expect({
        autocomplete: expirationValues(autocompleteCache.wrap),
        playlistMetadataItemsAndDetails: expirationValues(playlistCache.wrap),
        searchAndDetails: expirationValues(searchCache.wrap),
        sponsorBlock: expirationValues(sponsorBlockCache.wrap),
      }).toEqual({
        autocomplete: [3600],
        playlistMetadataItemsAndDetails: [60, 60, 3600],
        searchAndDetails: [3600, 3600],
        sponsorBlock: [3600],
      });
    } finally {
      vi.clearAllMocks();
      vi.restoreAllMocks();
    }
  });
});
