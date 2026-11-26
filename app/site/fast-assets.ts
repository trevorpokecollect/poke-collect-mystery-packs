// Right-sized images and fonts in public/site/fast/ (made by scripts/site/optimize-fast-assets.py). Versioned by
// content hash so the site server can tell browsers to keep them for a year.
import manifest from "../../public/site/fast/manifest.json";

const files = manifest as Record<string, string>;

export function fastUrl(name: string): string {
  const hash = files[name];
  if (!hash) throw new Error(`Cardbit fast asset missing from manifest: ${name} (run scripts/site/optimize-fast-assets.py)`);
  return `/site/fast/${name}?v=${hash}`;
}
