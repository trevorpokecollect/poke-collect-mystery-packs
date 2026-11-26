// Verified Shuffle explainer, shown on /verified-shuffle and given to Ask Latch.
export const SHUFFLE_HOW = `<h2>How It Works</h2>
<ol class="steps">
  <li><b>Before you open,</b> we lock in a secret <em>server seed</em> and show you its fingerprint (SHA-256 hash). Once shown, it can't change.</li>
  <li><b>You can add your own</b> <em>client seed</em>, so we can't know the full input in advance.</li>
  <li><b>Each opening</b> lists the pack's remaining cards in a fixed order and picks from them with your seeds and an opening number (<em>nonce</em>). Each card is drawn once.</li>
  <li><b>Pools change only at a published restock.</b> Each restock saves a numbered pool version with every card ID and a SHA-256 hash, listed on the pack page. Each opening records the version it drew from, and its pool must be that version minus cards already pulled.</li>
  <li><b>Reveal any time.</b> Press Reveal &amp; New Seed and we show the old secret seed. Then Verify recomputes every opening right here in your browser.</li>
</ol>
<p class="fine">Formula: pick <i>i</i> = HMAC-SHA256(server seed, "client seed:nonce:i"), first 13 hex digits as a number, mod the cards left. The card at that spot is removed before the next pick. Card values never change the draw.</p>`;
