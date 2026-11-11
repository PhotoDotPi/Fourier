import { colors } from './colors.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  public text = '';
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stream: NodeJS.WriteStream = process.stderr;

  start(text?: string): this {
    if (text) {
      this.text = text;
    }
    this.render();
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      this.render();
    }, 80);
    return this;
  }

  succeed(text?: string): this {
    return this.stop(`✓ ${text ?? this.text}`, colors.brightGreen);
  }

  fail(text?: string): this {
    return this.stop(`✗ ${text ?? this.text}`, colors.brightRed);
  }

  private stop(message: string, color?: (text: string) => string): this {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const rendered = color ? color(message) : message;
    const clear = `\r${' '.repeat(this.text.length + 4)}\r`;
    this.stream.write(`${clear}${rendered}\n`);
    return this;
  }

  private render(): void {
    const frame = colors.brightCyan(FRAMES[this.frameIndex]);
    this.stream.write(`\r${frame} ${this.text}`);
  }
}

const spinner = (text?: string) => new Spinner().start(text);
export default spinner;
