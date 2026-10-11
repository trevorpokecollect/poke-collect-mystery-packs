import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createSeries } from "../lib/series.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const title = String(form.get("title") || "").trim();
  const packVariantId = String(form.get("packVariantId") || "");
  const autoOpenDays = Number(form.get("autoOpenDays") || 1);
  if (!title || !packVariantId) return { error: "Give the series a name and pick its pack product." };

  try {
    const series = await createSeries(admin, session.shop, { title, packVariantId, autoOpenDays });
    return redirect(`/app/series/${series.id}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't create the series." };
  }
};

export default function NewSeries() {
  const shopify = useAppBridge();
  const submit = useSubmit();
  const navigation = useNavigation();
  const result = useActionData<typeof action>();
  const [title, setTitle] = useState("");
  const [days, setDays] = useState("1");
  const [pack, setPack] = useState<{ id: string; label: string } | null>(null);

  async function pickPack() {
    const selection = await shopify.resourcePicker({ type: "variant", multiple: false });
    const variant = selection?.[0] as { id: string; displayName?: string; title?: string } | undefined;
    if (variant) setPack({ id: variant.id, label: variant.displayName ?? variant.title ?? variant.id });
  }

  return (
    <s-page heading="New mystery pack series" inlineSize="small">
      <s-section>
        <s-stack gap="base">
          {result?.error ? <s-banner tone="critical">{result.error}</s-banner> : null}
          <s-text-field
            label="Series name"
            placeholder="Series 1"
            value={title}
            onInput={(e) => setTitle((e.currentTarget).value)}
          />
          <s-stack gap="small-200">
            <s-text>Pack product</s-text>
            <s-paragraph>
              The product customers buy, e.g. &quot;Mystery Pack: Series 1&quot; at $10. Its inventory is set to the
              number of packs when you launch.
            </s-paragraph>
            <s-button onClick={pickPack}>{pack ? pack.label : "Choose pack product"}</s-button>
          </s-stack>
          <s-number-field
            label="Auto-open unopened packs after (days)"
            min={1}
            max={60}
            value={days}
            onInput={(e) => setDays((e.currentTarget).value)}
          />
          <s-button
            variant="primary"
            {...(navigation.state === "submitting" ? { loading: true } : {})}
            onClick={() =>
              submit({ title, packVariantId: pack?.id ?? "", autoOpenDays: days }, { method: "post" })
            }
          >
            Create series
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
