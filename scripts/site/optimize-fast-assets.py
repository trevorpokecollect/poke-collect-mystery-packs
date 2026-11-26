#!/usr/bin/env python3
"""Right-sized copies of the waitlist / loader images and fonts in public/site/fast/ (Nov 26 2026 speed pass).

The theme port (scripts/site/port-theme.mjs) wipes public/site/assets, so the small copies live here instead.
Re-run after changing a source image:  pip install pillow fonttools brotli && python3 scripts/site/optimize-fast-assets.py
Writes public/site/fast/manifest.json (file -> content hash) that app/site/fast-assets.ts reads for ?v= cache busting.
"""
import hashlib, io, json, os, glob
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "site")
OUT = os.path.join(ROOT, "fast")
os.makedirs(OUT, exist_ok=True)
made = {}

def webp(src, name, width, q=80):
    im = Image.open(os.path.join(ROOT, src))
    if im.size[0] > width:
        im = im.resize((width, round(im.size[1] * width / im.size[0])), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=q, method=6)
    data = buf.getvalue()
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(data)
    made[name] = hashlib.sha256(data).hexdigest()[:10]

# Pack wrappers: shown at most ~290 CSS px wide, so 480 px covers 2x screens (source is 842 px).
for p in ["mystery", "booster", "gold", "japanese", "wildcard"]:
    webp(f"assets/cardbit-latch-pack-{p}.webp", f"pack-{p}.webp", 480, 80)
    # Dimmed, blurred side packs in the hero are drawn at most ~290 CSS px under a blur, so 300 px is plenty.
    webp(f"assets/cardbit-latch-pack-{p}.webp", f"pack-{p}-side.webp", 300, 72)
webp("assets/cardbit-card-back-en.webp", "card-back-en.webp", 400, 78)
webp("assets/cardbit-card-back-ja-modern.webp", "card-back-ja-modern.webp", 400, 78)
# Card scans: 400 px for the big flips, 200 px for the small Vault / Daily Spin / closing tiles.
for path in sorted(glob.glob(os.path.join(ROOT, "waitlist", "cards", "*.webp"))):
    slug = os.path.basename(path)[:-5]
    webp(f"waitlist/cards/{slug}.webp", f"card-{slug}.webp", 400, 78)
    webp(f"waitlist/cards/{slug}.webp", f"card-{slug}-sm.webp", 200, 76)
webp("assets/cardbit-brand-lockup.webp", "brand-lockup.webp", 400, 85)
webp("waitlist/latch-full.webp", "latch-full.webp", 400, 82)
webp("waitlist/latch-cheer.webp", "latch-cheer.webp", 360, 82)
webp("assets/cardbit-latch-cheer.webp", "latch-cheer-icon.webp", 160, 82)
webp("assets/cardbit-bits-card-emblem.png", "bits-card-emblem.webp", 120, 85)
webp("assets/cardbit-brand-emblem.png", "brand-emblem.webp", 128, 88)

# Body font: same Atkinson Hyperlegible Next file, WOFF2 instead of WOFF (about 40% smaller).
from fontTools.ttLib import TTFont
font = TTFont(os.path.join(ROOT, "assets", "cardbit-type-atkinson.woff"))
font.flavor = "woff2"
dest = os.path.join(OUT, "atkinson.woff2")
font.save(dest)
made["atkinson.woff2"] = hashlib.sha256(open(dest, "rb").read()).hexdigest()[:10]

# The Latch shuffle loader clip and poster are rendered in Blender (see docs/CARDBIT-WAITLIST.md); keep their hashes.
for name in ["latch-shuffle.mp4", "latch-shuffle-poster.webp"]:
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        made[name] = hashlib.sha256(open(path, "rb").read()).hexdigest()[:10]

with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(dict(sorted(made.items())), f, indent=1)
    f.write("\n")
total = sum(os.path.getsize(os.path.join(OUT, n)) for n in made)
print(f"wrote {len(made)} files, {total // 1024} KB")
