import { sql } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { colors } from '../utils/colors.js';
import logError from '../utils/logError.js';

(async () => {
  try {
    await runMigrations('./migrations/pg');
    console.log(colors.brightGreen(`✓ Migrations applied successfully.`));
  } catch (error) {
    logError('Failed to apply migrations', error);
    process.exit(1);
  } finally {
    await sql.close();
  }
})();
