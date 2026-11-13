import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './compose.js';
import handleGuildCreate from './events/guildCreate.js';
import handleVoiceStateUpdate from './events/voiceStateUpdate.js';
import prepareYtDlp from './utils/prepareYtDlp.js';

const startBot = async () => {
  const app = createApp();

  await mkdir(app.config.DATA_DIR, { recursive: true });
  await mkdir(app.config.CACHE_DIR, { recursive: true });
  await mkdir(path.join(app.config.CACHE_DIR, 'tmp'), { recursive: true });

  await app.fileCache.cleanup();
  await prepareYtDlp(app.config);

  const onGuildCreate = handleGuildCreate(app.config, app.client, app.commands);
  const onVoiceStateUpdate = handleVoiceStateUpdate(app.playerManager);
  const onReady = () => app.playerPanelManager.init();

  await app.bot.register(app.commands, onGuildCreate, onVoiceStateUpdate, onReady);
};

export { startBot };
