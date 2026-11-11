import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import type NowPlayingPresenter from '../services/nowPlayingPresenter.js';
import { STATUS } from '../services/player.js';
import { getMemberVoiceChannel, getMostPopularVoiceChannel } from '../utils/channels.js';
import type Command from './index.js';

export default class Resume implements Command {
  public readonly slashCommand = new SlashCommandBuilder().setName('resume').setDescription('resume playback');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;
  private readonly presenter: NowPlayingPresenter;

  constructor(playerManager: PlayerManager, presenter: NowPlayingPresenter) {
    this.playerManager = playerManager;
    this.presenter = presenter;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);
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
