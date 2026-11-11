import { sql } from '../db/client.js';
import logError from '../utils/logError.js';
import spinner from '../utils/spinner.js';

(async () => {
  const status = spinner('Clearing key value cache...');

  try {
    await sql`DELETE FROM "KeyValueCache"`;
    status.succeed('Key value cache cleared.');
  } catch (error: unknown) {
    status.fail('Failed to clear key value cache.');
    logError('Failed to clear key value cache', error);
    process.exitCode = 1;
  } finally {
    await sql.close();
  }
})();
