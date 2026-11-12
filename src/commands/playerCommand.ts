import type { ChatInputCommandInteraction } from 'discord.js';
import type PlayerManager from '../managers/player.js';
import type NowPlayingPresenter from '../services/nowPlayingPresenter.js';
import type Player from '../services/player.js';
import type Command from './index.js';

export abstract class PlayerCommand implements Command {
  public abstract readonly slashCommand: Command['slashCommand'];

  public constructor(protected readonly playerManager: PlayerManager) {}

  public abstract execute(interaction: ChatInputCommandInteraction): Promise<void>;

  protected getPlayer(interaction: { guild: { id: string } | null }): Player {
    return this.playerManager.get(interaction.guild!.id);
  }

  protected getConnectedPlayer(interaction: { guild: { id: string } | null }): Player {
    const player = this.getPlayer(interaction);

    if (!player.voiceConnection) {
      throw new Error('not connected');
    }

    return player;
  }
}

export abstract class VoicePlayerCommand extends PlayerCommand {
  public readonly requiresVC = true;
}

export abstract class PresenterPlayerCommand extends PlayerCommand {
  public constructor(
    playerManager: PlayerManager,
    protected readonly presenter: NowPlayingPresenter,
  ) {
    super(playerManager);
  }
}

export abstract class VoicePresenterPlayerCommand extends PresenterPlayerCommand {
  public readonly requiresVC = true;
}
