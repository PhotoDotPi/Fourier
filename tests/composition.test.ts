import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';

const ORIGINAL_ENV: NodeJS.ProcessEnv = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
};

const dependencyMocks = {
  spotifyClientCredentialsGrant: mock(() => Promise.reject(new Error('no network in tests'))),
  spotifySetAccessToken: mock(() => {}),
};

mock.module('spotify-web-api-node', () => ({
  default: class {
    clientCredentialsGrant = dependencyMocks.spotifyClientCredentialsGrant;
    setAccessToken = dependencyMocks.spotifySetAccessToken;
  },
}));

beforeAll(() => {
  process.env.DISCORD_TOKEN = 'composition-test-token';
  process.env.YOUTUBE_API_KEY = 'composition-test-key';
  process.env.SPOTIFY_CLIENT_ID = 'client-id';
  process.env.SPOTIFY_CLIENT_SECRET = 'client-secret';
});

afterAll(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('explicit application composition', () => {
  it('constructs the app, wiring all 23 commands with their dependencies', async () => {
    const { createApp } = await import('../src/compose.js');
    const app = createApp();

    expect(app.config).toBeDefined();
    expect(app.client).toBeDefined();
    expect(app.bot).toBeDefined();
    expect(app.playerManager).toBeDefined();
    expect(app.fileCache).toBeDefined();
    expect(app.playerPanelManager).toBeDefined();
    expect(app.playerIntegrations).toBeDefined();

    expect(app.commands).toHaveLength(23);
    const names = app.commands.map((c) => c.slashCommand.name).sort();
    expect(names).toEqual([
      'clear',
      'config',
      'disconnect',
      'favorites',
      'fseek',
      'loop',
      'loop-queue',
      'move',
      'next',
      'now-playing',
      'pause',
      'play',
      'queue',
      'remove',
      'replay',
      'resume',
      'seek',
      'setup',
      'shuffle',
      'skip',
      'stop',
      'unskip',
      'volume',
    ]);
  });

  it('publishes a play command that advertises Spotify when credentials are present', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'client-id';
    process.env.SPOTIFY_CLIENT_SECRET = 'client-secret';

    const { createApp } = await import('../src/compose.js');
    const app = createApp();

    const playCommand = app.commands.find((c) => c.slashCommand.name === 'play');
    const json = playCommand!.slashCommand.toJSON() as {
      options?: Array<{ name: string; description?: string }>;
    };
    const queryOption = json.options?.find((option) => option.name === 'query');
    expect(queryOption?.description).toBe('YouTube URL, Spotify URL, or search query');
  });
});
