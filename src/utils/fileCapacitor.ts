import { randomBytes } from 'node:crypto';
import { closeSync, openSync, read, unlinkSync, write } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

class ReadAfterDestroyedError extends Error {}
class ReadAfterReleasedError extends Error {}

interface FileCapacitorOptions {
  highWaterMark?: number;
  defaultEncoding?: BufferEncoding;
  tmpdir?: string;
}

class ReadStream extends Readable {
  private _pos = 0;
  private readonly _capacitor: WriteStream;

  constructor(capacitor: WriteStream, options?: { highWaterMark?: number; encoding?: BufferEncoding }) {
    super({
      highWaterMark: options?.highWaterMark,
      encoding: options?.encoding,
      autoDestroy: true,
    });
    this._capacitor = capacitor;
  }

  _read(n: number): void {
    if (this.destroyed) {
      return;
    }

    const capacitor = this._capacitor;

    if (capacitor.destroyed) {
      this.destroy(capacitor.errored ?? undefined);
      return;
    }

    const fd = capacitor.fd;
    if (fd === null) {
      const retry = () => {
        capacitor.off('ready', retry);
        this._read(n);
      };
      capacitor.on('ready', retry);
      return;
    }

    const buffer = Buffer.alloc(n);
    read(fd, buffer, 0, n, this._pos, (error, bytesRead) => {
      if (this.destroyed) {
        return;
      }

      if (error) {
        this.destroy(error);
        return;
      }

      if (bytesRead > 0) {
        this._pos += bytesRead;
        this.push(buffer.slice(0, bytesRead));
        return;
      }

      if (capacitor.writableFinished) {
        if (this._pos < capacitor.position) {
          this._read(n);
          return;
        }
        this.push(null);
        return;
      }

      const retry = () => {
        capacitor.off('write', retry);
        capacitor.off('finish', retry);
        this._read(n);
      };

      capacitor.on('write', retry);
      capacitor.on('finish', retry);
    });
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this._capacitor.readStreams.delete(this);
    callback(error);
  }
}

export class WriteStream extends Writable {
  fd: number | null = null;
  private readonly path: string;
  readonly readStreams = new Set<ReadStream>();
  private readonly cleanupSync: () => void;
  private released = false;

  position = 0;

  constructor(options?: FileCapacitorOptions) {
    super({
      highWaterMark: options?.highWaterMark,
      defaultEncoding: options?.defaultEncoding,
      autoDestroy: false,
    });

    this.path = join(options?.tmpdir ?? tmpdir(), `capacitor-${randomBytes(16).toString('hex')}.tmp`);

    try {
      this.fd = openSync(this.path, 'wx+', 0o600);
    } catch (error) {
      this.destroy(error instanceof Error ? error : new Error(String(error)));
      this.cleanupSync = () => {};
      return;
    }

    this.cleanupSync = () => {
      if (this.fd !== null) {
        try {
          closeSync(this.fd);
        } catch {
          // Ignore already-closed descriptors.
        }
        this.fd = null;
      }

      try {
        unlinkSync(this.path);
      } catch {
        // The OS will clean up the temp file eventually.
      }
    };

    process.once('exit', this.cleanupSync);
  }

  _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.fd === null) {
      callback(new Error('File capacitor is not ready'));
      return;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);

    const writeFully = (offset: number, filePosition: number): void => {
      if (offset >= buffer.length) {
        this.position += buffer.length;
        this.emit('write');
        callback();
        return;
      }

      write(this.fd as number, buffer, offset, buffer.length - offset, filePosition, (error, bytesWritten) => {
        if (error) {
          callback(error);
          return;
        }

        if (!bytesWritten) {
          callback(new Error('File capacitor write returned 0 bytes'));
          return;
        }

        writeFully(offset + bytesWritten, filePosition + bytesWritten);
      });
    };

    writeFully(0, this.position);
  }

  _final(callback: (error?: Error | null) => void): void {
    callback();
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    for (const readStream of this.readStreams) {
      readStream.destroy(error ?? undefined);
    }

    process.off('exit', this.cleanupSync);

    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch {
        // Ignore already-closed descriptors.
      }
      this.fd = null;
    }

    try {
      unlinkSync(this.path);
    } catch {
      // The OS will clean up the temp file eventually.
    }

    callback(error);
  }

  createReadStream(options?: { highWaterMark?: number; encoding?: BufferEncoding }): ReadStream {
    if (this.destroyed) {
      throw new ReadAfterDestroyedError('A ReadStream cannot be created from a destroyed WriteStream.');
    }

    if (this.released) {
      throw new ReadAfterReleasedError('A ReadStream cannot be created from a released WriteStream.');
    }

    const readStream = new ReadStream(this, options);
    this.readStreams.add(readStream);
    readStream.once('close', () => {
      this.readStreams.delete(readStream);
      if (this.released && this.readStreams.size === 0 && !this.destroyed) {
        this.destroy();
      }
    });

    return readStream;
  }

  release(): void {
    if (this.released || this.destroyed) {
      return;
    }

    this.released = true;
    if (this.readStreams.size === 0) {
      this.destroy();
    }
  }
}
