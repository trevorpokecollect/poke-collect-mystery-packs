import { useMemo, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  emptyTarget,
  newKey,
  rulesFromForm,
  selectionIds,
  targetFromSelection,
  type ResourceLabels,
  type RulesForm,
  type TargetForm,
} from "../lib/campaign-form";
import { scoreOrder, type OrderLine } from "../lib/entries/rules";
import { parseLocalDateTime, toLocalInput } from "../lib/time";
import {
  Check,
  DateTimeInput,
  NumberInput,
  RowCard,
  Select,
  TextInput,
  list,
} from "./fields";

const MAX_PRODUCT_RULES = 15;
const MAX_BUNDLES = 10;
const ZONE = "Eastern time";

interface Props {
  rules: RulesForm;
  onChange: (rules: RulesForm) => void;
  resources: ResourceLabels;
  onResources: (labels: ResourceLabels) => void;
  timezone: string;
}

export function PurchaseRulesEditor(props: Props) {
  const { rules, onChange } = props;
  const set = (patch: Partial<RulesForm>) => onChange({ ...rules, ...patch });
  const base = rules.base;
  const picker = (t: TargetForm, apply: (t: TargetForm) => void) => (
    <ProductPicker
      target={t}
      resources={props.resources}
      onPick={(next, labels) => {
        props.onResources(labels);
        apply(next);
      }}
    />
  );

  return (
    <>
      <s-section heading="Purchase entries">
        <s-stack gap="base">
          <Check
            label="Award entries for purchases"
            checked={rules.enabled}
            onChange={(enabled) => set({ enabled })}
          />
          {rules.enabled && (
            <>
              <Check
                label="Enter buyers automatically"
                details="Create an entrant from a paid order when the buyer hasn't signed up."
                checked={rules.autoSignupFromOrders}
                onChange={(autoSignupFromOrders) =>
                  set({ autoSignupFromOrders })
                }
              />
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <Select
                  label="Orders from"
                  value={rules.orderSource}
                  options={[
                    { value: "all", label: "All sales channels" },
                    { value: "online", label: "Online store only" },
                    { value: "pos", label: "Point of Sale only" },
                    { value: "online_pos", label: "Online store and POS" },
                  ]}
                  onChange={(orderSource) => set({ orderSource })}
                />
                <NumberInput
                  label="Minimum order subtotal"
                  prefix="$"
                  min={0}
                  step={0.01}
                  value={rules.minOrderValue}
                  details="Applies to the base entries only."
                  onChange={(minOrderValue) => set({ minOrderValue })}
                />
              </s-grid>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <DateTimeInput
                  label="Base entries from"
                  zoneLabel={ZONE}
                  value={rules.dateRange.start}
                  onChange={(start) =>
                    set({ dateRange: { ...rules.dateRange, start } })
                  }
                />
                <DateTimeInput
                  label="Base entries until"
                  zoneLabel={ZONE}
                  value={rules.dateRange.end}
                  onChange={(end) =>
                    set({ dateRange: { ...rules.dateRange, end } })
                  }
                />
              </s-grid>
              <s-text color="subdued">
                Optional. Leave blank to use the giveaway dates.
              </s-text>
              <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
                <Select
                  label="Base entries"
                  value={base.mode}
                  options={[
                    { value: "per_amount", label: "Per $ spent" },
                    { value: "fixed", label: "Fixed per order" },
                    { value: "none", label: "None" },
                  ]}
                  onChange={(mode) => set({ base: { ...base, mode } })}
                />
                {base.mode !== "none" && (
                  <NumberInput
                    label="Entries"
                    min={0}
                    value={base.entries}
                    onChange={(entries) => set({ base: { ...base, entries } })}
                  />
                )}
                {base.mode === "per_amount" && (
                  <>
                    <NumberInput
                      label="For every"
                      prefix="$"
                      min={0.01}
                      step={0.01}
                      value={base.amount}
                      onChange={(amount) => set({ base: { ...base, amount } })}
                    />
                    <Select
                      label="Of the order"
                      value={base.basis}
                      options={[
                        { value: "subtotal", label: "Subtotal" },
                        { value: "total", label: "Total" },
                      ]}
                      onChange={(basis) => set({ base: { ...base, basis } })}
                    />
                  </>
                )}
              </s-grid>
              <s-text color="subdued">
                Gift cards never count toward spend. Score = (base + bundles +
                product rules) × bonus period × boosters.
              </s-text>
            </>
          )}
        </s-stack>
      </s-section>

      {rules.enabled && (
        <>
          <s-section heading="Product rules">
            <s-stack gap="base">
              <s-text color="subdued">
                Extra entries for specific products or variants (up to{" "}
                {MAX_PRODUCT_RULES}).
              </s-text>
              {rules.productRules.map((r, i) => {
                const upd = (patch: Partial<typeof r>) =>
                  set({ productRules: list.set(rules.productRules, i, patch) });
                return (
                  <RowCard
                    key={r.key}
                    heading={r.name || `Product rule ${i + 1}`}
                    actions={
                      <RowButtons
                        index={i}
                        count={rules.productRules.length}
                        onMove={(by) =>
                          set({
                            productRules: list.move(rules.productRules, i, by),
                          })
                        }
                        onRemove={() =>
                          set({
                            productRules: list.remove(rules.productRules, i),
                          })
                        }
                      />
                    }
                  >
                    <TextInput
                      label="Name"
                      value={r.name}
                      onChange={(name) => upd({ name })}
                    />
                    {picker(r, (t) => upd(t))}
                    <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
                      <Select
                        label="Award"
                        value={r.mode}
                        options={[
                          { value: "per_unit", label: "Per unit bought" },
                          { value: "per_amount", label: "Per $ spent on it" },
                        ]}
                        onChange={(mode) => upd({ mode })}
                      />
                      <NumberInput
                        label="Entries"
                        min={0}
                        value={r.entries}
                        onChange={(entries) => upd({ entries })}
                      />
                      {r.mode === "per_amount" && (
                        <NumberInput
                          label="For every"
                          prefix="$"
                          min={0.01}
                          step={0.01}
                          value={r.amount}
                          onChange={(amount) => upd({ amount })}
                        />
                      )}
                    </s-grid>
                    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                      <NumberInput
                        label="Bonus when spend reaches"
                        prefix="$"
                        min={0}
                        value={r.bonusThreshold}
                        details="0 = no bonus"
                        onChange={(bonusThreshold) => upd({ bonusThreshold })}
                      />
                      <NumberInput
                        label="Bonus entries"
                        min={0}
                        value={r.bonusEntries}
                        onChange={(bonusEntries) => upd({ bonusEntries })}
                      />
                    </s-grid>
                    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                      <DateTimeInput
                        label="Only from"
                        zoneLabel={ZONE}
                        value={r.dateRange.start}
                        onChange={(start) =>
                          upd({ dateRange: { ...r.dateRange, start } })
                        }
                      />
                      <DateTimeInput
                        label="Only until"
                        zoneLabel={ZONE}
                        value={r.dateRange.end}
                        onChange={(end) =>
                          upd({ dateRange: { ...r.dateRange, end } })
                        }
                      />
                    </s-grid>
                    <Check
                      label="Skip units already counted in a bundle"
                      checked={r.skipIfBundleMatched}
                      onChange={(skipIfBundleMatched) =>
                        upd({ skipIfBundleMatched })
                      }
                    />
                  </RowCard>
                );
              })}
              {rules.productRules.length < MAX_PRODUCT_RULES && (
                <AddButton
                  label="Add product rule"
                  onClick={() =>
                    set({
                      productRules: [
                        ...rules.productRules,
                        {
                          key: newKey(),
                          ...emptyTarget(),
                          name: "",
                          mode: "per_unit",
                          entries: 10,
                          amount: 1,
                          dateRange: { start: "", end: "" },
                          bonusThreshold: 0,
                          bonusEntries: 0,
                          skipIfBundleMatched: true,
                        },
                      ],
                    })
                  }
                />
              )}
            </s-stack>
          </s-section>

          <s-section heading="Bundles">
            <s-stack gap="base">
              <s-text color="subdued">
                Entries each time an order contains every group in the bundle
                (up to {MAX_BUNDLES}). Higher-reward bundles are matched first.
              </s-text>
              {rules.bundles.map((b, i) => {
                const upd = (patch: Partial<typeof b>) =>
                  set({ bundles: list.set(rules.bundles, i, patch) });
                return (
                  <RowCard
                    key={b.key}
                    heading={b.name || `Bundle ${i + 1}`}
                    actions={
                      <RowButtons
                        index={i}
                        count={rules.bundles.length}
                        onMove={(by) =>
                          set({ bundles: list.move(rules.bundles, i, by) })
                        }
                        onRemove={() =>
                          set({ bundles: list.remove(rules.bundles, i) })
                        }
                      />
                    }
                  >
                    <s-grid gridTemplateColumns="2fr 1fr" gap="base">
                      <TextInput
                        label="Name"
                        value={b.name}
                        onChange={(name) => upd({ name })}
                      />
                      <NumberInput
                        label="Entries per bundle"
                        min={0}
                        value={b.entries}
                        onChange={(entries) => upd({ entries })}
                      />
                    </s-grid>
                    {b.groups.map((g, gi) => (
                      <s-box
                        key={g.key}
                        padding="small"
                        background="subdued"
                        borderRadius="base"
                      >
                        <s-stack gap="small-200">
                          <s-stack
                            direction="inline"
                            gap="base"
                            alignItems="end"
                          >
                            <NumberInput
                              label={`Group ${gi + 1} quantity`}
                              min={1}
                              value={g.quantity}
                              onChange={(quantity) =>
                                upd({
                                  groups: list.set(b.groups, gi, { quantity }),
                                })
                              }
                            />
                            {b.groups.length > 1 && (
                              <s-button
                                variant="tertiary"
                                tone="critical"
                                onClick={() =>
                                  upd({ groups: list.remove(b.groups, gi) })
                                }
                              >
                                Remove group
                              </s-button>
                            )}
                          </s-stack>
                          {picker(g, (t) =>
                            upd({ groups: list.set(b.groups, gi, t) }),
                          )}
                        </s-stack>
                      </s-box>
                    ))}
                    <AddButton
                      label="Add group"
                      onClick={() =>
                        upd({
                          groups: [
                            ...b.groups,
                            { key: newKey(), ...emptyTarget(), quantity: 1 },
                          ],
                        })
                      }
                    />
                    <Check
                      label="Don't count bundle items toward per-$ base entries"
                      checked={b.excludeFromOrderTotal}
                      onChange={(excludeFromOrderTotal) =>
                        upd({ excludeFromOrderTotal })
                      }
                    />
                  </RowCard>
                );
              })}
              {rules.bundles.length < MAX_BUNDLES && (
                <AddButton
                  label="Add bundle"
                  onClick={() =>
                    set({
                      bundles: [
                        ...rules.bundles,
                        {
                          key: newKey(),
                          name: "",
                          entries: 25,
                          excludeFromOrderTotal: false,
                          groups: [
                            { key: newKey(), ...emptyTarget(), quantity: 1 },
                          ],
                        },
                      ],
                    })
                  }
                />
              )}
            </s-stack>
          </s-section>

          <s-section heading="Boosters and bonus periods">
            <s-stack gap="base">
              <s-text color="subdued">
                Boosters multiply the whole order when it contains a product.
                They add together per unit (two 2× units = 4×) rather than
                compounding.
              </s-text>
              {rules.aovBoosters.map((b, i) => {
                const upd = (patch: Partial<typeof b>) =>
                  set({ aovBoosters: list.set(rules.aovBoosters, i, patch) });
                return (
                  <RowCard
                    key={b.key}
                    heading={b.name || `Booster ${i + 1}`}
                    actions={
                      <RowButtons
                        index={i}
                        count={rules.aovBoosters.length}
                        onMove={(by) =>
                          set({
                            aovBoosters: list.move(rules.aovBoosters, i, by),
                          })
                        }
                        onRemove={() =>
                          set({
                            aovBoosters: list.remove(rules.aovBoosters, i),
                          })
                        }
                      />
                    }
                  >
                    <s-grid gridTemplateColumns="2fr 1fr" gap="base">
                      <TextInput
                        label="Name"
                        value={b.name}
                        onChange={(name) => upd({ name })}
                      />
                      <NumberInput
                        label="Multiplier"
                        suffix="×"
                        min={0.1}
                        step={0.1}
                        value={b.multiplier}
                        onChange={(multiplier) => upd({ multiplier })}
                      />
                    </s-grid>
                    {picker(b, (t) => upd(t))}
                    <Check
                      label="Don't count the booster item toward per-$ base entries"
                      checked={b.excludeFromOrderTotal}
                      onChange={(excludeFromOrderTotal) =>
                        upd({ excludeFromOrderTotal })
                      }
                    />
                  </RowCard>
                );
              })}
              <AddButton
                label="Add booster"
                onClick={() =>
                  set({
                    aovBoosters: [
                      ...rules.aovBoosters,
                      {
                        key: newKey(),
                        ...emptyTarget(),
                        name: "",
                        multiplier: 2,
                        excludeFromOrderTotal: true,
                      },
                    ],
                  })
                }
              />

              <s-divider />
              <s-text color="subdued">
                Bonus periods multiply orders placed in a window, like a weekend
                2× event. Overlapping periods don&apos;t stack; the highest
                applies.
              </s-text>
              {rules.periodMultipliers.map((p, i) => {
                const upd = (patch: Partial<typeof p>) =>
                  set({
                    periodMultipliers: list.set(
                      rules.periodMultipliers,
                      i,
                      patch,
                    ),
                  });
                return (
                  <RowCard
                    key={p.key}
                    heading={`Bonus period ${i + 1}`}
                    actions={
                      <RowButtons
                        index={i}
                        count={rules.periodMultipliers.length}
                        onRemove={() =>
                          set({
                            periodMultipliers: list.remove(
                              rules.periodMultipliers,
                              i,
                            ),
                          })
                        }
                      />
                    }
                  >
                    <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
                      <DateTimeInput
                        label="From"
                        zoneLabel={ZONE}
                        value={p.start}
                        onChange={(start) => upd({ start })}
                      />
                      <DateTimeInput
                        label="Until"
                        zoneLabel={ZONE}
                        value={p.end}
                        onChange={(end) => upd({ end })}
                      />
                      <NumberInput
                        label="Multiplier"
                        suffix="×"
                        min={0.1}
                        step={0.1}
                        value={p.multiplier}
                        onChange={(multiplier) => upd({ multiplier })}
                      />
                    </s-grid>
                  </RowCard>
                );
              })}
              <AddButton
                label="Add bonus period"
                onClick={() =>
                  set({
                    periodMultipliers: [
                      ...rules.periodMultipliers,
                      { key: newKey(), start: "", end: "", multiplier: 2 },
                    ],
                  })
                }
              />
            </s-stack>
          </s-section>

          <OrderPreview {...props} />
        </>
      )}
    </>
  );
}

function AddButton(props: { label: string; onClick: () => void }) {
  return (
    <s-stack direction="inline">
      <s-button icon="plus" onClick={props.onClick}>
        {props.label}
      </s-button>
    </s-stack>
  );
}

function RowButtons(props: {
  index: number;
  count: number;
  onMove?: (by: number) => void;
  onRemove: () => void;
}) {
  return (
    <>
      {props.onMove && (
        <>
          <s-button
            icon="arrow-up"
            variant="tertiary"
            accessibilityLabel="Move up"
            disabled={props.index === 0 || undefined}
            onClick={() => props.onMove!(-1)}
          />
          <s-button
            icon="arrow-down"
            variant="tertiary"
            accessibilityLabel="Move down"
            disabled={props.index === props.count - 1 || undefined}
            onClick={() => props.onMove!(1)}
          />
        </>
      )}
      <s-button
        icon="delete"
        variant="tertiary"
        tone="critical"
        accessibilityLabel="Remove"
        onClick={props.onRemove}
      />
    </>
  );
}

/** App Bridge resource picker; stores product GIDs, or variant GIDs for a partial pick. */
function ProductPicker(props: {
  target: TargetForm;
  resources: ResourceLabels;
  onPick: (target: TargetForm, labels: ResourceLabels) => void;
}) {
  const shopify = useAppBridge();
  const ids = [...props.target.productIds, ...props.target.variantIds];

  const pick = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: true,
      selectionIds: selectionIds(props.target, props.resources),
    });
    if (!selected) return;
    const { target, labels } = targetFromSelection(
      selected.map((p) => ({
        id: p.id,
        title: p.title,
        totalVariants: p.totalVariants,
        hasOnlyDefaultVariant: p.hasOnlyDefaultVariant,
        variants: (p.variants ?? []).map((v) => ({ id: v.id, title: v.title })),
      })),
    );
    props.onPick(target, labels);
  };

  return (
    <s-stack gap="small-200">
      {ids.length === 0 ? (
        <s-text color="subdued">No products picked yet.</s-text>
      ) : (
        <s-stack direction="inline" gap="small-200">
          {ids.map((id) => (
            <s-badge
              key={id}
              tone={id.includes("Variant") ? "info" : "neutral"}
            >
              {props.resources[id]?.title ?? id.split("/").pop()}
            </s-badge>
          ))}
        </s-stack>
      )}
      <s-stack direction="inline">
        <s-button icon="product" onClick={pick}>
          {ids.length ? "Change products" : "Pick products"}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

interface PreviewLine {
  key: string;
  gid: string; // "" = a product no rule targets
  quantity: number;
  unitPrice: number;
}

const usedIds = (r: RulesForm) => [
  ...new Set(
    [
      ...r.productRules,
      ...r.aovBoosters,
      ...r.bundles.flatMap((b) => b.groups),
    ].flatMap((t) => [...t.productIds, ...t.variantIds]),
  ),
];

/** Runs the real scoring engine in the browser against a made-up order. */
function OrderPreview(props: Props) {
  const { rules, resources, timezone } = props;
  const [lines, setLines] = useState<PreviewLine[]>([
    { key: newKey(), gid: "", quantity: 1, unitPrice: 50 },
  ]);
  const [extra, setExtra] = useState(0);
  const [giftCard, setGiftCard] = useState(0);
  const [source, setSource] = useState("web");
  const [placedAt, setPlacedAt] = useState(() =>
    toLocalInput(new Date(), timezone),
  );

  const options = [
    { value: "", label: "Another product" },
    ...usedIds(rules).map((id) => ({
      value: id,
      label: resources[id]?.title ?? id.split("/").pop() ?? id,
    })),
  ];
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  const result = useMemo(() => {
    const parsed = rulesFromForm(rules, timezone);
    if (!parsed.ok) return { error: parsed.error } as const;
    const orderLines: OrderLine[] = lines.map((l) => {
      const isVariant = l.gid.includes("/ProductVariant/");
      return {
        productId: isVariant
          ? (resources[l.gid]?.productId ?? "")
          : l.gid || "preview-other",
        variantId: isVariant ? l.gid : "",
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      };
    });
    return {
      score: scoreOrder(parsed.value, {
        createdAt: parseLocalDateTime(placedAt, timezone) || new Date(),
        sourceName: source,
        subtotal,
        total: subtotal + extra,
        giftCardAmount: giftCard,
        lines: orderLines,
      }),
    } as const;
  }, [
    rules,
    resources,
    timezone,
    lines,
    extra,
    giftCard,
    source,
    placedAt,
    subtotal,
  ]);

  return (
    <s-section heading="Example order">
      <s-stack gap="base">
        <s-text color="subdued">
          Try an order against the rules above. Nothing is saved.
        </s-text>
        {lines.map((l, i) => (
          <s-grid
            key={l.key}
            gridTemplateColumns="2fr 1fr 1fr auto"
            gap="base"
            alignItems="end"
          >
            <Select
              label="Product"
              value={options.some((o) => o.value === l.gid) ? l.gid : ""}
              options={options}
              onChange={(gid) => setLines(list.set(lines, i, { gid }))}
            />
            <NumberInput
              label="Quantity"
              min={1}
              value={l.quantity}
              onChange={(quantity) =>
                setLines(list.set(lines, i, { quantity }))
              }
            />
            <NumberInput
              label="Unit price"
              prefix="$"
              min={0}
              step={0.01}
              value={l.unitPrice}
              onChange={(unitPrice) =>
                setLines(list.set(lines, i, { unitPrice }))
              }
            />
            <s-button
              icon="delete"
              variant="tertiary"
              accessibilityLabel="Remove line"
              disabled={lines.length === 1 || undefined}
              onClick={() => setLines(list.remove(lines, i))}
            />
          </s-grid>
        ))}
        <AddButton
          label="Add line"
          onClick={() =>
            setLines([
              ...lines,
              { key: newKey(), gid: "", quantity: 1, unitPrice: 10 },
            ])
          }
        />
        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
          <NumberInput
            label="Shipping and tax"
            prefix="$"
            min={0}
            step={0.01}
            value={extra}
            onChange={setExtra}
          />
          <NumberInput
            label="Paid by gift card"
            prefix="$"
            min={0}
            step={0.01}
            value={giftCard}
            onChange={setGiftCard}
          />
          <Select
            label="Channel"
            value={source}
            options={[
              { value: "web", label: "Online store" },
              { value: "pos", label: "Point of Sale" },
              { value: "shopify_draft_order", label: "Draft order" },
            ]}
            onChange={setSource}
          />
          <DateTimeInput
            label="Placed"
            zoneLabel={ZONE}
            value={placedAt}
            onChange={setPlacedAt}
          />
        </s-grid>

        {"error" in result ? (
          <s-banner tone="warning">{result.error}</s-banner>
        ) : (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-heading>
                {result.score.entries.toLocaleString()}{" "}
                {result.score.entries === 1 ? "entry" : "entries"}
              </s-heading>
              {!result.score.valid ? (
                <s-text color="subdued">
                  No entries: {result.score.reason}.
                </s-text>
              ) : (
                <s-unordered-list>
                  <s-list-item>
                    Subtotal ${subtotal.toFixed(2)}, base {result.score.base}
                  </s-list-item>
                  {result.score.bundles.map((b) => (
                    <s-list-item key={b.name}>
                      {b.name}: {b.times}× = {b.entries}
                    </s-list-item>
                  ))}
                  {result.score.products.map((p) => (
                    <s-list-item key={p.name}>
                      {p.name}: {p.entries}
                    </s-list-item>
                  ))}
                  {result.score.periodMultiplier !== 1 && (
                    <s-list-item>
                      Bonus period ×{result.score.periodMultiplier}
                    </s-list-item>
                  )}
                  {result.score.aovMultiplier !== 1 && (
                    <s-list-item>
                      Boosters ×{result.score.aovMultiplier}
                    </s-list-item>
                  )}
                </s-unordered-list>
              )}
            </s-stack>
          </s-box>
        )}
      </s-stack>
    </s-section>
  );
}
