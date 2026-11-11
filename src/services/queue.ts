import { shuffle } from '../utils/arrays.js';
import type { QueuedSong } from './playerTypes.js';

export interface QueueSnapshot {
  readonly position: number;
  readonly entryVersion: number;
}

export default class Queue {
  private songs: QueuedSong[] = [];
  private position = 0;
  private entryVersion = 0;

  getCurrent(): QueuedSong | null {
    return this.songs[this.position] ?? null;
  }

  getPosition(): number {
    return this.position;
  }

  getCurrentEntryVersion(): number {
    return this.entryVersion;
  }

  getUpcoming(): QueuedSong[] {
    return this.songs.slice(this.position + 1);
  }

  getSize(): number {
    return this.getUpcoming().length;
  }

  isEmpty(): boolean {
    return this.getSize() === 0;
  }

  add(song: QueuedSong, { immediate = false, immediateOffset = 0 } = {}): void {
    const currentSong = this.getCurrent();

    if (immediate) {
      const insertAt = this.position + immediateOffset + 1;
      this.songs = [...this.songs.slice(0, insertAt), song, ...this.songs.slice(insertAt)];
    } else {
      this.songs.push(song);
    }

    if (this.getCurrent() !== currentSong) {
      this.entryVersion++;
    }
  }

  shuffle(): void {
    const shuffledUpcoming = shuffle(this.songs.slice(this.position + 1));
    this.songs = [...this.songs.slice(0, this.position + 1), ...shuffledUpcoming];
  }

  clear(): void {
    const current = this.getCurrent();
    this.songs = current ? [current] : [];
    this.position = 0;
  }

  removeFromQueue(index: number, amount = 1): void {
    this.songs.splice(this.position + index, amount);
  }

  removeCurrent(): void {
    this.songs = [...this.songs.slice(0, this.position), ...this.songs.slice(this.position + 1)];
    this.entryVersion++;
  }

  move(from: number, to: number): QueuedSong {
    if (from > this.getSize() || to > this.getSize()) {
      throw new Error('Move index is outside the range of the queue.');
    }

    this.songs.splice(this.position + to, 0, this.songs.splice(this.position + from, 1)[0]);
    return this.songs[this.position + to];
  }

  canGoForward(skip: number): boolean {
    return this.position + skip - 1 < this.songs.length;
  }

  forward(skip: number): void {
    if (this.canGoForward(skip)) {
      this.position += skip;
      this.entryVersion++;
    } else {
      throw new Error('No songs in queue to forward to.');
    }
  }

  canGoBack(): boolean {
    return this.position - 1 >= 0;
  }

  back(): void {
    if (!this.canGoBack()) {
      throw new Error('No songs in queue to go back to.');
    }

    this.position--;
    this.entryVersion++;
  }

  reset(): void {
    this.position = 0;
    this.songs = [];
    this.entryVersion++;
  }

  snapshot(): QueueSnapshot {
    return { position: this.position, entryVersion: this.entryVersion };
  }

  restoreSnapshot(snapshot: QueueSnapshot): void {
    this.position = snapshot.position;
    this.entryVersion = snapshot.entryVersion;
  }

  replaceSong(index: number, song: QueuedSong): QueuedSong {
    const previous = this.songs[index];
    this.songs[index] = song;
    return previous;
  }

  getSongAt(index: number): QueuedSong | undefined {
    return this.songs[index];
  }
}
