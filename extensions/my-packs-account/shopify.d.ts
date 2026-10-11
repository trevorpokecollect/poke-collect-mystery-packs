import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/MyPacksBlock.jsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.order-index.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
