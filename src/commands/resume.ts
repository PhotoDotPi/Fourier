import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { STATUS } from '../services/player.js';
import { getMemberVoiceChannel, getMostPopularVoiceChannel } from '../utils/channels.js';
import { VoicePresenterPlayerCommand } from './playerCommand.js';

export default class Resume extends VoicePresenterPlayerCommand {
  public readonly slashCommand = new SlashCommandBuilder().setName('resume').setDescription('resume playback');

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.getPlayer(interaction);
    const [targetVoiceChannel] =
      getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);
    if (player.status === STATUS.PLAYING) {
      throw new Error('already playing, give me a song name');
    }

    if (!player.getCurrent()) {
      throw new Error('nothing to play');
    }

    await interaction.deferReply();
    await player.connect(targetVoiceChannel);
    await player.play();
    if (!player.getCurrent()) {
      throw new Error('no playable songs found');
    }

    await this.presenter.editPlaying(interaction, player);
  }
}
