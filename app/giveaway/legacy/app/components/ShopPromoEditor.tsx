import { useAppBridge } from "@shopify/app-bridge-react";
import type { CampaignSettings } from "../lib/settings";
import { Check, TextInput } from "./fields";

type Shop = CampaignSettings["shop"];

// "Shop & earn" on the storefront: the purchase-entry rate, a Shop now button, and up to
// six example products showing the entries each one earns.
export function ShopPromoEditor(props: {
  shop: Shop;
  onChange: (shop: Shop) => void;
}) {
  const shopify = useAppBridge();
  const s = props.shop;
  const set = (patch: Partial<Shop>) => props.onChange({ ...s, ...patch });

  const pick = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: 6,
      selectionIds: s.products.map((p) => ({ id: p.id })),
    });
    if (!selected) return;
    set({
      products: selected.slice(0, 6).map((p) => ({
        id: p.id,
        title: p.title,
        imageUrl: p.images?.[0]?.originalSrc ?? null,
        price: Number(p.variants?.[0]?.price ?? 0),
      })),
    });
  };

  return (
    <s-section heading="Shop & earn">
      <s-stack gap="base">
        <Check
          label="Show purchase entries under the bonus entries"
          details="Shows your purchase-entry rate with a Shop now button. Hidden when purchases don't earn entries."
          checked={s.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        {s.enabled && (
          <>
            <TextInput
              label="Shop now link"
              value={s.url}
              details="A page on your store, e.g. /collections/all or /collections/booster-boxes."
              onChange={(url) => set({ url })}
            />
            <s-stack gap="small-200">
              <s-text>Example products</s-text>
              <s-text color="subdued">
                Up to six products, each shown with its price and the entries
                it earns. With none picked, the store shows the first six from
                the Shop now collection (Popular Picks when the link is
                /collections/all).
              </s-text>
              {s.products.length > 0 && (
                <s-stack gap="small-200">
                  {s.products.map((p) => (
                    <s-stack
                      key={p.id}
                      direction="inline"
                      gap="base"
                      alignItems="center"
                    >
                      {p.imageUrl && (
                        <s-thumbnail src={p.imageUrl} alt={p.title} size="small" />
                      )}
                      <s-text>{p.title}</s-text>
                      <s-button
                        variant="tertiary"
                        icon="x"
                        accessibilityLabel={`Remove ${p.title}`}
                        onClick={() =>
                          set({
                            products: s.products.filter((x) => x.id !== p.id),
                          })
                        }
                      />
                    </s-stack>
                  ))}
                </s-stack>
              )}
              <s-stack direction="inline">
                <s-button onClick={pick}>
                  {s.products.length ? "Change products" : "Choose products"}
                </s-button>
              </s-stack>
            </s-stack>
          </>
        )}
      </s-stack>
    </s-section>
  );
}
