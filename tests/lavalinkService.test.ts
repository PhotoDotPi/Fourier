import { describe, expect, it } from 'bun:test';
import { parseLavalinkNodes } from '../src/services/lavalinkService.js';

describe('parseLavalinkNodes', () => {
  it('returns empty for empty input', () => {
    expect(parseLavalinkNodes('')).toEqual([]);
    expect(parseLavalinkNodes('   ')).toEqual([]);
  });

  it('parses JSON list', () => {
    const nodes = parseLavalinkNodes('[{"host":"localhost","port":2333,"password":"secret"}]');
    expect(nodes).toEqual([{ host: 'localhost', port: 2333, password: 'secret', secure: false }]);
  });

  it('parses host:port:password entries', () => {
    const nodes = parseLavalinkNodes('localhost:2333:youshallnotpass');
    expect(nodes).toEqual([{ host: 'localhost', port: 2333, password: 'youshallnotpass', secure: false }]);
  });

  it('parses multiple comma-separated entries', () => {
    const nodes = parseLavalinkNodes('a:2333:pass1,b:2334:pass2');
    expect(nodes).toHaveLength(2);
  });
});
