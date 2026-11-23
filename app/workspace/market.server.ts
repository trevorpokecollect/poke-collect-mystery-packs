// Enable only in the Cardbit environment approved for TCGplayer display by tcgapi.
export const marketApproved = () =>
  process.env.CARDBIT_TCGPLAYER_MARKET_APPROVED === "true";
