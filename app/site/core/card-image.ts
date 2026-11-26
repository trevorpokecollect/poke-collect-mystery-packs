/**
 * Card art for a cardbit.com copy (Nov 26 2026, Trevor: some cards showed "Artwork Unavailable").
 * Card Broker sends an image with each intake, but some catalog rows (new promos especially) arrive without one.
 * Every copy with a TCGplayer product id has that product's image on TCGplayer's CDN, so it is the fallback.
 * The URL shape matches what Card Broker sends and what cardbit-card-media.js turns into a 500/1000 srcset.
 */
export const tcgplayerImage = (tcgplayerId: number | null | undefined): string | null =>
  Number.isSafeInteger(tcgplayerId) && (tcgplayerId as number) > 0
    ? `https://product-images.tcgplayer.com/fit-in/1000x1000/${tcgplayerId}.jpg`
    : null;

/** The stored image when there is one, else the TCGplayer product image for the copy's product. */
export const cardImage = (c: { image?: string | null; tcgplayerId?: number | null }): string | null =>
  (typeof c.image === "string" && c.image.trim() ? c.image : null) ?? tcgplayerImage(c.tcgplayerId);
