"""Full-length arrangements of the six Cardbit opening songs (about 2 to 2.5 minutes each, with an intro,
a breakdown and a real ending instead of a loop). Same voices and melodies as the opening loops.
Usage: python3 scripts/audio/cardbit-soundtrack-full.py OUT_DIR (then ffmpeg -b:a 192k into assets/soundtrack/)
"""
import sys, os
import numpy as np
from scipy.io import wavfile
import importlib.util as _u, os as _o
_spec = _u.spec_from_file_location("chiptunes", _o.path.join(_o.path.dirname(__file__), "cardbit-opening-songs.py")); C = _u.module_from_spec(_spec); _spec.loader.exec_module(C)
globals().update({k: getattr(C, k) for k in "SR hz parse_mel chord pulse tri adsr lp hp kick snare hat tom Mix".split()})

def plan_for(nbars):
    A = list(range(nbars // 2)); B = list(range(nbars // 2, nbars))
    P = []
    def sec(srcs, **f):
        for k, s in enumerate(srcs):
            P.append({**dict(src=s, lead=True, arp=True, bass=True, drums='full', double=False, fill=(k % 8 == 7), lead_up=False), **f})
    sec(A[:4], lead=False, drums='none')                       # intro: chords and bass
    for k in (2, 3): P[k]['drums'] = 'light'
    P[3]['fill'] = True
    sec(A); sec(B, double=True)                                # first pass
    sec(A, double=True); sec(B, double=True)                   # second pass, fuller
    sec(A, drums='light', arp=True, bass=False, lead_soft=True)  # breakdown: echoey, no bass
    P[-1]['fill'] = True
    sec(B, drums='light', lead_soft=True)                      # build back up
    P[-1]['fill'] = True
    sec(A, double=True, tr=2); sec(B, double=True, tr=2)       # last pass, a whole step up
    P.append(dict(src='end', lead=False, arp=False, bass=True, drums='end', double=False, fill=False, lead_up=False, tr=2))
    P.append(dict(src='hold', lead=False, arp=False, bass=False, drums='none', double=False, fill=False, lead_up=False, tr=2))
    return P

def render_full(song):
    bpm = song['bpm']; S16 = 60 / bpm / 4; BAR = 16 * S16
    mel, steps = parse_mel(song['melody'])
    bars = song['chords'].split(); nb = len(bars)
    swing = song.get('swing', 0.0); duty = song.get('duty', .25)
    P = plan_for(nb)
    total = len(P) * BAR + 3.0
    N = int(total * SR)
    lead, harm, arp, bass, drum = Mix(N), Mix(N), Mix(N), Mix(N), Mix(N)
    by_bar = {}
    for step, m, l in mel: by_bar.setdefault(step // 16, []).append((step % 16, m, l))
    def at(ob, i):
        s = (ob * 16 + i) * S16
        if swing and i % 4 == 2: s += swing * S16
        return int(s * SR)
    tonic = bars[0]
    for ob, p in enumerate(P):
        src = p['src']
        cname = tonic if src in ('end', 'hold') else bars[src]
        root, iv = chord(cname); tr = p.get('tr', 0); root += tr
        tones = [root + 36 + x for x in iv] + [root + 48]
        if src == 'end':   # final chord: one big strum and a held lead on the tonic
            for k, m in enumerate(tones):
                n = int(BAR * 2 * SR)
                arp.add(pulse(hz(m), n, .25, vib=.12) * adsr(n, .004, .9, .25, .4, BAR * 1.6), at(ob, 0) + int(k * .03 * SR), .07, -.4 + k * .25)
            n = int(BAR * 2 * SR)
            lead.add(pulse(hz(root + 48), n, duty, vib=.25) * adsr(n, .004, .6, .5, .5, BAR * 1.5), at(ob, 0), .2)
        # lead
        if p['lead'] and isinstance(src, int):
            prev = None
            for i, m, l in by_bar.get(src, []):
                if m is None: prev = None; continue
                gate = l * S16 * .92; n = int((gate + .12) * SR)
                slide = hz(prev + tr) if (song.get('slide') and prev and abs(prev - m) <= 2 and l >= 2) else None
                m += tr
                s = pulse(hz(m), n, duty, vib=.22 if l >= 6 else 0, slide_from=slide) * adsr(n, .003, .1, .7, .04, gate)
                lead.add(s, at(ob, i), .11 if p.get('lead_soft') else .2)
                if p['double'] and song.get('double', True):
                    d = pulse(hz(m - 12), n, .5) * adsr(n, .003, .1, .6, .04, gate)
                    harm.add(d, at(ob, i), .07, .4)
                prev = m - tr
        # arp / accompaniment
        if p['arp'] and isinstance(src, int):
            style = song['arp']
            for i in range(16):
                t0 = at(ob, i)
                if style in ('run', 'updown'):
                    seq = tones if style == 'run' else tones + tones[-2:0:-1]
                    m = seq[i % len(seq)]; n = int(S16 * .8 * SR)
                    arp.add(pulse(hz(m), n, .125) * adsr(n, .002, .04, .3, .02), t0, .07, -.4)
                elif style == 'stab' and i % 4 == 2:
                    for m in tones[:3]:
                        n = int(S16 * 1.4 * SR); arp.add(pulse(hz(m), n, .25) * adsr(n, .002, .06, .2, .03), t0, .045, -.35)
                elif style == 'pad' and i % 8 == 0:
                    for k, m in enumerate(tones[:3]):
                        n = int(S16 * 7.5 * SR)
                        arp.add(pulse(hz(m), n, .125, vib=.08) * adsr(n, .05, .4, .45, .1), t0 + int(k * S16 * SR), .045, -.4 + k * .3)
        # bass
        if p['bass']:
            if src == 'end':
                n = int(BAR * 1.5 * SR); bass.add(tri(hz(root + 12), n) * adsr(n, .002, .8, .3, .3, BAR), at(ob, 0), .34)
            else:
                pat = {
                    'oct8':   [(i, (0 if i % 4 == 0 else 12), 2) for i in range(0, 16, 2)],
                    'drive':  [(i, (12 if i % 2 else 0), 1) for i in range(16)],
                    'walk':   [(0, 0, 4), (4, 7, 4), (8, 12, 4), (12, 7, 4)],
                    'sync':   [(0, 0, 3), (3, 0, 3), (6, 12, 2), (8, 0, 3), (11, 7, 3), (14, 12, 2)],
                    'gallop': [(i + o, 0 if i < 8 else (7 if i < 12 else 12), 2 if o == 0 else 1) for i in range(0, 16, 4) for o in (0, 2, 3)],
                    'boss':   [(i, (12 if i in (6, 14) else 0), 2) for i in range(0, 16, 2)],
                }[song['bass']]
                for i, semi, l in pat:
                    n = int(l * S16 * .95 * SR)
                    bass.add(tri(hz(root + 12 + semi), n) * adsr(n, .002, .2, .8, .02, l * S16 * .9), at(ob, i), .3)
        # drums
        dk = p['drums']
        if dk == 'end':
            drum.add(kick(), at(ob, 0), .6); drum.add(snare(), at(ob, 0), .4); drum.add(hat(True), at(ob, 0), .3, .2)
        elif dk in ('full', 'light'):
            dp = song['drums']; light = dk == 'light'
            for i in range(16):
                t0 = at(ob, i)
                if p['fill'] and i >= 12:
                    drum.add(tom([260, 210, 170, 130][i - 12]) if dp != 'shuffle' else snare(), t0, .5); continue
                if light:
                    if i in (0, 8): drum.add(kick(), t0, .45)
                    if i % 4 == 2: drum.add(hat(), t0, .25, .2)
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
    d = int(S16 * 3 * SR); e = song.get('echo', .28)
    echo = Mix(N)
    echo.L[d:] += lead.R[:-d] * e * .2; echo.R[d:] += lead.L[:-d] * e * .6
    echo.L[2 * d:] += lead.L[:-2 * d] * e * .3
    L = lead.L + harm.L + arp.L + lp(bass.L, 2400) + drum.L + echo.L
    R = lead.R + harm.R + arp.R + lp(bass.R, 2400) + drum.R + echo.R
    st = np.stack([L, R], 1)
    st = hp(st.T, 35).T; st = lp(st.T, 11000).T
    # trim trailing silence, short fade at the very end
    end = int((len(P) * BAR + 1.5) * SR); st = st[:end]
    f = int(.4 * SR); st[-f:] *= np.linspace(1, 0, f)[:, None]
    st = np.tanh(st * 1.2) / 1.2
    rms = np.sqrt(np.mean(st[:int(len(P) * BAR * SR)] ** 2)); st *= 10 ** (-16 / 20) / rms   # a bit louder than in-site: for listening on its own
    pk = np.max(np.abs(st))
    if pk > .97: st *= .97 / pk
    return st

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    for s in C.SONGS:
        y = render_full(s)
        wavfile.write(os.path.join(out, s['name'] + '.wav'), SR, (y * 32767).astype(np.int16))
        print(s['name'], f'{len(y) / SR:.1f}s')
