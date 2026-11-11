import { describe, expect, it } from 'bun:test';

const ENV_KEYS = ['DISCORD_TOKEN', 'YOUTUBE_API_KEY', 'DATA_DIR', 'CACHE_LIMIT'] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const setTestEnv = (overrides: Partial<Record<EnvKey, string>>) => {
  for (const key of ENV_KEYS) {
    if (key in overrides) {
      process.env[key] = overrides[key]!;
    } else {
      delete process.env[key];
    }
  }
};

const loadConfig = async (cacheLimit: string) => {
  setTestEnv({
    DISCORD_TOKEN: 'test-discord-token',
    YOUTUBE_API_KEY: 'test-youtube-key',
    DATA_DIR: '/tmp/fourier-config-test',
    CACHE_LIMIT: cacheLimit,
  });
  const bust = Date.now();
  const { default: Config } = await import(`../src/services/config.js?t=${bust}`);
  return Config;
};

describe('Config cache limit validation', () => {
  it('rejects a negative cache limit with a clear error', async () => {
    const Config = await loadConfig('-1B');

    expect(() => new Config()).toThrow(/CACHE_LIMIT_IN_BYTES.*non-negative/i);
  });

  it('accepts a zero-byte cache limit', async () => {
    const Config = await loadConfig('0B');

    expect(new Config().CACHE_LIMIT_IN_BYTES).toBe(0);
  });
});
