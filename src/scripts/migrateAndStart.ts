import { runMigrations } from '../db/migrations.js';
import { startBot } from '../index.js';
import logBanner from '../utils/logBanner.js';
import logError from '../utils/logError.js';
import spinner from '../utils/spinner.js';

(async () => {
  await logBanner();
  const status = spinner('Applying database migrations...');

  try {
    await runMigrations('./migrations/pg');
    status.succeed('Database migrations applied.');
  } catch (error) {
    status.fail('Failed to apply database migrations.');
    logError('Failed to apply database migrations', error);
    process.exit(1);
  }

  await startBot();
})();
