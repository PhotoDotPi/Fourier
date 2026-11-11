import { VoiceConnectionStatus } from '@discordjs/voice';
import type { VoiceChannel, VoiceState } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import { getSizeWithoutBots } from '../utils/channels.js';
import { getGuildSettings } from '../utils/getGuildSettings.js';

export default (playerManager: PlayerManager) =>
  async (oldState: VoiceState, newState: VoiceState): Promise<void> => {
    const player = playerManager.get(oldState.guild.id);

    if (!player.voiceConnection || player.voiceConnection.state.status !== VoiceConnectionStatus.Ready) {
      return;
    }

    const { channelId } = player.voiceConnection.joinConfig;
    if (!channelId || (oldState.channelId !== channelId && newState.channelId !== channelId)) {
      return;
    }

    const voiceChannel = newState.guild.channels.cache.get(channelId) as VoiceChannel | undefined;
    const { leaveIfNoListeners } = await getGuildSettings(player.guildId);
    if (!voiceChannel || (getSizeWithoutBots(voiceChannel) === 0 && leaveIfNoListeners)) {
      player.disconnect();
    }
  };
