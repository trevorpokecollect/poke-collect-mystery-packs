import { DIGITS, LETTERS } from "./countdown-glyphs";
import { encodeGif } from "./gif";

// The email countdown to the next daily draw: a 60-second animated GIF drawn like the
// widget's daily timer (Hours / Mins / Secs boxes). Email clients fetch it when the email
// is opened, so it shows the real time left at that moment. Drawn at 2x for sharp screens.

export const COUNTDOWN_WIDTH = 952;
export const COUNTDOWN_HEIGHT = 136;
const GAP = 16;
const BOX_W = (COUNTDOWN_WIDTH - 2 * GAP) / 3;
const RADIUS = 28;
const BORDER = 2;
const DIGIT_Y = 18;
const LABEL_Y = 86;
const LEVELS = 15;

type RGB = [number, number, number];
const CARD: RGB = [17, 17, 20];
const BOX: RGB = [29, 29, 34];
const LINE: RGB = [44, 44, 51];
const WHITE: RGB = [255, 255, 255];
const SOFT: RGB = [180, 180, 187];
const LABELS = ["HOURS", "MINS", "SECS"];

const decoded = new Map<string, Uint8Array>();
function mask(set: typeof DIGITS, c: string) {
  const key = `${set.height}:${c}`;
  let m = decoded.get(key);
  if (!m) {
    m = Uint8Array.from(Buffer.from(set.glyphs[c][1], "base64"));
    decoded.set(key, m);
  }
  return m;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

class Canvas {
  palette: RGB[] = [];
  index = new Map<number, number>();
  rgb = new Uint8Array(COUNTDOWN_WIDTH * COUNTDOWN_HEIGHT * 3);
  set(x: number, y: number, c: RGB) {
    const i = (y * COUNTDOWN_WIDTH + x) * 3;
    this.rgb[i] = c[0];
    this.rgb[i + 1] = c[1];
    this.rgb[i + 2] = c[2];
  }
  get(x: number, y: number): RGB {
    const i = (y * COUNTDOWN_WIDTH + x) * 3;
    return [this.rgb[i], this.rgb[i + 1], this.rgb[i + 2]];
  }
  /** Palette indices for a rectangle. */
  indices(x0: number, y0: number, w: number, h: number) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [r, g, b] = this.get(x0 + x, y0 + y);
        const key = (r << 16) | (g << 8) | b;
        let i = this.index.get(key);
        if (i === undefined) {
          i = this.palette.length;
          if (i > 255) i = 255;
          else {
            this.palette.push([r, g, b]);
            this.index.set(key, i);
          }
        }
        out[y * w + x] = i;
      }
    return out;
  }
}

// Coverage (0..1) of a rounded rectangle at pixel (x, y), sampled at the pixel center.
function roundRect(x: number, y: number, w: number, h: number, r: number) {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  const d = Math.hypot(x - cx, y - cy);
  return Math.min(1, Math.max(0, r - d + 0.5));
}

const quant = (t: number) => Math.round(t * LEVELS) / LEVELS;

function drawBox(cv: Canvas, left: number) {
  const w = Math.round(BOX_W);
  for (let y = 0; y < COUNTDOWN_HEIGHT; y++)
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const outer = quant(roundRect(px, py, w, COUNTDOWN_HEIGHT, RADIUS));
      const inner = quant(
        roundRect(
          px - BORDER,
          py - BORDER,
          w - 2 * BORDER,
          COUNTDOWN_HEIGHT - 2 * BORDER,
          RADIUS - BORDER,
        ),
      );
      cv.set(left + x, y, mix(mix(CARD, LINE, outer), BOX, inner));
    }
}

function drawText(
  cv: Canvas,
  set: typeof DIGITS,
  text: string,
  centerX: number,
  top: number,
  color: RGB,
  tracking = 0,
) {
  const widths = [...text].map((c) => set.glyphs[c][0]);
  const total =
    widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1);
  let x = Math.round(centerX - total / 2);
  [...text].forEach((c, n) => {
    const m = mask(set, c);
    const w = widths[n];
    for (let y = 0; y < set.height; y++)
      for (let gx = 0; gx < w; gx++) {
        const a = m[y * w + gx];
        if (!a) continue;
        const bg = cv.get(x + gx, top + y);
        cv.set(x + gx, top + y, mix(bg, color, quant(a / 255)));
      }
    x += w + tracking;
  });
}

const boxLeft = (i: number) => Math.round(i * (BOX_W + GAP));
const pad = (n: number) => String(n).padStart(2, "0");

function parts(secondsLeft: number) {
  const s = Math.max(0, secondsLeft);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(pad);
}

/** A 60-frame GIF counting down from `secondsLeft`, stopping at 00:00:00. */
export function countdownGif(secondsLeft: number): Uint8Array {
  const cv = new Canvas();
  for (let y = 0; y < COUNTDOWN_HEIGHT; y++)
    for (let x = 0; x < COUNTDOWN_WIDTH; x++) cv.set(x, y, CARD);
  const digitH = DIGITS.height;
  const drawDigits = (values: string[], only?: number[]) => {
    for (const i of only ?? [0, 1, 2]) {
      const left = boxLeft(i);
      const w = Math.round(BOX_W);
      // Clear the digit band back to the box color, then draw the number.
      for (let y = DIGIT_Y; y < DIGIT_Y + digitH; y++)
        for (let x = left + 2 * BORDER; x < left + w - 2 * BORDER; x++)
          cv.set(x, y, BOX);
      drawText(cv, DIGITS, values[i], left + w / 2, DIGIT_Y, WHITE, 2);
    }
  };
  for (let i = 0; i < 3; i++) {
    drawBox(cv, boxLeft(i));
    drawText(cv, LETTERS, LABELS[i], boxLeft(i) + BOX_W / 2, LABEL_Y, SOFT, 3);
  }
  let shown = parts(secondsLeft);
  drawDigits(shown);
  const frames = [
    {
      x: 0,
      y: 0,
      width: COUNTDOWN_WIDTH,
      height: COUNTDOWN_HEIGHT,
      pixels: cv.indices(0, 0, COUNTDOWN_WIDTH, COUNTDOWN_HEIGHT),
      delay: 100,
    },
  ];
  for (let t = 1; t < 60 && secondsLeft - t >= 0; t++) {
    const next = parts(secondsLeft - t);
    const changed = [0, 1, 2].filter((i) => next[i] !== shown[i]);
    shown = next;
    drawDigits(next, changed);
    const x0 = boxLeft(changed[0]);
    const x1 = boxLeft(changed[changed.length - 1]) + Math.round(BOX_W);
    frames.push({
      x: x0,
      y: DIGIT_Y,
      width: x1 - x0,
      height: digitH,
      pixels: cv.indices(x0, DIGIT_Y, x1 - x0, digitH),
      delay: 100,
    });
  }
  return encodeGif(COUNTDOWN_WIDTH, COUNTDOWN_HEIGHT, cv.palette, frames);
}
