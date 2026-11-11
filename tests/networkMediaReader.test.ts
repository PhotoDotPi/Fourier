import { afterEach, describe, expect, it } from 'bun:test';
import { readNetworkMedia } from '../src/services/ffmpegProcess.js';

type FetchHandler = (input: string | URL | Request, init?: { headers?: Record<string, string> }) => Promise<Response>;

const CHUNK = 262144;

const byteAt = (index: number) => (index * 7 + 3) % 256;

const makeRangeServer = (totalBytes: number) => {
  const requests: Array<{ headers: Record<string, string>; range: string }> = [];

  const server: FetchHandler = async (_url, init) => {
    const headers = (init?.headers as Record<string, string> | undefined) ?? {};
    const range = headers.Range ?? '<no-range>';
    requests.push({ headers, range });

    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) {
      return new Response(null, { status: 403 });
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    const length = end - start + 1;

    if (start >= totalBytes) {
      return new Response(null, { status: 416 });
    }

    if (length > CHUNK) {
      return new Response(null, { status: 403 });
    }

    const actualEnd = Math.min(end, totalBytes - 1);
    const size = actualEnd - start + 1;
    const data = new Uint8Array(size);
    for (let offset = 0, i = start; i <= actualEnd; offset += 1, i += 1) {
      data[offset] = byteAt(i);
    }

    return new Response(data, {
      status: 206,
      headers: {
        'Content-Length': String(size),
        'Content-Range': `bytes ${start}-${actualEnd}/${totalBytes}`,
      },
    });
  };

  return { requests, server };
};

const collect = async (server: FetchHandler, headers: Record<string, string> = {}) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = server as typeof fetch;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of readNetworkMedia('https://media.example/track', headers, new AbortController().signal)) {
      chunks.push(chunk);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  return Buffer.concat(chunks);
};

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('network media reader', () => {
  it('fetches the whole stream through bounded ranges and reassembles it', async () => {
    const totalBytes = CHUNK * 2 + CHUNK / 2 + 1234;
    const { requests, server } = makeRangeServer(totalBytes);
    const output = await collect(server);

    const expected = new Uint8Array(totalBytes);
    for (const [index] of [...new Array(totalBytes)].entries()) {
      expected[index] = byteAt(index);
    }

    expect(output.equals(Buffer.from(expected))).toBe(true);
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => /^bytes=\d+-\d+$/.test(request.range))).toBe(true);
    expect(requests[0].range).toBe(`bytes=0-${CHUNK - 1}`);
    expect(requests[requests.length - 1].range).toMatch(/^bytes=\d+-\d+$/);
  });

  it('drops empty headers, host overrides, and always sends a bounded Range', async () => {
    const { requests, server } = makeRangeServer(CHUNK + 1);
    await collect(server, {
      Authorization: 'Bearer token',
      Empty: '',
      Host: 'evil.example',
    });

    expect(requests.every((request) => request.headers.Authorization === 'Bearer token')).toBe(true);
    expect(requests.every((request) => !('Empty' in request.headers))).toBe(true);
    expect(requests.every((request) => !('Host' in request.headers))).toBe(true);
    expect(requests.every((request) => /^bytes=\d+-\d+$/.test(request.range))).toBe(true);
  });

  it('stops immediately when the server reports the range is not satisfiable', async () => {
    const { requests, server } = makeRangeServer(0);
    const output = await collect(server);

    expect(output.byteLength).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].range).toBe('bytes=0-262143');
  });

  it('fails after retries when the server rejects bounded ranges with 403', async () => {
    const server: FetchHandler = async () => new Response(null, { status: 403 });

    await expect(collect(server)).rejects.toThrow(/HTTP 403/);
  });

  it('stops gracefully when a mid-stream range is rejected (e.g. googlevideo range cap)', async () => {
    const firstChunk = new Uint8Array(CHUNK);
    for (const [index] of firstChunk.entries()) {
      firstChunk[index] = byteAt(index);
    }

    const requests: string[] = [];
    const server: FetchHandler = async (_url, init) => {
      const headers = (init?.headers as Record<string, string> | undefined) ?? {};
      const range = headers.Range ?? '<no-range>';
      requests.push(range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match || Number(match[1]) === 0) {
        return new Response(firstChunk, {
          status: 206,
          headers: {
            'Content-Length': String(CHUNK),
            'Content-Range': `bytes 0-${CHUNK - 1}/9999999`,
          },
        });
      }
      return new Response(null, { status: 403 });
    };

    const output = await collect(server);

    expect(output.byteLength).toBe(CHUNK);
    expect(output.equals(Buffer.from(firstChunk))).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(`bytes=${CHUNK}-${CHUNK * 2 - 1}`);
  });
});
