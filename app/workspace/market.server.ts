// Enable only in the Cardbit environment approved for TCGplayer display by tcgapi.
// Tolerates case, spaces and quotes from dashboard entry ("True", " true", "\"true\"").
export const marketApproved = () =>
  /^\s*["']?true["']?\s*$/i.test(process.env.CARDBIT_TCGPLAYER_MARKET_APPROVED ?? "");
