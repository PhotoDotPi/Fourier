import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadStream, ffprobe } from '../src/services/ffmpegProcess.js';

const integrationEnabled = Boolean(process.env.FFMPEG_INTEGRATION);

const SAMPLE_RATE = 44_100;

const writeWavHeader = (view: DataView, dataSize: number) => {
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataSize, true);
};

const createSineWav = (seconds: number): Buffer => {
  const sampleCount = Math.floor(seconds * SAMPLE_RATE);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  writeWavHeader(view, dataSize);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const t = sampleIndex / SAMPLE_RATE;
    const value = Math.round(8_000 * Math.sin(2 * Math.PI * 440 * t));
    view.setInt16(44 + sampleIndex * 2, value, true);
  }

  return buffer;
};

const collectStream = (stream: NodeJS.ReadableStream) =>
  new Promise<number>((resolve, reject) => {
    let bytes = 0;
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(bytes));
  });

describe.skipIf(!integrationEnabled)('ffmpegProcess real binary integration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fourier-ffmpeg-integration-'));
  const wavPath = join(directory, 'sine.wav');

  beforeEach(() => {
    writeFileSync(wavPath, createSineWav(5));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('ffprobe parses a real wav file', async () => {
    const result = await ffprobe(wavPath);
    expect(result.format?.format_name).toMatch(/wav/);
    expect(result.streams?.some((s) => s.codec_type === 'audio')).toBe(true);
  }, 15_000);

  it('createReadStream transcodes a local wav into an Opus webm stream', async () => {
    const stream = await createReadStream({ url: wavPath });
    const bytes = await collectStream(stream);
    expect(bytes).toBeGreaterThan(0);
  }, 15_000);

  it('streams a network URL that only serves small bounded ranges (googlevideo regression)', async () => {
    const audio = createSineWav(5);
    const totalBytes = audio.byteLength;
    const MAX_RANGE = 300_000;
    const requests: string[] = [];

    const server: Server = createServer((request, response) => {
      const range = request.headers.range ?? '<no-range>';
      requests.push(range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) {
        response.writeHead(403).end();
        return;
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      const length = end - start + 1;
      if (start >= totalBytes) {
        response.writeHead(416).end();
        return;
      }
      if (length > MAX_RANGE) {
        response.writeHead(403).end();
        return;
      }
      const actualEnd = Math.min(end, totalBytes - 1);
      const slice = audio.subarray(start, actualEnd + 1);
      response.writeHead(206, {
        'Content-Length': String(slice.byteLength),
        'Content-Range': `bytes ${start}-${actualEnd}/${totalBytes}`,
      });
      response.end(slice);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind a port');
    }
    const url = `http://127.0.0.1:${address.port}/track`;

    try {
      const stream = await createReadStream({ url, networkStream: true });
      const bytes = await collectStream(stream);

      expect(bytes).toBeGreaterThan(0);
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(requests.every((range) => /^bytes=\d+-\d+$/.test(range))).toBe(true);
      expect(requests.every((range) => !/bytes=\d+-$/.test(range))).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
