import numpy as np, wave, sys
SR = 44100
DUR = 30.6
N = int(SR * DUR)
rng = np.random.default_rng(7)
music = np.zeros((N, 2)); sfx = np.zeros((N, 2))
BPM = 120; BEAT = 60 / BPM

def T(n): return np.arange(n) / SR
def env_adsr(n, a=.005, d=.1, s=.6, r=.1):
    t = T(n); e = np.ones(n) * s
    ai = int(a*SR); di = int(d*SR); ri = int(r*SR)
    if ai: e[:ai] = np.linspace(0, 1, ai)
    if di: e[ai:ai+di] = np.linspace(1, s, len(e[ai:ai+di]))
    if ri: e[-ri:] *= np.linspace(1, 0, ri)
    return e
def add(buf, t0, sig, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N: return
    if sig.ndim == 1:
        l = np.sqrt((1 - pan) / 2); r = np.sqrt((1 + pan) / 2)
        sig = np.stack([sig * l, sig * r], 1) * np.sqrt(2)
    j = min(N, i + len(sig))
    if i < 0: sig = sig[-i:]; i = 0
    buf[i:j] += sig[:j - i] * gain
def lp(x, a):  # one-pole lowpass, a in (0,1); vectorized via lfilter-like loop on chunks
    y = np.empty_like(x); acc = 0.0
    for k in range(len(x)):
        acc += a * (x[k] - acc); y[k] = acc
    return y
def lp_sweep(x, a0, a1):
    a = np.linspace(a0, a1, len(x)); y = np.empty_like(x); acc = 0.0
    for k in range(len(x)):
        acc += a[k] * (x[k] - acc); y[k] = acc
    return y
def hp(x, a): return x - lp(x, a)
def saw(f, n, detune=0):
    t = T(n); out = np.zeros(n)
    for d in ([0] if not detune else [-detune, 0, detune]):
        ph = (t * f * (1 + d)) % 1.0; out += 2 * ph - 1
    return out / (1 if not detune else 3)
def sq(f, n): return np.sign(np.sin(2 * np.pi * f * T(n)))
def sine(f, n): return np.sin(2 * np.pi * f * T(n))
def note(m): return 440 * 2 ** ((m - 69) / 12)

# ---------- drums ----------
def kick():
    n = int(.45 * SR); t = T(n)
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7) * 1.0 + rng.standard_normal(n) * np.exp(-t * 200) * .25
def clap():
    n = int(.3 * SR); t = T(n); nz = rng.standard_normal(n)
    e = np.exp(-t * 18) + .6 * np.exp(-np.maximum(t - .012, 0) * 60) * (t > .012) + .5 * np.exp(-np.maximum(t - .024, 0) * 60) * (t > .024)
    return hp(nz, .25) * e * .5
def hat(open_=False):
    n = int((.25 if open_ else .06) * SR); t = T(n)
    return hp(rng.standard_normal(n), .7) * np.exp(-t * (14 if open_ else 70)) * .22
def snare():
    n = int(.25 * SR); t = T(n)
    return (hp(rng.standard_normal(n), .3) * np.exp(-t * 22) * .45 + sine(190, n) * np.exp(-t * 30) * .4)

K, C, H, HO, S = kick(), clap(), hat(), hat(True), snare()

# sections: (start, end, intensity)
def drums(t0, t1, hats16=False, claps=True, kick_on=True):
    b = int(np.ceil(t0 / BEAT * 4));
    while b / 4 * BEAT < t1:
        t = b / 4 * BEAT; pos = b % 16
        if kick_on and b % 4 == 0: add(music, t, K, .95)
        if claps and b % 8 == 4: add(music, t, C, .7)
        if b % 2 == 0 and b % 4 != 0: add(music, t, HO if pos in (2, 10) else H, .55, .25)
        if hats16 and b % 2 == 1: add(music, t, H, .32, -.25)
        b += 1

# ---------- harmony: Am F C G, one chord per bar (2 s) ----------
PROG = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [52, 55, 60]), (55, [55, 59, 62])]
def chord_at(t): return PROG[int(t // (4 * BEAT)) % 4]

def bass(t0, t1, gain=.5):
    s = t0
    k = int(np.ceil(t0 / (BEAT / 2)))
    while k * BEAT / 2 < t1:
        t = k * BEAT / 2; root = chord_at(t)[0] - 12
        n = int(BEAT / 2 * SR * .95)
        x = saw(note(root + (12 if k % 4 == 3 else 0)), n, .004)
        x = lp(x, .08) * env_adsr(n, .003, .08, .5, .04)
        x += sine(note(root - 12), n) * env_adsr(n, .003, .1, .7, .04) * .6
        add(music, t, x, gain)
        k += 1
def arp(t0, t1, gain=.16):
    k = int(np.ceil(t0 / (BEAT / 4)))
    while k * BEAT / 4 < t1:
        t = k * BEAT / 4; ch = chord_at(t)[1]
        m = ch[k % 3] + 12 + (12 if (k // 3) % 2 else 0)
        n = int(BEAT / 4 * SR * .9)
        x = (sq(note(m), n) * .5 + saw(note(m), n) * .5)
        x = lp(x, .22) * np.exp(-T(n) * 18)
        add(music, t, x, gain, .35 if k % 2 else -.35)
        k += 1
def pad(t0, t1, gain=.12, bright=.06):
    bar = 4 * BEAT
    k = int(t0 // bar)
    while k * bar < t1:
        s = max(t0, k * bar); e = min(t1, (k + 1) * bar); n = int((e - s) * SR)
        if n <= 0: k += 1; continue
        ch = chord_at(s)[1]; x = np.zeros(n)
        for m in ch: x += saw(note(m), n, .006) + saw(note(m + 12), n, .008) * .5
        x = lp(x, bright) * env_adsr(n, .08, .2, .85, .15)
        add(music, s, np.stack([x, np.roll(x, 300)], 1) * .7, gain)
        k += 1
def lead_hits(times_notes, gain=.22):
    for t, m in times_notes:
        n = int(.35 * SR); x = saw(note(m), n, .01) + saw(note(m + 12), n, .01) * .4
        x = lp(x, .3) * np.exp(-T(n) * 6)
        add(music, t, x, gain)

# Intro 0 - 3.2: drone + glitch + riser
n = int(3.3 * SR); dr = (saw(note(33), n, .003) + sine(note(21), n)) ; dr = lp(dr, .02) * np.linspace(0, 1, n) ** .5
add(music, 0, dr, .35)
pad(0, 3.2, .07, .03)
add(music, .95, K, 1.0); add(music, 1.25, K, 1.0); add(music, 2.0, K, .9); add(music, 2.5, K, .9); add(music, 3.0, K, .9)
# Groove 3.2 - 11.2
drums(3.2, 11.2, hats16=False); bass(3.2, 11.2); pad(3.2, 11.2, .1); arp(5.2, 11.2, .12)
# Build 11.2 - 13.4
pad(11.2, 13.4, .12, .04); bass(11.2, 12.0, .4)
for i in range(32):
    t = 11.2 + 2.1 * (1 - (1 - i / 32) ** 1.6)
    add(music, t, S, .18 + .5 * i / 32)
n = int(2.3 * SR); rs = hp(rng.standard_normal(n), .2); rs = lp_sweep(rs, .02, .6) * np.linspace(0, 1, n) ** 2
add(music, 11.2, rs, .35)
# Drop 14.0 - 18.2 (big)
drums(14.0, 18.2, hats16=True); bass(14.0, 18.2, .55); pad(14.0, 18.2, .15, .12); arp(14.0, 18.2, .16)
lead_hits([(14.0, 76), (14.5, 76), (15.0, 79), (15.5, 81), (16.0, 77), (16.5, 77), (17.0, 76), (17.5, 74)], .16)
# Odds + vault 18.2 - 26.6
drums(18.2, 26.4, hats16=False); bass(18.2, 26.4, .45); pad(18.2, 26.6, .1); arp(18.2, 26.4, .1)
for i in range(16):
    add(music, 25.6 + i * .06, S, .1 + .4 * i / 16)
# Final 26.6 - 30
drums(26.6, 29.4, hats16=True); bass(26.6, 29.4, .55); pad(26.6, 30.4, .15, .12); arp(26.6, 29.4, .15)
lead_hits([(26.6, 76), (27.0, 79), (27.5, 81), (28.0, 84)], .16)
# end stinger chord
n = int(1.4 * SR); x = np.zeros(n)
for m in [57, 64, 69, 72, 76]: x += saw(note(m), n, .008)
x = lp(x, .15) * np.exp(-T(n) * 2.2)
add(music, 29.4, x, .18); add(music, 29.4, K, 1.0)

# ---------- SFX ----------
def whoosh(dur=.5, up=True):
    n = int(dur * SR); x = rng.standard_normal(n)
    x = lp_sweep(x, .02, .35) if up else lp_sweep(x, .35, .02)
    e = np.sin(np.pi * np.linspace(0, 1, n)) ** 2
    return x * e * .6
def boom():
    n = int(1.2 * SR); t = T(n); f = 30 + 90 * np.exp(-t * 10)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2)
    nz = lp(rng.standard_normal(n), .08) * np.exp(-t * 6) * .6
    return (s + nz) * .9
def pop(f=900):
    n = int(.12 * SR); t = T(n); fr = f * (1 + 1.5 * np.exp(-t * 60))
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 35) * .5
def click():
    n = int(.04 * SR); return hp(rng.standard_normal(n), .5) * np.exp(-T(n) * 150) * .7
def ding(f=1320, dur=.9):
    n = int(dur * SR); t = T(n)
    return (sine(f, n) + .5 * sine(f * 2.01, n) + .25 * sine(f * 3.02, n)) * np.exp(-t * 5) * .28
def chime(base=880):
    out = np.zeros(int(1.2 * SR))
    for i, r in enumerate([1, 1.25, 1.5, 2]):
        d = ding(base * r, .9); s = int(i * .07 * SR); out[s:s + len(d)] += d[:len(out) - s]
    return out
def shimmer(dur=1.6, base=1760):
    n = int(dur * SR); t = T(n); x = np.zeros(n)
    for i in range(14):
        f = base * (1 + .5 * rng.random()); s = int(rng.random() * n * .6)
        d = ding(f, .6) * .5; x[s:s + len(d)] += d[:n - s]
    return x * np.exp(-t * 1.2)
def glitch(dur=.25):
    n = int(dur * SR); x = np.zeros(n); k = 0
    while k < n:
        L_ = int(rng.integers(200, 1600)); f = rng.choice([220, 440, 880, 1760, 3520])
        seg = sq(f, min(L_, n - k)) * (rng.random() > .3)
        x[k:k + len(seg)] = seg; k += L_
    return x * .18
def tear(dur=.55):
    n = int(dur * SR); t = T(n); x = rng.standard_normal(n)
    crackle = (rng.random(n) > .985).astype(float) * rng.standard_normal(n) * 3
    x = hp(lp_sweep(x + crackle, .1, .6), .05)
    return x * np.linspace(.3, 1, n) * .5
def rumble(dur):
    n = int(dur * SR); t = T(n)
    x = lp(rng.standard_normal(n), .01) * 6 + sine(42, n) * .4
    return x * np.linspace(0, 1, n) ** 1.5 * .5
def swish():
    n = int(.22 * SR); x = lp_sweep(rng.standard_normal(n), .4, .05)
    return x * np.sin(np.pi * np.linspace(0, 1, n)) * .45
def mech():
    n = int(.05 * SR); t = T(n); return (sq(220, n) * .3 + hp(rng.standard_normal(n), .4)) * np.exp(-t * 90) * .4
def cash():
    return np.concatenate([click(), np.zeros(int(.02 * SR))]) if False else ding(2093, .6) + np.pad(ding(2637, .6), (int(.08 * SR), 0))[:int(.6 * SR)]

# intro
for t0 in (.15, .45, .8): add(sfx, t0, glitch(), .8, rng.uniform(-.5, .5))
add(sfx, .95, boom(), .9); add(sfx, 1.25, boom(), .9); add(sfx, 1.8, pop(700), .7)
add(sfx, 2.85, whoosh(.5), .5)
# packs
for t0, p in ((3.55, -.6), (3.7, .6), (3.85, 0)): add(sfx, t0, whoosh(.45), .6, p)
add(sfx, 4.15, boom(), .45)
for t0, p in ((4.6, -.5), (4.7, 0), (4.8, .5)): add(sfx, t0, pop(1100), .55, p)
add(sfx, 5.4, pop(800), .6); add(sfx, 5.45, ding(1568, .7), .5)
# buy
add(sfx, 7.25, whoosh(.45), .55); add(sfx, 7.45, swish(), .5)
add(sfx, 7.9, pop(900), .5); add(sfx, 8.6, click(), 1.0); add(sfx, 8.64, cash(), .8)
add(sfx, 9.1, pop(1000), .5); add(sfx, 9.6, chime(1046), .5)
# open
add(sfx, 11.25, whoosh(.5), .55)
add(sfx, 11.8, rumble(1.6), .8)
add(sfx, 12.9, tear(.6), .9)
add(sfx, 13.45, boom(), 1.0); add(sfx, 13.48, whoosh(.6, up=False), .5)
add(sfx, 13.6, whoosh(.7), .5)
add(sfx, 14.55, swish(), .7)
add(sfx, 14.85, shimmer(1.8, 1568), .8); add(sfx, 14.85, chime(784), .6)
add(sfx, 15.1, boom(), .7)
for i in range(5):
    add(sfx, 16.3 + i * .18, swish(), .55, (i - 2) * .3)
    add(sfx, 16.72 + i * .18, ding([1046, 1046, 1175, 1318, 1568][i], .5), .45, (i - 2) * .3)
add(sfx, 17.6, shimmer(1.0, 2093), .4)
# odds
add(sfx, 18.2, whoosh(.45), .5)
for i in range(4): add(sfx, 18.65 + i * .16, pop(800 + i * 150), .5, (-1) ** i * .3)
add(sfx, 19.6, chime(1318), .55)
# vault
add(sfx, 21.75, whoosh(.45, up=False), .5); add(sfx, 22.0, boom(), .4)
for k in range(24): add(sfx, 22.3 + k * .095, mech(), .35)
for i in range(8):
    add(sfx, 22.4 + i * .26, swish(), .5, (1 if i % 2 else -1) * .5)
    add(sfx, 22.85 + i * .26, ding(1760 + i * 60, .3), .3)
add(sfx, 24.75, chime(1046), .7); add(sfx, 24.75, shimmer(1.2, 2093), .5)
add(sfx, 24.8, boom(), .5); add(sfx, 25.1, boom(), .55); add(sfx, 25.5, pop(900), .5)
# cta
add(sfx, 26.55, whoosh(.4), .5); add(sfx, 26.6, boom(), .8); add(sfx, 26.85, boom(), .8)
for t0, p in ((27.0, -.6), (27.1, .6), (27.2, 0)): add(sfx, t0, whoosh(.4), .5, p)
add(sfx, 27.8, pop(1000), .6); add(sfx, 27.85, cash(), .5)
add(sfx, 28.4, shimmer(1.6, 1760), .55)

# ---------- mix ----------
# duck music under big impacts
duck = np.ones(N)
for t0 in (.95, 1.25, 13.45, 15.1, 26.6, 26.85):
    i = int(t0 * SR); n = int(.5 * SR); duck[i:i + n] = np.minimum(duck[i:i + n], .45 + .55 * np.linspace(0, 1, len(duck[i:i + n])))
# silence gap before the rip
i0, i1 = int(13.05 * SR), int(13.45 * SR); duck[i0:i1] = np.minimum(duck[i0:i1], np.linspace(1, .15, i1 - i0))
mix = music * duck[:, None] * .8 + sfx * .9
# fade out
fo = int(.8 * SR); mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
mix = np.tanh(mix * 1.1)
mix /= np.max(np.abs(mix)) / .92
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print('ok', mix.shape)
