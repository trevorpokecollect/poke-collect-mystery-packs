import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {GiveawayEntries} from './shared.jsx';

// Order status page in customer accounts: the app also checks the signed-in customer owns the entries.
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const orderId = shopify.order?.value?.id ?? null;
  return <GiveawayEntries surface="account" orderId={orderId} />;
}
