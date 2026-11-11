import { EmbedBuilder } from 'discord.js';

export const EmbedColor = {
  Brand: 0x9b6cf6,
  Error: 0xff5b5b,
  Idle: 0x95a5a6,
  Paused: 0xe67e22,
  Success: 0x2ecc71,
  Warning: 0xf1c40f,
} as const;

export const buildSuccessEmbed = (description: string) =>
  new EmbedBuilder().setColor(EmbedColor.Success).setDescription(description);

export const buildWarningEmbed = (description: string) =>
  new EmbedBuilder().setColor(EmbedColor.Warning).setDescription(description);

export const buildInfoEmbed = (description: string) =>
  new EmbedBuilder().setColor(EmbedColor.Brand).setDescription(description);

export const buildErrorEmbed = (title: string, description: string, footerDetail?: string | null) => {
  const embed = new EmbedBuilder().setColor(EmbedColor.Error).setTitle(title).setDescription(description);

  if (footerDetail) {
    embed.setFooter({ text: footerDetail });
  }

  return embed;
};
