// Verified Shuffle explainer, shown on /verified-shuffle and given to Ask Latch.
export const SHUFFLE_HOW = `<h2>How It Works</h2>
<ol class="steps">
  <li><b>Before you open,</b> we lock in a secret <em>server seed</em> and show you its fingerprint (SHA-256 hash). Once shown, it can't change.</li>
  <li><b>You can add your own</b> <em>client seed</em>, so we can't know the full input in advance.</li>
  <li><b>Each opening</b> lists the pack's remaining cards in a fixed order and picks from them with your seeds and an opening number (<em>nonce</em>). Each card is drawn once.</li>
  <li><b>No repeats in a pack.</b> A pack never holds two copies of the same card (same printing, any condition). Every possible pack of different cards is equally likely, and the odds on each pack page are counted the same way. If a pool doesn't have enough different cards left for a full pack, that pack shows sold out until the next restock.</li>
  <li><b>Pools change only at a published restock.</b> Each restock saves a numbered pool version with every card ID and a SHA-256 hash, listed on the pack page. Each opening records the version it drew from, and its pool must be that version minus cards already pulled.</li>
  <li><b>Reveal any time.</b> Press Reveal &amp; New Seed and we show the old secret seed. Then Verify recomputes every opening right here in your browser.</li>
</ol>
<p class="fine">Formula: every possible pack made of different cards is numbered (printings in the order their first copy appears in the list, copies in list order; for each printing, the packs that include it come first, then the packs that skip it). Pack number = HMAC-SHA256(server seed, "client seed:nonce"), all 64 hex digits as a number, mod the number of possible packs. Card values never change the draw.</p>
<p class="fine">Openings before November 27, 2026 used the earlier formula and still verify with it: pick <i>i</i> = HMAC-SHA256(server seed, "client seed:nonce:i"), first 13 hex digits as a number, mod the cards left, with each pick removed before the next. Every seed in use when the rule changed was revealed, so every opening under the new rule uses a seed locked in after the rule was published.</p>`;
