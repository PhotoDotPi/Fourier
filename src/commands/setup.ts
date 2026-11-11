import { SlashCommandBuilder } from '@discordjs/builders';
import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  type VoiceChannel,
} from 'discord.js';
import type PlayerPanelManager from '../services/playerPanel.js';
import { buildSuccessEmbed } from '../ui/embeds.js';
import type Command from './index.js';

export default class Setup implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('manage the persistent music player panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('panel')
        .setDescription('set up a persistent music player panel in this server')
        .addChannelOption((option) =>
          option.setName('channel').setDescription('the channel to place the player panel in').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('disable').setDescription('remove the persistent music player panel from this server'),
    );

  public readonly handledButtonIdPrefixes = ['panel:'];

  public readonly handledModalIdPrefixes = ['panel:'];

  private readonly playerPanelManager: PlayerPanelManager;

  constructor(playerPanelManager: PlayerPanelManager) {
    this.playerPanelManager = playerPanelManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    switch (interaction.options.getSubcommand()) {
      case 'panel':
        await this.setupPanel(interaction);
        break;
      case 'disable':
        await this.disablePanel(interaction);
        break;
      default:
        throw new Error('unknown subcommand');
    }
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    await this.playerPanelManager.handleButtonInteraction(interaction);
  }

  public async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    await this.playerPanelManager.handleModalSubmit(interaction);
  }

  private async setupPanel(interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = interaction.options.getChannel('channel', true) as VoiceChannel;

    await this.playerPanelManager.setChannel(interaction.guild!.id, channel);

    await interaction.reply({
      embeds: [buildSuccessEmbed(`Music player panel set up in <#${channel.id}>.`)],
    });
  }

  private async disablePanel(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.playerPanelManager.getConfig(interaction.guild!.id)) {
      throw new Error('no music player panel is set up in this server');
    }

    await this.playerPanelManager.disable(interaction.guild!.id);

    await interaction.reply({
      embeds: [buildSuccessEmbed('Music player panel removed.')],
    });
  }
}
