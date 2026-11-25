import { HOME_SHARE, type Share } from "./shell.server";

// Link-preview text per page (banners in public/site/share/). Pages not listed use the home preview.
const SHARE: Record<string, string> = {
  packs: "Five Cardbit editions of real Pokémon cards. Open a pack online and keep, ship or sell back every pull.",
  chase: "See the chase cards in every Cardbit pack before you open.",
  shop: "Buy real Pokémon singles with Cardbits. They go straight to your vault, ready to ship.",
  "ship-together": "Ship your Cardbit vault cards together in one package.",
  help: "How Cardbit works: buy Cardbits, open packs online, then vault, ship or sell back your real Pokémon cards.",
  welcome: "Join Cardbit email news and text alerts to earn up to 500 free Cardbits.",
};
const PACK_SHARE: Record<string, { name: string; line: string }> = {
  cobalt: { name: "Mystery", line: "One Pokémon card per pack" },
  prism: { name: "Booster", line: "Five Pokémon cards per pack" },
  gold: { name: "Gold", line: "One Pokémon card per pack" },
  ember: { name: "Japanese", line: "One Japanese Pokémon card per pack" },
  amethyst: { name: "Wildcard", line: "One Pokémon card per pack" },
};
const PACK_SLUGS: Record<string, string> = { mystery: "cobalt", booster: "prism", japanese: "ember", wildcard: "amethyst" };
export function shareFor(path: string, title: string): Share {
  const [base, id = ""] = path.split("/");
  const key = base === "packs" ? PACK_SLUGS[id.toLowerCase().replace(/-edition$/, "")] || id.toLowerCase() : "";
  const pack = PACK_SHARE[key];
  if (pack)
    return {
      title: `${pack.name} Edition Pack · cardbit`,
      description: `${pack.line}. Open it online on Cardbit, then keep it in your vault, ship it or sell it back.`,
      image: `cardbit-share-${key}.png`,
      path: "/" + path,
    };
  return { ...HOME_SHARE, title, description: SHARE[base] ?? HOME_SHARE.description, path: "/" + path };
}
