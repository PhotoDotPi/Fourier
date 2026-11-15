import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import LavalinkBackend from '../src/services/lavalinkBackend.js';
import { STATUS } from '../src/services/playerTypes.js';

const makeSong = (overrides: Partial<Record<string, unknown>> = {}) => ({
  title: 't',
  artist: 'a',
  url: 'u',
  length: 10,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: 0,
  encodedTrack: 'enc',
  addedInChannelId: 'c',
  requestedBy: 'r',
  ...overrides,
});

const makeFakePlayer = () => {
  const player = new EventEmitter() as EventEmitter & {
    position: number;
    playTrack: (...args: unknown[]) => Promise<void>;
    seekTo: (ms: number) => Promise<void>;
    setPaused: (v: boolean) => Promise<void>;
    setGlobalVolume: (v: number) => Promise<void>;
    stopTrack: () => Promise<void>;
  };
  player.position = 0;
  player.playTrack = async () => {};
  player.seekTo = async (ms: number) => {
    player.position = ms;
  };
  player.setPaused = async () => {};
  player.setGlobalVolume = async () => {};
  player.stopTrack = async () => {};
  return player;
};

const makeService = (
  player: ReturnType<typeof makeFakePlayer>,
  resolveEncoded?: (s: unknown) => Promise<string | null>,
) => {
  const service = {
    joinVoiceChannel: async () => player,
    leaveVoiceChannel: async () => {},
    resolveEncoded: resolveEncoded ?? (async () => 'enc'),
    markGuildFallback: () => {},
    lavalinkPlayCount: 0,
  } as unknown;
  return service;
};

describe('LavalinkBackend', () => {
  it('plays and invokes onTrackStart', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    let started: unknown = null;
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
      onTrackStart: (s) => {
        started = s;
      },
    });
    await backend.connect({} as never);
    await backend.play();
    expect(backend.getStatus()).toBe(STATUS.PLAYING);
    expect(started).toBe(song);
  });

  it('emits backend trackStart on player start event', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
    });
    await backend.connect({} as never);
    await backend.play();
    let emitted = 0;
    backend.on('trackStart', () => {
      emitted += 1;
    });
    player.emit('start', {});
    expect(emitted).toBe(1);
  });

  it('maps end finished to onTrackEnd finished', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    let endReason: string | null = null;
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
      onTrackEnd: (_s, r) => {
        endReason = r;
      },
    });
    await backend.connect({} as never);
    await backend.play();
    player.emit('end', { reason: 'finished' });
    expect(endReason === 'finished').toBe(true);
  });

  it('maps exception event', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    let errored = false;
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
      onTrackException: () => {
        errored = true;
      },
    });
    await backend.connect({} as never);
    await backend.play();
    player.emit('exception', { exception: { message: 'boom' } });
    expect(errored).toBe(true);
  });

  it('maps stuck event', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    let stuckMs = 0;
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
      onTrackStuck: (_s, ms) => {
        stuckMs = ms;
      },
    });
    await backend.connect({} as never);
    await backend.play();
    player.emit('stuck', { thresholdMs: 5000 });
    expect(stuckMs).toBe(5000);
  });

  it('updates position on update event', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
    });
    await backend.connect({} as never);
    await backend.play();
    player.emit('update', { state: { position: 3000 } });
    expect(backend.getPosition()).toBeGreaterThanOrEqual(3);
  });

  it('emits nodeDisconnected on closed', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
    });
    await backend.connect({} as never);
    await backend.play();
    let disconnected = false;
    backend.on('nodeDisconnected', () => {
      disconnected = true;
    });
    player.emit('closed', {});
    expect(disconnected).toBe(true);
  });

  it('throws when no encoded track available', async () => {
    const player = makeFakePlayer();
    const service = makeService(player, async () => null);
    const song = makeSong({ encodedTrack: null });
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
    });
    await backend.connect({} as never);
    let threw = false;
    try {
      await backend.play();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('getPosition interpolates from player updates', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
    });
    await backend.connect({} as never);
    await backend.play();
    (backend as unknown as { position: number }).position = 2;
    (backend as unknown as { lastPlayerUpdateAt: number }).lastPlayerUpdateAt = Date.now() - 1000;
    const pos = backend.getPosition();
    expect(pos).toBeGreaterThanOrEqual(2);
  });

  it('seek clamps to track length', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
    });
    await backend.connect({} as never);
    await backend.play();
    await backend.seek(100);
    expect(backend.getPosition()).toBeLessThanOrEqual(10);
  });

  it('pause/resume update status', async () => {
    const player = makeFakePlayer();
    const service = makeService(player);
    const song = makeSong();
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
    });
    await backend.connect({} as never);
    await backend.play();
    backend.pause();
    expect(backend.getStatus()).toBe(STATUS.PAUSED);
    backend.resume();
    expect(backend.getStatus()).toBe(STATUS.PLAYING);
  });

  it('volume scales to lavalink range', async () => {
    const player = makeFakePlayer();
    let vol = 0;
    player.setGlobalVolume = async (v: number) => {
      vol = v;
    };
    const service = makeService(player);
    const song = makeSong();
    const backend = new LavalinkBackend({
      guildId: 'g',
      service: service as never,
      getCurrent: () => song as never,
      getCurrentEntryId: () => 1,
    });
    await backend.connect({} as never);
    await backend.play();
    backend.setVolume(50);
    expect(vol).toBe(500);
  });
});

describe('Lavalink integration (skipped unless LAVALINK_NODES)', () => {
  it.skip('placeholder', () => {});
});
