import { SlashCommandBuilder } from '@discordjs/builders';
import { type ButtonInteraction, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { Glyph } from '../constants/emoji.js';
import type PlayerManager from '../managers/player.js';
import { buildClearConfirmRow, ClearButtonId } from '../ui/components.js';
import { buildInfoEmbed, buildSuccessEmbed, buildWarningEmbed } from '../ui/embeds.js';
import type Command from './index.js';

const CONFIRMATION_EXPIRES_IN_MS = 60_000;

export default class Clear implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('clears all songs in queue except currently playing song');

  public readonly handledButtonIds = Object.values(ClearButtonId);

  public requiresVC = true;

  private readonly playerManager: PlayerManager;
  private readonly pendingClears = new Map<string, number>();

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    this.pruneExpired();

    this.pendingClears.set(guildId, Date.now() + CONFIRMATION_EXPIRES_IN_MS);

    await interaction.reply({
      embeds: [
        buildWarningEmbed('This will remove every song from the queue except the one currently playing.').setTitle(
          `${Glyph.Warning} Clear the queue?`,
        ),
      ],
      components: buildClearConfirmRow(),
      flags: MessageFlags.Ephemeral,
    });
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    const pendingUntil = this.pendingClears.get(guildId);
    const stillPending = pendingUntil !== undefined && Date.now() < pendingUntil;

    switch (interaction.customId) {
      case ClearButtonId.Confirm:
        if (!stillPending) {
          await interaction.update({
            embeds: [buildInfoEmbed('The clear confirmation has expired. Run /clear again to clear the queue.')],
            components: [],
          });
          return;
        }

        this.pendingClears.delete(guildId);
        this.playerManager.get(guildId).clear();
        await interaction.update({
          embeds: [buildSuccessEmbed('Queue cleared.')],
          components: [],
        });
        return;

      case ClearButtonId.Cancel:
        this.pendingClears.delete(guildId);
        await interaction.update({
          embeds: [buildInfoEmbed('The queue was left untouched.')],
          components: [],
        });
        return;

      default:
        throw new Error('unknown button interaction');
    }
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [candidateId, expiresUntil] of this.pendingClears.entries()) {
      if (expiresUntil <= now) {
        this.pendingClears.delete(candidateId);
      }
    }
  }
}
