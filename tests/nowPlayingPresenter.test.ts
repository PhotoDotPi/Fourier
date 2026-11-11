import { describe, expect, it, vi } from 'bun:test';
import type MusicCardService from '../src/services/musicCard.js';
import type { MusicCardResult } from '../src/services/musicCard.js';
import NowPlayingPresenter from '../src/services/nowPlayingPresenter.js';
import Player, { MediaSource, type QueuedSong, STATUS } from '../src/services/player.js';

const GUILD_ID = 'guild-id';

const makeSong = (overrides: Partial<QueuedSong> = {}): QueuedSong => ({
  title: 'Test track',
  artist: 'Test artist',
  url: 'video-id',
  length: 300,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: 'https://img.example/video.jpg',
  source: MediaSource.Youtube,
  addedInChannelId: 'text-channel-id',
  requestedBy: 'requester-id',
  ...overrides,
});

const makeCard = (): MusicCardResult => ({ buffer: Buffer.from('card') });

const makeMusicCardService = (card: MusicCardResult | null = makeCard()): MusicCardService =>
  ({
    getOrGenerateForPlayer: vi.fn().mockResolvedValue(card),
  }) as unknown as MusicCardService;

const makePausedPlayer = (song: QueuedSong | null = makeSong()): Player => {
  const player = new Player({} as never, GUILD_ID);
  if (song) {
    player.add(song);
  }
  player.status = STATUS.PAUSED;
  return player;
};

const makeInteraction = (isButton = false) => ({
  deferred: false,
  replied: false,
  deferReply: vi.fn().mockResolvedValue(undefined),
  deferUpdate: vi.fn().mockResolvedValue(undefined),
  deleteReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  isButton: () => isButton,
  isModalSubmit: () => false,
  reply: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
});

describe('NowPlayingPresenter playing payload', () => {
  it('throws when there is no current song', async () => {
    const presenter = new NowPlayingPresenter(makeMusicCardService(), null);
    const player = makePausedPlayer(null);

    await expect(presenter.buildPlayingPayloadGuarded(player)).rejects.toThrow('No playing song found');
  });

  it('builds an embed, music card attachment, and two rows of player controls', async () => {
    const presenter = new NowPlayingPresenter(makeMusicCardService(), null);
    const player = makePausedPlayer();

    const payload = await presenter.buildPlayingPayloadGuarded(player);

    expect(payload).not.toBeNull();
    expect(payload?.embeds).toHaveLength(1);
    expect(payload?.files).toHaveLength(1);
    expect(payload?.files[0].name).toBe('now-playing.png');
    expect(payload?.components).toHaveLength(2);
  });

  it('returns null when the queue entry changes while the card is rendering', async () => {
    const player = {
      guildId: GUILD_ID,
      status: STATUS.PLAYING,
      getCurrent: () => makeSong(),
      getPosition: () => 0,
      getCurrentQueueEntryId: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(1).mockReturnValueOnce(2),
    };
    const musicCard = {
      getOrGenerateForPlayer: vi.fn().mockResolvedValue(makeCard()),
    } as unknown as MusicCardService;
    const presenter = new NowPlayingPresenter(musicCard, null);

    const payload = await presenter.buildPlayingPayloadGuarded(player as never);

    expect(payload).toBeNull();
    expect(musicCard.getOrGenerateForPlayer).toHaveBeenCalledOnce();
  });

  it('skips the card render entirely when the queue entry changed earlier', async () => {
    const player = {
      guildId: GUILD_ID,
      status: STATUS.PLAYING,
      getCurrent: () => makeSong(),
      getPosition: () => 0,
      getCurrentQueueEntryId: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2),
    };
    const musicCard = {
      getOrGenerateForPlayer: vi.fn().mockResolvedValue(makeCard()),
    } as unknown as MusicCardService;
    const presenter = new NowPlayingPresenter(musicCard, null);

    const payload = await presenter.buildPlayingPayloadGuarded(player as never);

    expect(payload).toBeNull();
    expect(musicCard.getOrGenerateForPlayer).not.toHaveBeenCalled();
  });

  it('returns a panel payload with the panel controls and speaking indicator support', async () => {
    const player = makePausedPlayer();
    const presenter = new NowPlayingPresenter(makeMusicCardService(), null);

    const payload = await presenter.buildPanelPayloadGuarded(player);

    expect(payload).not.toBeNull();
    expect(payload?.embeds).toHaveLength(1);
    expect(payload?.files).toHaveLength(1);
    expect(payload?.components).toHaveLength(2);
  });

  it('returns a panel payload with no current song as null', async () => {
    const presenter = new NowPlayingPresenter(makeMusicCardService(), null);

    const payload = await presenter.buildPanelPayloadGuarded(makePausedPlayer(null));

    expect(payload).toBeNull();
  });

  it('acknowledges the interaction before building and edits the deferred reply', async () => {
    const presenter = new NowPlayingPresenter(makeMusicCardService(), null);
    const player = makePausedPlayer();
    const interaction = makeInteraction();

    await presenter.replyPlaying(interaction as never, player);

    expect(interaction.deferReply).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledOnce();
    const options = interaction.editReply.mock.calls[0][0] as {
      embeds: unknown[];
      files: unknown[];
      components: unknown[];
    };
    expect(options.embeds).toHaveLength(1);
    expect(options.files).toHaveLength(1);
    expect(options.components).toHaveLength(2);
  });

  it('removes the deferred reply when the payload was discarded by the concurrency guard', async () => {
    const player = {
      guildId: GUILD_ID,
      status: STATUS.PLAYING,
      getCurrent: () => makeSong(),
      getPosition: () => 0,
      getCurrentQueueEntryId: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2),
    };
    const presenter = new NowPlayingPresenter(makeMusicCardService(), null);
    const interaction = makeInteraction();

    await presenter.replyPlaying(interaction as never, player as never);

    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
  });

  it('defers a button update before editing the interaction message', async () => {
    const presenter = new NowPlayingPresenter(makeMusicCardService(), null);
    const player = makePausedPlayer();
    const interaction = makeInteraction(true);

    await presenter.editPlaying(interaction as never, player);

    expect(interaction.deferUpdate).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it('falls back to editing the deferred reply when appropriate', async () => {
    const presenter = new NowPlayingPresenter(makeMusicCardService(), null);
    const player = makePausedPlayer();
    const interaction = { ...makeInteraction(), deferred: true };

    await presenter.editPlaying(interaction as never, player);

    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
  });
});
