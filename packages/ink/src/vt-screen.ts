import { terminalTextWidth } from "@mwillbanks/tuil-core";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

function dimension(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function parameter(values: readonly number[], index: number, fallback: number) {
  const value = values[index];
  return value === undefined || value === 0 ? fallback : value;
}

/**
 * A bounded VT screen model for telemetry. It interprets the cursor and erase
 * operations Ink emits, while deliberately ignoring presentation-only modes.
 */
export class VirtualTerminalScreen {
  #width: number;
  #height: number;
  #rows: string[][];
  #x = 0;
  #y = 0;
  #savedX = 0;
  #savedY = 0;
  #pending = "";
  #wrapPending = false;

  constructor(width: number, height: number) {
    this.#width = dimension(width, "Screen width");
    this.#height = dimension(height, "Screen height");
    this.#rows = this.#blankRows(this.#height);
  }

  resize(width: number, height: number): void {
    const nextWidth = dimension(width, "Screen width");
    const nextHeight = dimension(height, "Screen height");
    const rows = this.#blankRows(nextHeight, nextWidth);
    for (let y = 0; y < Math.min(this.#height, nextHeight); y += 1) {
      for (let x = 0; x < Math.min(this.#width, nextWidth); x += 1) {
        const row = rows[y];
        if (row) row[x] = this.#rows[y]?.[x] ?? " ";
      }
    }
    this.#width = nextWidth;
    this.#height = nextHeight;
    this.#rows = rows;
    this.#x = Math.min(this.#x, nextWidth - 1);
    this.#y = Math.min(this.#y, nextHeight - 1);
    this.#savedX = Math.min(this.#savedX, nextWidth - 1);
    this.#savedY = Math.min(this.#savedY, nextHeight - 1);
    this.#wrapPending = false;
  }

  write(value: string): void {
    const input = `${this.#pending}${value}`;
    this.#pending = "";
    let offset = 0;
    while (offset < input.length) {
      const character = input[offset] ?? "";
      if (character === "\u001b") {
        const nextOffset = this.#escape(input, offset);
        if (nextOffset === undefined) {
          this.#pending = input.slice(offset);
          return;
        }
        offset = nextOffset;
        continue;
      }
      if (this.#control(character)) {
        offset += 1;
        continue;
      }
      const remaining = input.slice(offset);
      const grapheme =
        graphemeSegmenter.segment(remaining)[Symbol.iterator]().next().value
          ?.segment ?? character;
      this.#print(grapheme);
      offset += grapheme.length;
    }
  }

  snapshot(): string {
    const lines = this.#rows.map((row) => row.join("").trimEnd());
    while (lines.at(-1) === "") lines.pop();
    return lines.join("\n");
  }

  #blankRow(width = this.#width): string[] {
    return Array.from({ length: width }, () => " ");
  }

  #blankRows(height: number, width = this.#width): string[][] {
    return Array.from({ length: height }, () => this.#blankRow(width));
  }

  #control(character: string): boolean {
    if (character === "\r") {
      this.#x = 0;
      this.#wrapPending = false;
      return true;
    }
    if (character === "\n") {
      this.#x = 0;
      this.#wrapPending = false;
      this.#lineFeed();
      return true;
    }
    if (character === "\b") {
      this.#x = Math.max(0, this.#x - 1);
      this.#wrapPending = false;
      return true;
    }
    if (character === "\t") {
      this.#x = Math.min(this.#width - 1, (Math.floor(this.#x / 8) + 1) * 8);
      this.#wrapPending = false;
      return true;
    }
    return (
      (character.codePointAt(0) ?? Number.POSITIVE_INFINITY) < 0x20 ||
      character === "\u007f"
    );
  }

  #escape(value: string, offset: number): number | undefined {
    const kind = value[offset + 1];
    if (kind === undefined) return undefined;
    if (kind === "[") return this.#csi(value, offset);
    if (kind === "]") return this.#osc(value, offset);
    if (kind === "7") {
      [this.#savedX, this.#savedY] = [this.#x, this.#y];
    } else if (kind === "8") {
      [this.#x, this.#y] = [this.#savedX, this.#savedY];
      this.#wrapPending = false;
    }
    return offset + 2;
  }

  #osc(value: string, offset: number): number | undefined {
    for (let index = offset + 2; index < value.length; index += 1) {
      if (value[index] === "\u0007") return index + 1;
      if (value[index] === "\u001b" && value[index + 1] === "\\")
        return index + 2;
    }
    return undefined;
  }

  #csi(value: string, offset: number): number | undefined {
    let end = offset + 2;
    while (end < value.length) {
      const code = value.charCodeAt(end);
      if (code >= 0x40 && code <= 0x7e) break;
      end += 1;
    }
    if (end >= value.length) return undefined;
    const command = value[end] ?? "";
    const body = value.slice(offset + 2, end).replace(/^[?>!]/u, "");
    const values = body
      .split(";")
      .map((item) => Number(item || 0))
      .filter(Number.isFinite);
    this.#applyCsi(command, values);
    return end + 1;
  }

  #applyCsi(command: string, values: readonly number[]): void {
    const amount = parameter(values, 0, 1);
    if (this.#moveCursor(command, values, amount)) return;
    if (this.#editScreen(command, values, amount)) return;
    if (command === "s") [this.#savedX, this.#savedY] = [this.#x, this.#y];
    else if (command === "u") {
      [this.#x, this.#y] = [this.#savedX, this.#savedY];
      this.#wrapPending = false;
    }
  }

  #moveCursor(
    command: string,
    values: readonly number[],
    amount: number,
  ): boolean {
    if (!"ABCDEFGHfd".includes(command)) return false;
    this.#wrapPending = false;
    if (this.#moveVertical(command, amount)) return true;
    if (this.#moveHorizontal(command, amount)) return true;
    if (this.#moveLine(command, amount)) return true;
    if (command === "H" || command === "f") this.#position(values);
    else this.#y = Math.min(this.#height - 1, amount - 1);
    return true;
  }

  #moveVertical(command: string, amount: number): boolean {
    if (command === "A") this.#y = Math.max(0, this.#y - amount);
    else if (command === "B")
      this.#y = Math.min(this.#height - 1, this.#y + amount);
    else return false;
    return true;
  }

  #moveHorizontal(command: string, amount: number): boolean {
    if (command === "C") this.#x = Math.min(this.#width - 1, this.#x + amount);
    else if (command === "D") this.#x = Math.max(0, this.#x - amount);
    else if (command === "G") this.#x = Math.min(this.#width - 1, amount - 1);
    else return false;
    return true;
  }

  #moveLine(command: string, amount: number): boolean {
    if (command === "E")
      [this.#x, this.#y] = [0, Math.min(this.#height - 1, this.#y + amount)];
    else if (command === "F")
      [this.#x, this.#y] = [0, Math.max(0, this.#y - amount)];
    else return false;
    return true;
  }

  #editScreen(
    command: string,
    values: readonly number[],
    amount: number,
  ): boolean {
    if (this.#erase(command, values, amount)) return true;
    if (this.#editCharacters(command, amount)) return true;
    if (command === "S") this.#scrollUp(amount);
    else if (command === "T") this.#scrollDown(amount);
    else return false;
    return true;
  }

  #erase(command: string, values: readonly number[], amount: number): boolean {
    if (command === "J") this.#eraseDisplay(values[0] ?? 0);
    else if (command === "K") this.#eraseLine(values[0] ?? 0);
    else if (command === "X") this.#eraseCharacters(amount);
    else return false;
    return true;
  }

  #editCharacters(command: string, amount: number): boolean {
    if (command === "P") this.#deleteCharacters(amount);
    else if (command === "@") this.#insertCharacters(amount);
    else return false;
    return true;
  }

  #position(values: readonly number[]): void {
    this.#y = Math.min(this.#height - 1, parameter(values, 0, 1) - 1);
    this.#x = Math.min(this.#width - 1, parameter(values, 1, 1) - 1);
  }

  #eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.#rows = this.#blankRows(this.#height);
      return;
    }
    if (mode === 0) {
      this.#eraseLine(0);
      for (let y = this.#y + 1; y < this.#height; y += 1)
        this.#rows[y] = this.#blankRow();
      return;
    }
    for (let y = 0; y < this.#y; y += 1) this.#rows[y] = this.#blankRow();
    this.#eraseLine(1);
  }

  #eraseLine(mode: number): void {
    const row = this.#rows[this.#y];
    if (!row) return;
    const start = mode === 0 ? this.#x : 0;
    const end = mode === 1 ? this.#x + 1 : this.#width;
    row.fill(" ", start, end);
  }

  #eraseCharacters(amount: number): void {
    this.#rows[this.#y]?.fill(
      " ",
      this.#x,
      Math.min(this.#width, this.#x + amount),
    );
  }

  #deleteCharacters(amount: number): void {
    const row = this.#rows[this.#y];
    if (!row) return;
    row.splice(this.#x, amount);
    row.push(
      ...Array.from({ length: Math.min(amount, this.#width) }, () => " "),
    );
    row.length = this.#width;
  }

  #insertCharacters(amount: number): void {
    const row = this.#rows[this.#y];
    if (!row) return;
    row.splice(this.#x, 0, ...Array.from({ length: amount }, () => " "));
    row.length = this.#width;
  }

  #scrollUp(amount: number): void {
    for (let index = 0; index < Math.min(amount, this.#height); index += 1) {
      this.#rows.shift();
      this.#rows.push(this.#blankRow());
    }
  }

  #scrollDown(amount: number): void {
    for (let index = 0; index < Math.min(amount, this.#height); index += 1) {
      this.#rows.pop();
      this.#rows.unshift(this.#blankRow());
    }
  }

  #lineFeed(): void {
    if (this.#y < this.#height - 1) {
      this.#y += 1;
      return;
    }
    this.#scrollUp(1);
  }

  #print(grapheme: string): void {
    const width = terminalTextWidth(grapheme);
    if (width === 0) {
      const column = Math.max(0, this.#x - 1);
      const row = this.#rows[this.#y];
      if (row) row[column] = `${row[column] ?? ""}${grapheme}`;
      return;
    }
    if (this.#wrapPending || this.#x + width > this.#width) {
      this.#x = 0;
      this.#wrapPending = false;
      this.#lineFeed();
    }
    const row = this.#rows[this.#y];
    if (!row) return;
    row[this.#x] = grapheme;
    for (let offset = 1; offset < width; offset += 1)
      row[this.#x + offset] = "";
    const nextX = this.#x + width;
    this.#x = Math.min(this.#width - 1, nextX);
    this.#wrapPending = nextX >= this.#width;
  }
}
