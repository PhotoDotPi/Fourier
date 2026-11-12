import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import type Player from '../services/player.js';
import { buildSeekToolbar } from '../ui/components.js';
import { buildSeekEmbed } from '../utils/buildEmbed.js';

export const getSeekableSong = (player: Player, liveMessage: string) => {
  const currentSong = player.getCurrent();

  if (!currentSong) {
    throw new Error('nothing is playing');
  }

  if (currentSong.isLive) {
    throw new Error(liveMessage);
  }

  return currentSong;
};

export const replyWithSeekEmbed = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  player: Player,
): Promise<void> => {
  await interaction.editReply({
    embeds: [buildSeekEmbed(player)],
    components: buildSeekToolbar(),
  });
};

export const seekAndReply = async (
  interaction: ChatInputCommandInteraction,
  seek: () => Promise<void>,
  player: Player,
): Promise<void> => {
  await Promise.all([seek(), interaction.deferReply()]);
  await replyWithSeekEmbed(interaction, player);
};
