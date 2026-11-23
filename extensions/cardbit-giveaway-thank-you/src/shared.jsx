import {useEffect, useState} from 'preact/hooks';

// The app's Railway URL. The app proxy (/apps/packs/campaigns) isn't reachable from checkout, so call the app directly.
const APP_URL = 'https://app-production-74528444.up.railway.app';
const POLL_MS = 3000;
const MAX_POLLS = 20;

// Unit prices in cents, matching what the storefront badges send.
function orderLines() {
  return (shopify.lines?.value ?? []).map((line) => {
    const quantity = line.quantity || 1;
    const total = Number(line.cost?.totalAmount?.amount ?? 0);
    return {
      productId: line.merchandise?.product?.id ?? null,
      variantId: line.merchandise?.id ?? null,
      quantity,
      price: Math.round((total / quantity) * 100),
    };
  });
}

async function fetchEntries(surface, orderId) {
  const token = await shopify.sessionToken.get();
  const url = new URL(`${APP_URL}/api/cardbit-campaign-order-entries`);
  // Also in the query string so the CORS preflight is answered for the right surface.
  url.searchParams.set('surface', surface);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({surface, orderId, lines: orderLines()}),
  });
  if (!response.ok) throw new Error(`order-entries ${response.status}`);
  return response.json();
}

/**
 * "You earned N entries in <giveaway>". While the order webhook is still on its way the app
 * returns an estimate (status "pending"), and this polls until the real entries land.
 */
// eslint-disable-next-line react/prop-types -- Preact extension component, no PropTypes
export function GiveawayEntries({surface, orderId}) {
  const [result, setResult] = useState(/** @type {{status: string, giveaways?: {title: string, entries: number}[]}} */ ({status: 'loading'}));
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer;
    if (!orderId) {
      setResult({status: 'none'});
      return undefined;
    }
    async function poll() {
      polls += 1;
      try {
        const data = await fetchEntries(surface, orderId);
        if (cancelled) return;
        setResult(data);
        if (data.status !== 'pending') return;
      } catch (error) {
        console.error(error);
      }
      if (cancelled) return;
      if (polls < MAX_POLLS) timer = setTimeout(poll, POLL_MS);
      else setSlow(true);
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [surface, orderId]);

  // Orders that earn nothing (or before the first answer) show nothing.
  if (result.status !== 'earned' && result.status !== 'pending') return null;
  const giveaways = result.giveaways ?? [];
  if (!giveaways.length) return null;

  const t = shopify.i18n.translate;
  const total = giveaways.reduce((sum, g) => sum + g.entries, 0);

  if (result.status === 'pending') {
    return (
      <s-section heading={t('pendingHeading')}>
        <s-stack gap="base">
          {giveaways.map((g) => (
            <s-paragraph key={g.title}>{t('pendingBody', {count: g.entries, giveaway: g.title})}</s-paragraph>
          ))}
          {slow ? <s-paragraph color="subdued">{t('slowBody')}</s-paragraph> : <s-spinner accessibilityLabel={t('pendingHeading')} />}
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-section heading={t('earnedHeading', {count: total})}>
      <s-stack gap="base">
        {giveaways.map((g) => (
          <s-stack key={g.title} direction="inline" gap="small-200" alignItems="center">
            <s-badge tone="critical">{`+${g.entries}`}</s-badge>
            <s-text>{t('earnedBody', {count: g.entries, giveaway: g.title})}</s-text>
          </s-stack>
        ))}
      </s-stack>
    </s-section>
  );
}
