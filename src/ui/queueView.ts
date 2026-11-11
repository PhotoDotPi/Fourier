import type { ActionRowBuilder, MessageActionRowComponentBuilder } from 'discord.js';
import type Player from '../services/player.js';
import { buildQueueEmbed } from '../utils/buildEmbed.js';
import { buildQueueComponents } from './components.js';

export const getQueueView = (player: Player, page: number, pageSize: number) => {
  const queueSize = player.queueSize();
  const maxPage = Math.max(1, Math.ceil(queueSize / pageSize));
  const safePage = Math.min(Math.max(1, page), maxPage);
  const canShuffle = typeof player.isQueueEmpty === 'function' ? !player.isQueueEmpty() : player.queueSize() > 0;

  return {
    embeds: [buildQueueEmbed(player, safePage, pageSize)],
    components: buildQueueComponents({
      page: safePage,
      maxPage,
      canShuffle,
    }) as Array<ActionRowBuilder<MessageActionRowComponentBuilder>>,
  };
};
