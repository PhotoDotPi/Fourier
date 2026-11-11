import { SlashCommandBuilder } from '@discordjs/builders';
import type { APIEmbedField, AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { Pagination } from 'pagination.djs';
import * as favoritesRepo from '../db/repositories/favorites.js';
import type AddQueryToQueue from '../services/addQueryToQueue.js';
import { buildInfoEmbed, buildSuccessEmbed } from '../ui/embeds.js';
import type Command from './index.js';

export default class Favorites implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('favorites')
    .setDescription('add a song to your favorites')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('use')
        .setDescription('use a favorite')
        .addStringOption((option) =>
          option.setName('name').setDescription('name of favorite').setRequired(true).setAutocomplete(true),
        )
        .addBooleanOption((option) => option.setName('immediate').setDescription('add track to the front of the queue'))
        .addBooleanOption((option) =>
          option.setName('shuffle').setDescription("shuffle the input if you're adding multiple tracks"),
        )
        .addBooleanOption((option) => option.setName('split').setDescription('if a track has chapters, split it'))
        .addBooleanOption((option) => option.setName('skip').setDescription('skip the currently playing track')),
    )
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('list all favorites'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('create a new favorite')
        .addStringOption((option) =>
          option.setName('name').setDescription("you'll type this when using this favorite").setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('query').setDescription("any input you'd normally give to the play command").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('remove a favorite')
        .addStringOption((option) =>
          option.setName('name').setDescription('name of favorite').setAutocomplete(true).setRequired(true),
        ),
    );

  constructor(private readonly addQueryToQueue: AddQueryToQueue) {}

  requiresVC = (interaction: ChatInputCommandInteraction) => interaction.options.getSubcommand() === 'use';

  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommand()) {
      case 'use':
        await this.use(interaction);
        break;
      case 'list':
        await this.list(interaction);
        break;
      case 'create':
        await this.create(interaction);
        break;
      case 'remove':
        await this.remove(interaction);
        break;
      default:
        throw new Error('unknown subcommand');
    }
  }

  async handleAutocompleteInteraction(interaction: AutocompleteInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const query = interaction.options.getString('name')!.trim();

    const favorites = await favoritesRepo.findByGuildId(interaction.guild!.id);

    let results =
      query === '' ? favorites : favorites.filter((f) => f.name.toLowerCase().startsWith(query.toLowerCase()));

    if (subcommand === 'remove') {
      results =
        interaction.member?.user.id === interaction.guild?.ownerId
          ? results
          : results.filter((r) => r.authorId === interaction.member!.user.id);
    }

    const trimmed = results.length > 25 ? results.slice(0, 25) : results;
    await interaction.respond(
      trimmed.map((r) => ({
        name: r.name,
        value: r.name,
      })),
    );
  }

  private async use(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await favoritesRepo.findByGuildIdAndName(interaction.guild!.id, name);

    if (!favorite) {
      throw new Error('no favorite with that name exists');
    }

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: favorite.query,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
      skipCurrentTrack: interaction.options.getBoolean('skip') ?? false,
    });
  }

  private async list(interaction: ChatInputCommandInteraction) {
    const favorites = await favoritesRepo.findByGuildId(interaction.guild!.id);

    if (favorites.length === 0) {
      await interaction.reply({
        embeds: [buildInfoEmbed("There aren't any favorites in this guild yet. Use `/favorites create` to add one.")],
      });
      return;
    }

    const fields = new Array<APIEmbedField>(favorites.length);
    for (let index = 0; index < favorites.length; index++) {
      const favorite = favorites[index];
      fields[index] = {
        inline: false,
        name: favorite.name,
        value: `${favorite.query} (<@${favorite.authorId}>)`,
      };
    }

    await new Pagination(interaction as ChatInputCommandInteraction<'cached'>, { ephemeral: true, limit: 25 })
      .setFields(fields)
      .paginateFields(true)
      .render();
  }

  private async create(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();
    const query = interaction.options.getString('query')!.trim();

    const existingFavorite = await favoritesRepo.findByGuildIdAndName(interaction.guild!.id, name);

    if (existingFavorite) {
      throw new Error('a favorite with that name already exists');
    }

    await favoritesRepo.createFavorite(interaction.guild!.id, interaction.member!.user.id, name, query);

    await interaction.reply({ embeds: [buildSuccessEmbed(`Favorite **${name}** created.`)] });
  }

  private async remove(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await favoritesRepo.findByGuildIdAndName(interaction.guild!.id, name);

    if (!favorite) {
      throw new Error('no favorite with that name exists');
    }

    const isUserGuildOwner = interaction.member!.user.id === interaction.guild!.ownerId;

    if (favorite.authorId !== interaction.member!.user.id && !isUserGuildOwner) {
      throw new Error('you can only remove your own favorites');
    }

    await favoritesRepo.deleteById(favorite.id);

    await interaction.reply({ embeds: [buildSuccessEmbed(`Favorite **${name}** removed.`)] });
  }
}
