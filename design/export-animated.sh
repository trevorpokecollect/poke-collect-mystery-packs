#!/bin/zsh
# Renders design/mystery-pack-animated.html into a looping animated WebP for the pack product image.
# Needs Google Chrome and Python with Pillow (pip install pillow). Usage: design/export-animated.sh [out.webp] [transparent]
# Pass "transparent" as the second argument to drop the dark backdrop (alpha WebP).
# Set SRC=mystery-pack-jp-animated.html (or another variant) to export a different series' art.
set -e
cd "$(dirname "$0")"
OUT=${1:-../public/packs/mystery-pack-animated.webp}
BG=""; MODE=RGB; DEFBG=""
if [ "$2" = "transparent" ]; then BG="&bg=0"; MODE=RGBA; DEFBG="--default-background-color=00000000"; fi
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FRAMES=$(mktemp -d)
for i in $(seq 0 35); do   # 36 frames, 3 s loop at 12 fps
  t=$(python3 -c "print(f'{$i/12:.4f}')")
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=5000 --window-size=900,900 $DEFBG \
    --screenshot="$FRAMES/f-$(printf %02d $i).png" "file://$PWD/${SRC:-mystery-pack-animated.html}?t=$t$BG" >/dev/null 2>&1
done
python3 - "$FRAMES" "$OUT" "$MODE" <<'PY'
import glob, sys
from PIL import Image
frames = [Image.open(f).convert(sys.argv[3]).resize((720, 720), Image.LANCZOS) for f in sorted(glob.glob(sys.argv[1] + "/f-*.png"))]
frames[0].save(sys.argv[2], save_all=True, append_images=frames[1:], duration=83, loop=0, quality=82, method=5)
PY
rm -rf "$FRAMES"
echo "Wrote $OUT"
