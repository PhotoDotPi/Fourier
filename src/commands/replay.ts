import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import { VoicePlayerCommand } from './playerCommand.js';
import { getSeekableSong, seekAndReply } from './seekSupport.js';

export default class Replay extends VoicePlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder().setName('replay').setDescription('replay the current song');

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);
    getSeekableSong(player, "can't replay a livestream");

    await seekAndReply(interaction, () => player.seek(0), player);
  }
}
