import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Form } from "react-router";
import {
  IMAGE_TYPES,
  generateOfficialRules,
  type CampaignFormValues,
  type ResourceLabels,
} from "../lib/campaign-form";
import { applyRecommended, applyRecommendedDaily } from "../lib/recommended";
import { ActionsEditor } from "./ActionsEditor";
import { PurchaseRulesEditor } from "./PurchaseRulesEditor";
import { SettingsEditor } from "./SettingsEditor";
import { Check, DateTimeInput, Select, TextArea, TextInput } from "./fields";
import { GiveawayPreview } from "./GiveawayPreview";
import { ShopPromoEditor } from "./ShopPromoEditor";
import type { PreviewPrize } from "../lib/preview";

// Two columns on wide screens, with the preview kept in view while scrolling the form.
const LAYOUT_CSS = `
.pcg-editor{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.pcg-editor__preview{order:-1}
@media (min-width:1100px){
  .pcg-editor{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .pcg-editor__preview{order:0;position:sticky;top:16px;align-self:start;max-height:calc(100vh - 32px);overflow:auto}
}`;

// Shared editor for New and Edit. All state is sent as one JSON "payload"
// field (plus the image file) and validated by app/lib/campaign-form.server.ts.
export function CampaignForm(props: {
  initial: CampaignFormValues;
  submitLabel: string;
  saving: boolean;
  error?: string;
  archivedCount?: number;
  isEdit?: boolean;
  // New daily giveaways: pick today's prize before creating it.
  dailyChooser?: boolean;
  // Today's prize, shown in the preview of an existing daily giveaway.
  dailyPrize?: PreviewPrize | null;
}) {
  const shopify = useAppBridge();
  const [v, setV] = useState(props.initial);
  const [preview, setPreview] = useState<string | null>(null);
  // The chosen image as a data URL, which the sandboxed preview frame can load.
  const [imageData, setImageData] = useState<string | null>(null);
  const [chosen, setChosen] = useState<
    (PreviewPrize & { id: string }) | null
  >(null);
  // Bumped to remount the rules text area when it is filled programmatically.
  const [rulesKey, setRulesKey] = useState(0);
  const set = (patch: Partial<CampaignFormValues>) =>
    setV((prev) => ({ ...prev, ...patch }));
  const zone = v.timezone === "America/New_York" ? "Eastern time" : v.timezone;

  const generate = () => {
    if (
      v.rulesText.trim() &&
      !window.confirm("Replace the current official rules with a new draft?")
    ) {
      return;
    }
    set({ rulesText: generateOfficialRules(v) });
    setRulesKey((k) => k + 1);
  };

  // Remounts the editors so they pick up the new values.
  const [formKey, setFormKey] = useState(0);
  const recommend = () => {
    setV((prev) =>
      prev.settings.daily.enabled
        ? applyRecommendedDaily(prev)
        : applyRecommended(prev),
    );
    setFormKey((k) => k + 1);
  };

  const recommendText = v.settings.daily.enabled
    ? "Fill in Cardbit's recommended daily giveaway setup: the 9pm draw and prize rules, text, Discord and Whatnot sign-ups, purchase entries and winner settings. Your title, dates and image stay as they are."
    : "Fill in Cardbit's recommended entries, purchase rules and winner settings. Your title, dates and image stay as they are.";

  return (
    <Form method="post" encType="multipart/form-data" key={formKey}>
      <input type="hidden" name="payload" value={JSON.stringify(v)} />
      <input type="hidden" name="dailyProductId" value={chosen?.id ?? ""} />
      <style>{LAYOUT_CSS}</style>
      <div className="pcg-editor">
      <s-stack gap="base">
        {props.error && <s-banner tone="critical">{props.error}</s-banner>}
        <s-banner tone="info">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text>{recommendText}</s-text>
            <s-button onClick={recommend}>Use recommended settings</s-button>
          </s-stack>
        </s-banner>

        <s-section heading="Basics">
          <s-stack gap="base">
            <TextInput
              label="Title"
              placeholder="Win a Prismatic Evolutions Booster Box"
              required
              value={v.title}
              onChange={(title) => set({ title })}
            />
            <TextInput
              label="Prize"
              placeholder="1x sealed booster box"
              value={v.prize}
              onChange={(prize) => set({ prize })}
            />
            <TextArea
              label="Description"
              value={v.description}
              onChange={(description) => set({ description })}
            />
            <s-stack gap="small-200">
              <s-text>Prize image</s-text>
              {preview || (v.imageUrl && !v.removeImage) ? (
                <img
                  src={preview ?? v.imageUrl!}
                  alt="Prize"
                  style={{ maxWidth: 240, borderRadius: 8 }}
                />
              ) : null}
              <input
                type="file"
                name="image"
                accept={IMAGE_TYPES.join(",")}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  setPreview(f ? URL.createObjectURL(f) : null);
                  setImageData(null);
                  if (f) {
                    const reader = new FileReader();
                    reader.onload = () => setImageData(String(reader.result));
                    reader.readAsDataURL(f);
                  }
                }}
              />
              {v.imageUrl && !preview && (
                <Check
                  label="Remove the current image"
                  checked={v.removeImage}
                  onChange={(removeImage) => set({ removeImage })}
                />
              )}
              <Select
                label="Image Background"
                value={v.settings.imageBackdrop}
                options={[
                  { value: "light", label: "Light" },
                  { value: "rain", label: "Red Matrix Rain (like the daily)" },
                ]}
                details="What shows around the prize image. Red Matrix Rain puts it on the daily prize's dark stage with the glow; images with a transparent background look best."
                onChange={(imageBackdrop) =>
                  set({ settings: { ...v.settings, imageBackdrop } })
                }
              />
              <s-text color="subdued">
                PNG, JPG, WebP or GIF, up to 5 MB.
                {v.imageUrl
                  ? " Choosing a file replaces the current image."
                  : ""}
              </s-text>
            </s-stack>
            <TextInput
              label="Link name"
              value={v.slug}
              details={
                props.isEdit
                  ? "Used in the giveaway URL. Changing it breaks links and theme blocks that use the old name."
                  : "Used in the giveaway URL. Leave blank to use the title."
              }
              onChange={(slug) => set({ slug })}
            />
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <DateTimeInput
                label="Starts"
                zoneLabel={zone}
                value={v.startsAt}
                onChange={(startsAt) => set({ startsAt })}
              />
              <DateTimeInput
                label="Ends"
                zoneLabel={zone}
                value={v.endsAt}
                onChange={(endsAt) => set({ endsAt })}
              />
            </s-grid>
            <s-text color="subdued">
              Leave Starts blank to open as soon as you click Go live.
            </s-text>
          </s-stack>
        </s-section>

        {props.dailyChooser && v.settings.daily.enabled && (
          <s-section heading="Today's prize">
            <s-stack gap="base">
              {chosen ? (
                <s-stack direction="inline" gap="base" alignItems="center">
                  {chosen.imageUrl && (
                    <s-thumbnail src={chosen.imageUrl} alt={chosen.title} />
                  )}
                  <s-text>{chosen.title}</s-text>
                </s-stack>
              ) : (
                <s-paragraph>
                  Pick the product for today&apos;s draw, or leave it and the
                  app picks one automatically when the giveaway goes live. From
                  tomorrow the app picks each day&apos;s prize.
                </s-paragraph>
              )}
              <s-stack direction="inline" gap="base">
                <s-button
                  onClick={async () => {
                    const selected = await shopify.resourcePicker({
                      type: "product",
                      action: "select",
                      multiple: false,
                    });
                    const p = selected?.[0];
                    if (p)
                      setChosen({
                        id: p.id,
                        title: p.title,
                        imageUrl: p.images?.[0]?.originalSrc ?? null,
                      });
                  }}
                >
                  {chosen ? "Choose a different product" : "Choose product"}
                </s-button>
                {chosen && (
                  <s-button variant="tertiary" onClick={() => setChosen(null)}>
                    Let the app pick
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          </s-section>
        )}

        <ActionsEditor
          actions={v.actions}
          archivedCount={props.archivedCount}
          onChange={(actions) => set({ actions })}
        />

        <PurchaseRulesEditor
          rules={v.rules}
          timezone={v.timezone}
          resources={v.resources}
          onChange={(rules) => set({ rules })}
          onResources={(labels: ResourceLabels) =>
            setV((prev) => ({
              ...prev,
              resources: { ...prev.resources, ...labels },
            }))
          }
        />

        <ShopPromoEditor
          shop={v.settings.shop}
          onChange={(shop) => set({ settings: { ...v.settings, shop } })}
        />

        <SettingsEditor
          settings={v.settings}
          onChange={(settings) => set({ settings })}
        />

        <s-section heading="Official rules">
          <s-stack gap="base">
            <TextInput
              label="Who can enter"
              value={v.settings.eligibility}
              details="Used in the eligibility section of the generated rules."
              onChange={(eligibility) =>
                set({ settings: { ...v.settings, eligibility } })
              }
            />
            <s-stack direction="inline">
              <s-button icon="wand" onClick={generate}>
                Generate From Giveaway Details
              </s-button>
            </s-stack>
            <TextArea
              key={rulesKey}
              label="Rules text"
              rows={14}
              value={v.rulesText}
              details="Shown on the giveaway as the official rules. Review it before going live; it isn't legal advice."
              onChange={(rulesText) => set({ rulesText })}
            />
          </s-stack>
        </s-section>

        <s-section heading="Bot protection">
          <s-paragraph>
            On by default: Cloudflare Turnstile, email verification codes,
            disposable and alias email checks, IP, subnet and device limits, and
            referral fraud checks. Suspicious entries are held for your review
            automatically.
          </s-paragraph>
        </s-section>

        {props.error && <s-banner tone="critical">{props.error}</s-banner>}
        <s-banner tone="info">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text>{recommendText}</s-text>
            <s-button onClick={recommend}>Use recommended settings</s-button>
          </s-stack>
        </s-banner>
        <s-stack direction="inline">
          <s-button
            type="submit"
            variant="primary"
            {...(props.saving ? { loading: true } : {})}
          >
            {props.submitLabel}
          </s-button>
        </s-stack>
      </s-stack>
      <div className="pcg-editor__preview">
        <GiveawayPreview
          values={v}
          imageUrl={
            imageData ?? (v.imageUrl && !v.removeImage ? v.imageUrl : null)
          }
          dailyPrize={
            chosen
              ? { title: chosen.title, imageUrl: chosen.imageUrl }
              : props.dailyPrize
          }
        />
      </div>
      </div>
    </Form>
  );
}
