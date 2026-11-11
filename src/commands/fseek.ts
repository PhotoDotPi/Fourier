import { SlashCommandBuilder } from '@discordjs/builders';
import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import { buildSeekToolbar } from '../ui/components.js';
import { buildSeekEmbed } from '../utils/buildEmbed.js';
import durationStringToSeconds from '../utils/durationStringToSeconds.js';
import type Command from './index.js';

export default class ForwardSeek implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('fseek')
    .setDescription('seek forward in the current song')
    .addStringOption((option) =>
      option
        .setName('time')
        .setDescription('an interval expression or number of seconds (1m, 30s, 100)')
        .setRequired(true),
    );

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new Error('nothing is playing');
    }

    if (currentSong.isLive) {
      throw new Error("can't seek in a livestream");
    }

    const seekValue = interaction.options.getString('time');

    if (!seekValue) {
      throw new Error('missing seek value');
    }

    const seekTime = durationStringToSeconds(seekValue);

    if (!Number.isFinite(seekTime) || seekTime <= 0) {
      throw new Error('invalid seek value');
    }

    if (seekTime + player.getPosition() > currentSong.length) {
      throw new Error("can't seek past the end of the song");
    }

    await Promise.all([player.forwardSeek(seekTime), interaction.deferReply()]);

    await interaction.editReply({
      embeds: [buildSeekEmbed(player)],
      components: buildSeekToolbar(),
    });
  }
}
