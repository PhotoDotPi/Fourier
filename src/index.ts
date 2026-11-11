import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './compose.js';
import handleGuildCreate from './events/guildCreate.js';
import handleVoiceStateUpdate from './events/voiceStateUpdate.js';
import prepareYtDlp from './utils/prepareYtDlp.js';

const startBot = async () => {
  const { config, client, bot, playerManager, commands, fileCache, playerPanelManager } = createApp();

  await mkdir(config.DATA_DIR, { recursive: true });
  await mkdir(config.CACHE_DIR, { recursive: true });
  await mkdir(path.join(config.CACHE_DIR, 'tmp'), { recursive: true });

  await fileCache.cleanup();
  await prepareYtDlp(config);

  const onGuildCreate = handleGuildCreate(config, client, commands);
  const onVoiceStateUpdate = handleVoiceStateUpdate(playerManager);
  const onReady = () => playerPanelManager.init();

  await bot.register(commands, onGuildCreate, onVoiceStateUpdate, onReady);
};

export { startBot };
