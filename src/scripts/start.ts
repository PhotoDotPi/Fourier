import { startBot } from '../index.js';
import logBanner from '../utils/logBanner.js';

(async () => {
  await logBanner();
  await startBot();
})();
