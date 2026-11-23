// Minimal animated GIF89a encoder (global palette, LZW, looping). Used for the email
// countdown timer, where each frame after the first only redraws the digits that changed.

export interface GifFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Palette indices, row-major, width * height. */
  pixels: Uint8Array;
  /** Delay before the next frame, in hundredths of a second. */
  delay: number;
}

class Bytes {
  buf: number[] = [];
  byte(b: number) {
    this.buf.push(b & 0xff);
  }
  short(n: number) {
    this.byte(n);
    this.byte(n >> 8);
  }
  str(s: string) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
}

function lzw(out: Bytes, minCode: number, pixels: Uint8Array) {
  out.byte(minCode);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();
  const block: number[] = [];
  let acc = 0;
  let bits = 0;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
      if (block.length === 255) {
        out.byte(255);
        for (const b of block) out.byte(b);
        block.length = 0;
      }
    }
  };
  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      size = minCode + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) block.push(acc & 0xff);
  for (let i = 0; i < block.length; i += 255) {
    const chunk = block.slice(i, i + 255);
    out.byte(chunk.length);
    for (const b of chunk) out.byte(b);
  }
  out.byte(0);
}

/** Encodes frames into a looping GIF. `palette` is up to 256 [r, g, b] colors. */
export function encodeGif(
  width: number,
  height: number,
  palette: [number, number, number][],
  frames: GifFrame[],
): Uint8Array {
  let depth = 1;
  while (1 << depth < palette.length) depth++;
  const out = new Bytes();
  out.str("GIF89a");
  out.short(width);
  out.short(height);
  out.byte(0x80 | ((depth - 1) << 4) | (depth - 1));
  out.byte(0);
  out.byte(0);
  for (let i = 0; i < 1 << depth; i++) {
    const c = palette[i] ?? [0, 0, 0];
    out.byte(c[0]);
    out.byte(c[1]);
    out.byte(c[2]);
  }
  // Loop forever.
  out.byte(0x21);
  out.byte(0xff);
  out.byte(11);
  out.str("NETSCAPE2.0");
  out.byte(3);
  out.byte(1);
  out.short(0);
  out.byte(0);
  for (const f of frames) {
    out.byte(0x21);
    out.byte(0xf9);
    out.byte(4);
    out.byte(0x04); // dispose: leave in place
    out.short(f.delay);
    out.byte(0);
    out.byte(0);
    out.byte(0x2c);
    out.short(f.x);
    out.short(f.y);
    out.short(f.width);
    out.short(f.height);
    out.byte(0);
    lzw(out, Math.max(2, depth), f.pixels);
  }
  out.byte(0x3b);
  return Uint8Array.from(out.buf);
}
