import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {GiveawayEntries} from './shared.jsx';

// Thank-you page: the order id is a gid://shopify/OrderIdentity/<id> that matches the order's id.
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const orderId = shopify.orderConfirmation?.value?.order?.id ?? null;
  return <GiveawayEntries surface="checkout" orderId={orderId} />;
}
