/* Shared by the two rehearsal adapters and the storefront. All rates are fixtures. */
(function install(root) {
  'use strict';
  const destinations = Object.freeze({
    madison: {label: 'Madison, AL', cents: 495},
    seattle: {label: 'Seattle, WA', cents: 695}
  });
  function selection(input) {
    if (!Object.hasOwn(destinations, input.destination) || !Array.isArray(input.copyIds) ||
        !input.copyIds.length || input.copyIds.some(id => typeof id !== 'string' || !id || id.length > 180)) return null;
    const ids = [...new Set(input.copyIds)].sort();
    if (ids.length !== input.copyIds.length) return null;
    return {ids, destination: input.destination, rateCents: destinations[input.destination].cents};
  }
  function normalize(text) {
    return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/[’‘]/g,"'").trim().replace(/\s+/g,' ');
  }
  function legacyPrintingKey(card) {
    const raw=normalize(card.set || card.setName);
    const aliases={'sv07: stellar crown':'stellar crown','sv08: surging sparks':'surging sparks',
      'sv09: journey together':'journey together','sv10: destined rivals':'destined rivals'};
    return JSON.stringify([normalize(card.language),aliases[raw]||raw,normalize(card.number || card.name),normalize(card.printing)]);
  }
  let indexedCatalog;
  let primaryIds = new Map();

  function printingKey(card) {
    const key = legacyPrintingKey(card);
    const id = String(card.tcgplayerId || card.catalogId || '');
    if (!id) return key;

    // Some Japanese foil patterns have the same collector number and finish.
    // Retain the existing link and want-list entry for the original result.
    const catalog = root.CardbitStock?.cards;
    if (catalog && catalog !== indexedCatalog) {
      const firstByKey = new Map();
      for (const item of catalog) {
        const catalogId = item.tcgplayerId || item.catalogId;
        if (!catalogId) continue;
        const originalKey = legacyPrintingKey(item);
        if (!firstByKey.has(originalKey)) firstByKey.set(originalKey, String(catalogId));
      }
      indexedCatalog = catalog;
      primaryIds = firstByKey;
    }
    const primary = primaryIds.get(key);
    return primary && primary !== id ? JSON.stringify([...JSON.parse(key), id]) : key;
  }

  const rules = Object.freeze({destinations, selection, printingKey, normalize});
  root.CardbitCollectorRules = rules;
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
})(globalThis);
