import { setTimeout as sleep } from 'node:timers/promises';
import {
  entersState,
  type VoiceConnection,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
} from '@discordjs/voice';

export interface VoiceConnectionRecoveryRuntime {
  waitForState(connection: VoiceConnection, status: VoiceConnectionStatus, timeout: number): Promise<unknown>;
  sleep(delay: number): Promise<unknown>;
}

export interface VoiceConnectionRecoveryOptions {
  runtime?: VoiceConnectionRecoveryRuntime;
  isCurrent(connection: VoiceConnection): boolean;
  dispose(connection: VoiceConnection): void;
}

const defaultRuntime: VoiceConnectionRecoveryRuntime = {
  waitForState: async (connection, status, timeout) => {
    await entersState(connection, status, timeout);
  },
  sleep,
};

const getVoiceConnectionStatus = (connection: VoiceConnection): VoiceConnectionStatus => connection.state.status;

export function destroyVoiceConnection(connection: VoiceConnection): void {
  if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
    connection.destroy();
  }
}

const isDisconnected = (connection: VoiceConnection) => connection.state.status === VoiceConnectionStatus.Disconnected;

const isDestroyed = (connection: VoiceConnection) => connection.state.status === VoiceConnectionStatus.Destroyed;

const isWebSocketClose4014 = (connection: VoiceConnection) => {
  const state = connection.state as { reason?: unknown; closeCode?: unknown };

  return state.reason === VoiceConnectionDisconnectReason.WebSocketClose && state.closeCode === 4014;
};

const handle4014Recovery = async (
  connection: VoiceConnection,
  isCurrent: VoiceConnectionRecoveryOptions['isCurrent'],
  dispose: VoiceConnectionRecoveryOptions['dispose'],
  runtime: VoiceConnectionRecoveryRuntime,
): Promise<void> => {
  try {
    await Promise.race([
      runtime.waitForState(connection, VoiceConnectionStatus.Connecting, 5_000),
      runtime.waitForState(connection, VoiceConnectionStatus.Signalling, 5_000),
    ]);

    if (!isCurrent(connection) || getVoiceConnectionStatus(connection) === VoiceConnectionStatus.Destroyed) {
      dispose(connection);
    }
  } catch {
    dispose(connection);
  }
};

const handleTransientBackoff = async (
  connection: VoiceConnection,
  isCurrent: VoiceConnectionRecoveryOptions['isCurrent'],
  dispose: VoiceConnectionRecoveryOptions['dispose'],
  runtime: VoiceConnectionRecoveryRuntime,
): Promise<void> => {
  if (connection.rejoinAttempts >= 5) {
    dispose(connection);
    return;
  }

  await runtime.sleep((connection.rejoinAttempts + 1) * 5_000);

  if (!isCurrent(connection)) {
    dispose(connection);
    return;
  }

  const connectionStatus = getVoiceConnectionStatus(connection);

  if (connectionStatus !== VoiceConnectionStatus.Disconnected) {
    if (connectionStatus === VoiceConnectionStatus.Destroyed) {
      dispose(connection);
    }

    return;
  }

  if (connection.rejoin()) {
    return;
  }

  dispose(connection);
};

export async function recoverVoiceConnection(
  connection: VoiceConnection,
  { isCurrent, dispose, runtime = defaultRuntime }: VoiceConnectionRecoveryOptions,
): Promise<void> {
  if (!isCurrent(connection)) {
    dispose(connection);
    return;
  }

  if (!isDisconnected(connection)) {
    if (isDestroyed(connection)) {
      dispose(connection);
    }

    return;
  }

  if (isWebSocketClose4014(connection)) {
    await handle4014Recovery(connection, isCurrent, dispose, runtime);
    return;
  }

  await handleTransientBackoff(connection, isCurrent, dispose, runtime);
}
