import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const harness = {
  startBot: vi.fn().mockResolvedValue(undefined),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  sqlClose: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
});

mock.module('../src/utils/spinner.js', () => ({
  default: vi.fn(() => ({
    fail: vi.fn(),
    start: vi.fn(() => spinner),
    succeed: vi.fn(),
  })),
}));

const spinner = { fail: vi.fn(), start: vi.fn(), succeed: vi.fn() };

mock.module('../src/db/client.js', () => ({
  sql: { close: harness.sqlClose },
}));

mock.module('../src/db/migrations.js', () => ({
  runMigrations: harness.runMigrations,
}));

mock.module('../src/index.js', () => ({ startBot: harness.startBot }));
mock.module('../src/utils/logBanner.js', () => ({ default: vi.fn() }));

describe('migration orchestration', () => {
  it('runs migrations and starts bot on successful startup', async () => {
    await import('../src/scripts/migrateAndStart.js');

    let attempts = 0;
    while (attempts < 50 && harness.startBot.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      attempts++;
    }
    expect(harness.startBot).toHaveBeenCalledOnce();
    expect(harness.runMigrations).toHaveBeenCalledWith('./migrations/pg');
  });

  it('propagates migration failures as errors instead of starting the bot', async () => {
    const failure = new Error('connection refused');
    harness.runMigrations.mockRejectedValueOnce(failure);

    await expect(harness.runMigrations('./migrations/pg')).rejects.toBe(failure);
    expect(harness.startBot).not.toHaveBeenCalled();
  });
});
