"""Cardbit pack-opening music: six original 8-bit songs, rendered as seamless loops.

Every melody, bass line and drum part below was written for Cardbit (Nov 27 2026). Voices imitate the
classic 2-pulse + triangle + noise chip layout, band-limited (PolyBLEP) so high notes stay clean.
Usage: python3 chiptunes.py OUT_DIR
"""
import sys, os, re
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

SR = 44100
rng = np.random.default_rng(11)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def midi(name):
    m = re.fullmatch(r'([A-G])([#b]?)(-?\d)', name)
    n = NOTE[m[1]] + (1 if m[2] == '#' else -1 if m[2] == 'b' else 0)
    return 12 * (int(m[3]) + 1) + n

def parse_mel(text):
    out = []  # (step, midi or None, len)
    step = 0
    for tok in text.split():
        n, l = tok.split(':'); l = int(l)
        out.append((step, None if n == 'r' else midi(n), l)); step += l
    return out, step

CH = {'': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11]}
def chord(name):
    m = re.fullmatch(r'([A-G][#b]?)(m7|maj7|m|7)?', name)
    root = midi(m[1] + '2'); q = m[2] or ''
    return root, CH[q]

# ---------- voices ----------
def blep(t, dt):
    out = np.zeros_like(t)
    a = t < dt; x = t[a] / dt[a]; out[a] = x + x - x * x - 1
    b = t > 1 - dt; x = (t[b] - 1) / dt[b]; out[b] = x * x + x + x + 1
    return out

def pulse(freq, n, duty=.5, vib=0.0, vib_delay=.12, slide_from=None):
    t = np.arange(n) / SR
    f = np.full(n, freq, float)
    if slide_from:
        k = np.minimum(1, t / .045); f = slide_from * (freq / slide_from) ** k
    if vib:
        depth = np.clip((t - vib_delay) / .15, 0, 1) * vib
        f = f * 2 ** (depth * np.sin(2 * np.pi * 5.6 * t) / 12)
    dt = f / SR
    p = np.cumsum(dt) % 1.0
    s = np.where(p < duty, 1.0, -1.0)
    s += blep(p, dt) - blep((p - duty) % 1.0, dt)
    return s - (2 * duty - 1)  # remove DC

def tri(freq, n):
    dt = freq / SR
    p = (np.arange(n) * dt) % 1.0
    s = 1 - 4 * np.abs(p - .5)
    return np.round((s + 1) * 7.5) / 7.5 - 1  # 4-bit stepped, the chip triangle sound

def noise(n, hold=1):
    v = rng.choice([-1.0, 1.0], size=n // hold + 2)
    return np.repeat(v, hold)[:n]

def adsr(n, a=.004, d=.08, s=.6, r=.03, gate=None):
    t = np.arange(n) / SR
    gate = n / SR if gate is None else gate
    e = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / d))
    rel = np.clip(t - gate, 0, None)
    return e * np.exp(-rel / r) * (t < gate + r * 6)

def lp(x, f, order=2): return sosfilt(butter(order, f / (SR / 2), 'low', output='sos'), x)
def hp(x, f, order=2): return sosfilt(butter(order, f / (SR / 2), 'high', output='sos'), x)

# ---------- drums ----------
def kick():
    n = int(SR * .16); t = np.arange(n) / SR
    f = 45 + 160 * np.exp(-t * 40)
    ph = np.cumsum(f / SR) % 1
    s = 1 - 4 * np.abs(ph - .5)
    s = np.round((s + 1) * 7.5) / 7.5 - 1
    return s * np.exp(-t * 18) * 1.1
def snare():
    n = int(SR * .16); t = np.arange(n) / SR
    body = (1 - 4 * np.abs((t * 190) % 1 - .5)) * np.exp(-t * 40) * .5
    return (noise(n, 2) * np.exp(-t * 22) * .8 + body)
def hat(open_=False):
    n = int(SR * (.14 if open_ else .035)); t = np.arange(n) / SR
    return hp(noise(n, 1), 6000) * np.exp(-t * (20 if open_ else 110)) * .5
def tom(f0):
    n = int(SR * .14); t = np.arange(n) / SR
    ph = np.cumsum((f0 * np.exp(-t * 9)) / SR) % 1
    s = 1 - 4 * np.abs(ph - .5)
    return (np.round((s + 1) * 7.5) / 7.5 - 1) * np.exp(-t * 16) * .9

# ---------- song renderer ----------
class Mix:
    def __init__(self, n): self.L = np.zeros(n); self.R = np.zeros(n); self.n = n
    def add(self, sig, i, gain=1.0, pan=0.0):
        if i >= self.n: return
        sig = sig[:self.n - i]
        l = np.cos((pan + 1) * np.pi / 4) * 1.414; r = np.sin((pan + 1) * np.pi / 4) * 1.414
        self.L[i:i + len(sig)] += sig * gain * l; self.R[i:i + len(sig)] += sig * gain * r

def render(song):
    bpm = song['bpm']; S16 = 60 / bpm / 4
    mel, steps = parse_mel(song['melody'])
    bars = song['chords'].split()
    assert steps == len(bars) * 16, (song['name'], steps, len(bars) * 16)
    swing = song.get('swing', 0.0)
    def at(step):  # seconds; swing pushes the off 8th
        s = step * S16
        if swing and step % 4 == 2: s += swing * S16
        return s
    loop = steps * S16
    tail = 2.0
    N = int((loop + tail) * SR) + 1
    lead, harm, arp, bass, drum = Mix(N), Mix(N), Mix(N), Mix(N), Mix(N)
    duty = song.get('duty', .25)

    # lead (with octave-down double in the B half, if asked)
    prev = None
    for step, m, l in mel:
        if m is None: prev = None; continue
        gate = l * S16 * .92; n = int((gate + .12) * SR)
        slide = hz(prev) if (song.get('slide') and prev and abs(prev - m) <= 2 and l >= 2) else None
        s = pulse(hz(m), n, duty, vib=.22 if l >= 6 else 0, slide_from=slide) * adsr(n, .003, .1, .7, .04, gate)
        lead.add(s, int(at(step) * SR), .2)
        if song.get('double') and step >= steps // 2:
            d = pulse(hz(m - 12), n, .5) * adsr(n, .003, .1, .6, .04, gate)
            harm.add(d, int(at(step) * SR), .07, .4)
        prev = m

    # chords: arpeggio / stabs + bass
    for b, cname in enumerate(bars):
        root, iv = chord(cname)
        tones = [root + 36 + x for x in iv] + [root + 48]
        style = song['arp']
        for i in range(16):
            st = b * 16 + i; t0 = int(at(st) * SR)
            if style == 'run':            # fast up arpeggio, 16ths
                m = tones[i % len(tones)]; n = int(S16 * .8 * SR)
                arp.add(pulse(hz(m), n, .125) * adsr(n, .002, .04, .3, .02), t0, .07, -.4)
            elif style == 'updown':
                seq = tones + tones[-2:0:-1]; m = seq[i % len(seq)]; n = int(S16 * .8 * SR)
                arp.add(pulse(hz(m), n, .125) * adsr(n, .002, .04, .35, .02), t0, .07, -.4)
            elif style == 'stab' and i % 4 == 2:   # offbeat chord stabs (shuffle / gallop)
                for m in tones[:3]:
                    n = int(S16 * 1.4 * SR)
                    arp.add(pulse(hz(m), n, .25) * adsr(n, .002, .06, .2, .03), t0, .045, -.35)
            elif style == 'pad' and i % 8 == 0:    # held broken chord, mysterious
                for k, m in enumerate(tones[:3]):
                    n = int(S16 * 7.5 * SR)
                    arp.add(pulse(hz(m), n, .125, vib=.08) * adsr(n, .05, .4, .45, .1), t0 + int(k * S16 * SR), .045, -.4 + k * .3)
        bp = song['bass']
        pat = {
            'oct8':   [(i, (0 if i % 4 == 0 else 12), 2) for i in range(0, 16, 2)],
            'drive':  [(i, (12 if i % 2 else 0), 1) for i in range(16)],
            'walk':   [(0, 0, 4), (4, 7, 4), (8, 12, 4), (12, 7, 4)],
            'sync':   [(0, 0, 3), (3, 0, 3), (6, 12, 2), (8, 0, 3), (11, 7, 3), (14, 12, 2)],
            'gallop': [(i + o, 0 if i < 8 else (7 if i < 12 else 12), 2 if o == 0 else 1) for i in range(0, 16, 4) for o in (0, 2, 3)],
            'boss':   [(i, (12 if i in (6, 14) else 0), 2) for i in range(0, 16, 2)],
        }[bp]
        for i, semi, l in pat:
            st = b * 16 + i; n = int(l * S16 * .95 * SR)
            s = tri(hz(root + 12 + semi), n) * adsr(n, .002, .2, .8, .02, l * S16 * .9)
            bass.add(s, int(at(st) * SR), .3)

        # drums
        dp = song['drums']; fill = (b % 8 == 7)
        for i in range(16):
            st = b * 16 + i; t0 = int(at(st) * SR)
            if fill and i >= 12:
                if dp != 'shuffle': drum.add(tom([260, 210, 170, 130][i - 12]), t0, .5); continue
                # Lucky Shuffle: two even snare hits on beat 4 (Trevor, Nov 27: its quick swung snare fill sounded off)
                if i in (12, 14): drum.add(snare(), t0, .45)
                if i == 12: drum.add(kick(), t0, .5)
                continue
            if dp == 'four':
                if i % 4 == 0: drum.add(kick(), t0, .55)
                if i in (4, 12): drum.add(snare(), t0, .45)
                if i % 2 == 1: drum.add(hat(), t0, .35, .2)
            elif dp == 'drive':
                if i in (0, 6, 8, 10): drum.add(kick(), t0, .55)
                if i in (4, 12): drum.add(snare(), t0, .45)
                drum.add(hat(), t0, .22 if i % 2 else .3, .2)
            elif dp == 'shuffle':
                if i in (0, 8): drum.add(kick(), t0, .55)
                if i in (4, 12): drum.add(snare(), t0, .4)
                if i % 2 == 0: drum.add(hat(), t0, .3, .2)
            elif dp == 'half':
                if i in (0, 10): drum.add(kick(), t0, .5)
                if i == 8: drum.add(snare(), t0, .42)
                if i % 2 == 0: drum.add(hat(i % 4 == 2), t0, .22, .2)
            elif dp == 'gallop':
                if i % 4 == 0: drum.add(kick(), t0, .5)
                if i in (4, 12): drum.add(snare(), t0, .42)
                if i % 4 == 2: drum.add(hat(True), t0, .22, .2)
            elif dp == 'boss':
                if i in (0, 3, 8, 11): drum.add(kick(), t0, .55)
                if i in (4, 12): drum.add(snare(), t0, .5)
                drum.add(hat(), t0, .2 + .1 * (i % 4 == 0), .2)

    # lead echo (dotted 8th), opposite side
    d = int(S16 * 3 * SR)
    echo = Mix(N)
    echo.L[d:] += lead.R[:-d] * song.get('echo', .28) * .2
    echo.R[d:] += lead.L[:-d] * song.get('echo', .28) * .6
    d2 = d * 2
    echo.L[d2:] += lead.L[:-d2] * song.get('echo', .28) * .3

    L = lead.L + harm.L + arp.L + lp(bass.L, 2400) + drum.L + echo.L
    R = lead.R + harm.R + arp.R + lp(bass.R, 2400) + drum.R + echo.R
    st = np.stack([L, R], 1)
    st = hp(st.T, 35).T
    st = lp(st.T, 11000).T
    # fold the tail onto the start: a seamless loop with echoes and decays wrapping round
    n = int(round(loop * SR)); out = st[:n].copy(); tl = st[n:]; out[:len(tl)] += tl
    out = np.tanh(out * 1.2) / 1.2
    rms = np.sqrt(np.mean(out ** 2)); out *= 10 ** (-19.5 / 20) / rms     # match the current track (-20 dB mean)
    peak = np.max(np.abs(out))
    if peak > .95: out *= .95 / peak
    return out, loop

SONGS = [
 dict(name='pixel-rush', title='Pixel Rush', bpm=152, duty=.25, arp='run', bass='oct8', drums='four', slide=True, double=True,
      chords='C G Am F C G F G Am F C G Am F Dm G',
      melody='''E5:2 G5:2 C6:4 B5:2 G5:2 E5:4  D5:2 G5:2 B5:4 A5:2 G5:2 D5:4  C5:2 E5:2 A5:3 G5:1 A5:2 C6:2 B5:2 A5:2  A5:4 G5:2 F5:2 E5:2 F5:2 G5:2 r:2
                E5:2 G5:2 C6:4 D6:2 C6:2 G5:4  B5:2 D6:2 G6:4 F6:2 D6:2 B5:4  A5:2 C6:2 F6:3 E6:1 D6:2 C6:2 A5:4  B5:4 C6:2 D6:2 G5:8
                A5:6 B5:2 C6:4 E6:4  F6:6 E6:2 C6:4 A5:4  G5:6 A5:2 G5:2 E5:2 C5:4  D5:2 E5:2 G5:2 B5:2 D6:8
                E6:4 D6:2 C6:2 B5:2 C6:2 A5:4  F5:2 A5:2 C6:2 F6:2 E6:4 C6:4  D6:4 F6:4 E6:2 D6:2 C6:2 A5:2  B5:2 C6:2 D6:2 B5:2 G5:4 r:4'''),
 dict(name='neon-vault', title='Neon Vault', bpm=138, duty=.25, arp='updown', bass='drive', drums='drive', echo=.35,
      chords='Dm Bb F C Dm Bb Gm A Bb C Dm Dm Gm A Dm A',
      melody='''D5:3 F5:3 A5:2 G5:2 F5:2 E5:2 F5:2  D5:3 F5:3 Bb5:4 A5:2 G5:2 F5:2  C5:3 F5:3 A5:2 C6:4 A5:2 F5:2  E5:3 G5:3 C6:2 E5:4 r:4
                D5:3 F5:3 A5:2 D6:4 C6:2 A5:2  Bb5:3 A5:3 F5:2 D5:4 F5:2 G5:2  Bb5:4 A5:2 G5:2 D6:4 Bb5:4  A5:3 C#6:3 E6:2 C#6:2 A5:2 E5:4
                F5:2 Bb5:2 D6:4 C6:2 Bb5:2 A5:4  G5:2 C6:2 E6:4 D6:2 C6:2 G5:4  F6:8 E6:4 D6:4  A5:2 D6:2 F6:2 A6:2 G6:2 F6:2 E6:2 D6:2
                D6:4 Bb5:2 G5:2 Bb5:4 D6:4  C#6:4 A5:2 E5:2 A5:4 C#6:4  D6:3 E6:3 F6:2 E6:3 D6:3 C#6:2  E6:4 C#6:4 A5:4 r:4'''),
 dict(name='lucky-shuffle', title='Lucky Shuffle', bpm=116, duty=.5, arp='stab', bass='walk', drums='shuffle', swing=.33, slide=True, echo=.2,
      chords='F Dm Gm C7 F D7 Gm C7 Bb Bbm F D7 Gm C7 F C7',
      melody='''C5:2 F5:2 A5:2 C6:2 A5:4 F5:4  D5:2 F5:2 A5:2 D6:2 C6:4 A5:4  Bb5:2 A5:2 G5:2 F5:2 G5:4 D5:4  E5:2 G5:2 Bb5:2 C6:2 E5:4 r:4
                A5:2 C6:2 F6:4 E6:2 D6:2 C6:4  F#5:2 A5:2 C6:2 D6:2 F#6:4 D6:4  G6:4 F6:2 D6:2 Bb5:4 G5:4  C6:2 Bb5:2 G5:2 E5:2 C5:4 r:4
                D6:4 F6:4 D6:2 Bb5:2 F5:4  Db6:4 F6:4 Db6:2 Bb5:2 F5:4  C6:2 A5:2 F5:2 A5:2 C6:4 F6:4  F#6:2 E6:2 D6:2 C6:2 A5:4 F#5:4
                G5:2 Bb5:2 D6:2 G6:2 F6:2 D6:2 Bb5:4  C6:2 E6:2 G6:4 E6:2 C6:2 Bb5:4  A5:4 C6:2 A5:2 F5:4 G5:2 A5:2  G5:4 E5:2 C5:2 r:8'''),
 dict(name='holo-hunt', title='Holo Hunt', bpm=128, duty=.125, arp='pad', bass='sync', drums='half', echo=.45,
      chords='Em A Em A C D Em Em C D Bm Em C D B B',
      melody='''E5:4 r:2 B4:2 E5:2 F#5:2 G5:4  A5:4 r:2 G5:2 F#5:2 E5:2 C#5:4  E5:4 r:2 B4:2 E5:2 G5:2 B5:4  A5:6 F#5:2 E5:8
                G5:4 E5:2 G5:2 C6:4 B5:4  A5:4 F#5:2 A5:2 D6:4 C6:4  B5:6 A5:2 G5:4 F#5:4  E5:12 r:4
                E6:4 D6:2 C6:2 G5:4 C6:4  F#6:4 E6:2 D6:2 A5:4 D6:4  D6:4 B5:2 F#5:2 B5:4 D6:4  G6:6 F#6:2 E6:8
                E6:2 G6:2 E6:2 C6:2 G5:4 E6:4  F#6:2 A6:2 F#6:2 D6:2 A5:4 F#6:4  D#6:4 F#6:4 B6:4 A6:4  F#6:4 D#6:4 B5:4 r:4'''),
 dict(name='gold-rush-gallop', title='Gold Rush Gallop', bpm=168, duty=.25, arp='stab', bass='gallop', drums='gallop', double=True,
      chords='G F C G G F C D Em C G D Em C D D',
      melody='''G5:2 B5:2 D6:2 B5:2 G5:2 D5:2 G5:4  F5:2 A5:2 C6:2 A5:2 F5:2 C5:2 F5:4  E5:2 G5:2 C6:4 D6:2 E6:2 C6:4  D6:4 B5:2 G5:2 D5:8
                G5:2 B5:2 D6:2 G6:2 F6:2 D6:2 B5:4  A5:2 C6:2 F6:2 A6:2 G6:2 F6:2 C6:4  E6:4 D6:2 C6:2 G5:4 E5:4  F#5:2 A5:2 D6:2 F#6:2 A6:8
                G6:4 E6:4 B5:4 E6:4  G6:4 E6:4 C6:4 E6:4  D6:2 E6:2 D6:2 B5:2 G5:4 B5:4  A5:4 D6:4 F#6:4 A6:4
                B6:4 A6:2 G6:2 E6:4 G6:4  E6:4 D6:2 C6:2 G5:4 C6:4  D6:2 E6:2 F#6:2 G6:2 A6:4 F#6:4  A6:2 G6:2 F#6:2 E6:2 D6:4 r:4'''),
 dict(name='boss-bit-showdown', title='Boss Bit Showdown', bpm=146, duty=.5, arp='run', bass='boss', drums='boss', slide=True, double=True, echo=.25,
      chords='Cm Ab Bb Cm Cm Ab Fm G Ab Bb Cm Cm Ab Bb G G',
      melody='''C5:2 C5:2 G5:4 Eb5:2 F5:2 G5:4  Ab5:2 G5:2 Eb5:4 C5:2 Eb5:2 Ab5:4  Bb5:2 Ab5:2 F5:4 D5:2 F5:2 Bb5:4  G5:6 F5:2 Eb5:4 D5:4
                C6:2 C6:2 G5:4 Eb6:4 D6:4  C6:4 Ab5:2 C6:2 Eb6:4 C6:4  Ab5:4 C6:2 F6:2 Eb6:2 D6:2 C6:4  B5:4 D6:4 G6:4 F6:2 D6:2
                Eb6:6 C6:2 Ab5:4 C6:4  F6:6 D6:2 Bb5:4 D6:4  G6:8 F6:2 Eb6:2 D6:2 Eb6:2  C6:12 r:4
                Ab6:4 G6:2 F6:2 Eb6:4 C6:4  Bb6:4 Ab6:2 G6:2 F6:4 D6:4  G6:4 F6:2 Eb6:2 D6:4 B5:4  D6:2 B5:2 G5:2 B5:2 D6:4 r:4'''),
]

if __name__ == '__main__':
    out_dir = sys.argv[1]; os.makedirs(out_dir, exist_ok=True)
    for s in SONGS:
        y, loop = render(s)
        wavfile.write(os.path.join(out_dir, s['name'] + '.wav'), SR, (y * 32767).astype(np.int16))
        print(s['name'], f'{loop:.3f}s', len(y))
