import { describe, expect, it } from 'bun:test';
import {
  FfmpegMediaUnavailableError,
  FfmpegProcessError,
  FfmpegStartupError,
  getStartupErrorForTesting,
} from '../src/services/ffmpegProcess.js';

describe('ffmpegProcess error classification', () => {
  it('classifies a 404 as not-found FfmpegMediaUnavailableError', () => {
    const error = new FfmpegMediaUnavailableError(new Error('Server returned 404 Not Found'), 'not-found');
    expect(error.reason).toBe('not-found');
    expect(error.name).toBe('FfmpegMediaUnavailableError');
  });

  it('classifies invalid input as invalid-output FfmpegMediaUnavailableError', () => {
    const error = new FfmpegMediaUnavailableError(
      new Error('Invalid data found when processing input'),
      'invalid-output',
    );
    expect(error.reason).toBe('invalid-output');
  });

  it('redacts media URLs from FFmpeg error messages', () => {
    const error = new FfmpegStartupError(new Error('https://media.example/audio.webm?token=secret: handshake failed'));
    expect(error.message).not.toContain('token=secret');
    expect(error.message).toContain('[media URL]');
  });

  it('subclassing is preserved so callers can use instanceof', () => {
    const media = new FfmpegMediaUnavailableError(new Error('x'), 'not-found');
    const startup = new FfmpegStartupError(new Error('y'));
    expect(media).toBeInstanceOf(Error);
    expect(startup).toBeInstanceOf(Error);
    expect(media).not.toBeInstanceOf(FfmpegStartupError);
    expect(startup).not.toBeInstanceOf(FfmpegMediaUnavailableError);
  });
});

describe('ffmpegProcess startup error classification', () => {
  it('maps 404 to not-found media unavailable', () => {
    const error = getStartupErrorForTesting(new Error('Server returned 404 Not Found'));
    expect(error).toBeInstanceOf(FfmpegMediaUnavailableError);
    expect(error).toMatchObject({ reason: 'not-found' });
  });

  it('maps 410 to not-found media unavailable', () => {
    const error = getStartupErrorForTesting(new Error('Server returned 410 Gone'));
    expect(error).toBeInstanceOf(FfmpegMediaUnavailableError);
    expect(error).toMatchObject({ reason: 'not-found' });
  });

  it('maps invalid input to invalid-output media unavailable', () => {
    const error = getStartupErrorForTesting(new Error('Invalid data found when processing input'));
    expect(error).toBeInstanceOf(FfmpegMediaUnavailableError);
    expect(error).toMatchObject({ reason: 'invalid-output' });
  });

  it('falls back to generic startup error otherwise', () => {
    const error = getStartupErrorForTesting(new Error('anonymous pipe already in use'));
    expect(error).toBeInstanceOf(FfmpegStartupError);
  });
});

describe('FfmpegProcessError', () => {
  it('carries an optional cause', () => {
    const cause = new Error('root cause');
    const error = new FfmpegProcessError('ffprobe failed', cause);
    expect(error.cause).toBe(cause);
    expect(error.message).toBe('ffprobe failed');
    expect(error.name).toBe('FfmpegProcessError');
  });
});
