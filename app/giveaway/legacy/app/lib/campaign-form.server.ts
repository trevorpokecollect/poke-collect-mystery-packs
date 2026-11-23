import type { Campaign, EntryAction, Prisma } from "@prisma/client";
import db from "../db.server";
import { DEFAULT_RISK_POLICY } from "./bot/risk";
import {
  DEFAULT_TIMEZONE,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  newKey,
  rulesToForm,
  validateCampaignForm,
  type ActionConfigForm,
  type ActionData,
  type CampaignData,
  type CampaignFormValues,
  type ResourceLabels,
} from "./campaign-form";
import { purchaseRulesSchema } from "./entries/rules";
import { isArchivedAction, parseSettings } from "./settings";
import { toLocalInput } from "./time";

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

type ActionWithCounts = EntryAction & {
  _count: { events: number; responses: number };
};

export const actionHistoryInclude = {
  actions: {
    orderBy: { sortOrder: "asc" as const },
    include: { _count: { select: { events: true, responses: true } } },
  },
};

/** Reads the editor's JSON payload and optional image from a form post. */
export async function readCampaignForm(form: FormData) {
  let values: CampaignFormValues;
  try {
    values = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return { error: "The form didn't send correctly. Reload and try again." };
  }
  const result = validateCampaignForm(values);
  if (!result.ok) return { error: result.error };

  const file = form.get("image");
  let image: File | null = null;
  if (file instanceof File && file.size > 0) {
    if (!IMAGE_TYPES.includes(file.type)) {
      return { error: "The prize image must be a PNG, JPG, WebP or GIF." };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { error: "The prize image must be 5 MB or smaller." };
    }
    image = file;
  }
  return { data: result.value, image };
}

/** Prize image: stored in the app database and served from /images/<id>. */
async function saveImage(shop: string, file: File) {
  const image = await db.campaignImage.create({
    data: {
      shop,
      contentType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    },
  });
  return `${process.env.SHOPIFY_APP_URL}/cardbit-campaign-images/${image.id}`;
}

export async function slugTaken(shop: string, slug: string, exceptId?: string) {
  const found = await db.campaign.findUnique({
    where: { shop_slug: { shop, slug } },
    select: { id: true },
  });
  return !!found && found.id !== exceptId;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

const actionFields = (a: ActionData, sortOrder: number) => ({
  label: a.label,
  entries: a.entries,
  mandatory: a.mandatory,
  repeatable: a.repeatable,
  config: a.config ? json(a.config) : undefined,
  sortOrder,
});

export async function createCampaign(
  shop: string,
  data: CampaignData,
  image: File | null,
) {
  return db.campaign.create({
    data: {
      shop,
      slug: data.slug,
      title: data.title,
      prize: data.prize,
      description: data.description,
      imageUrl: image ? await saveImage(shop, image) : null,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      timezone: data.timezone,
      rulesText: data.rulesText,
      purchaseRules: json(data.purchaseRules),
      settings: json(data.settings),
      riskPolicy: DEFAULT_RISK_POLICY as object,
      actions: {
        create: data.actions.map((a, i) => ({
          type: a.type,
          ...actionFields(a, i),
        })),
      },
    },
  });
}

/**
 * Saves the editor over an existing campaign. Actions are matched by id;
 * a removed action is deleted unless it has ledger history, in which case it
 * is archived (entries 0, config.archived) so EntryEvents keep pointing at it.
 */
export async function updateCampaign(
  campaign: Campaign,
  data: CampaignData,
  image: File | null,
) {
  const imageUrl = image
    ? await saveImage(campaign.shop, image)
    : data.removeImage
      ? null
      : campaign.imageUrl;

  return db.$transaction(async (tx) => {
    const existing = await tx.entryAction.findMany({
      where: { campaignId: campaign.id },
      include: { _count: { select: { events: true, responses: true } } },
    });
    const live = existing.filter((a) => !isArchivedAction(a.config));
    const byId = new Map(live.map((a) => [a.id, a]));
    const kept = new Set<string>();

    for (const [i, a] of data.actions.entries()) {
      // The sign-up action is never recreated, so its history stays attached.
      const id =
        a.id && byId.has(a.id)
          ? a.id
          : a.type === "SIGNUP"
            ? live.find((x) => x.type === "SIGNUP")?.id
            : undefined;
      if (id && !kept.has(id)) {
        kept.add(id);
        const prev = byId.get(id)!;
        await tx.entryAction.update({
          where: { id },
          data: {
            ...actionFields(a, i),
            // Type is fixed once saved; ledger events depend on it.
            config:
              prev.type === a.type && a.config ? json(a.config) : undefined,
          },
        });
      } else {
        await tx.entryAction.create({
          data: {
            campaignId: campaign.id,
            type: a.type,
            ...actionFields(a, i),
          },
        });
      }
    }

    let order = data.actions.length;
    for (const a of live) {
      if (kept.has(a.id)) continue;
      if (a._count.events > 0 || a._count.responses > 0) {
        await tx.entryAction.update({
          where: { id: a.id },
          data: {
            entries: 0,
            mandatory: false,
            sortOrder: order++,
            config: json({
              ...((a.config as object | null) ?? {}),
              archived: true,
            }),
          },
        });
      } else {
        await tx.entryAction.delete({ where: { id: a.id } });
      }
    }

    return tx.campaign.update({
      where: { id: campaign.id },
      data: {
        slug: data.slug,
        title: data.title,
        prize: data.prize,
        description: data.description,
        imageUrl,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        timezone: data.timezone,
        rulesText: data.rulesText,
        purchaseRules: json(data.purchaseRules),
        settings: json(data.settings),
      },
    });
  });
}

async function freeSlug(shop: string, base: string) {
  const stem = `${base.slice(0, 40)}-copy`;
  for (let n = 1; ; n++) {
    const slug = n === 1 ? stem : `${stem}-${n}`;
    if (!(await slugTaken(shop, slug))) return slug;
  }
}

/** Copies a campaign's setup (not entrants, orders or draws) as a new DRAFT. */
export async function duplicateCampaign(shop: string, id: string) {
  const src = await db.campaign.findFirst({
    where: { id, shop },
    include: { actions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!src) return null;
  const actions = src.actions.filter((a) => !isArchivedAction(a.config));
  return db.campaign.create({
    data: {
      shop,
      slug: await freeSlug(shop, src.slug),
      title: `${src.title} (copy)`,
      description: src.description,
      prize: src.prize,
      imageUrl: src.imageUrl,
      status: "DRAFT",
      startsAt: src.startsAt,
      endsAt: src.endsAt,
      timezone: src.timezone,
      purchaseRules: src.purchaseRules ?? undefined,
      riskPolicy: src.riskPolicy ?? undefined,
      theme: src.theme ?? undefined,
      settings: src.settings ?? undefined,
      rulesText: src.rulesText,
      actions: {
        create: actions.map((a, i) => ({
          type: a.type,
          label: a.label,
          entries: a.entries,
          config: a.config ?? undefined,
          mandatory: a.mandatory,
          repeatable: a.repeatable,
          sortOrder: i,
        })),
      },
    },
  });
}

/** Editor state for a saved campaign. Archived actions are left out. */
export function campaignToForm(
  campaign: Campaign & { actions: ActionWithCounts[] },
  resources: ResourceLabels = {},
): CampaignFormValues {
  const tz = campaign.timezone || DEFAULT_TIMEZONE;
  const rules = purchaseRulesSchema.safeParse(campaign.purchaseRules);
  return {
    title: campaign.title,
    prize: campaign.prize ?? "",
    description: campaign.description ?? "",
    slug: campaign.slug,
    startsAt: toLocalInput(campaign.startsAt, tz),
    endsAt: toLocalInput(campaign.endsAt, tz),
    timezone: tz,
    imageUrl: campaign.imageUrl,
    removeImage: false,
    rulesText: campaign.rulesText ?? "",
    actions: campaign.actions
      .filter((a) => !isArchivedAction(a.config))
      .map((a) => ({
        key: newKey(),
        id: a.id,
        type: a.type,
        label: a.label,
        entries: a.entries,
        mandatory: a.mandatory,
        repeatable: a.repeatable,
        config: (a.config as ActionConfigForm | null) ?? {},
        hasEvents: a._count.events > 0 || a._count.responses > 0,
      })),
    rules: rulesToForm(
      campaign.purchaseRules && rules.success ? rules.data : null,
      tz,
    ),
    settings: parseSettings(campaign.settings),
    resources,
  };
}

/** Every product/variant GID referenced by stored rules. */
export function ruleResourceIds(raw: unknown) {
  const parsed = purchaseRulesSchema.safeParse(raw);
  if (!parsed.success) return [];
  const r = parsed.data;
  const targets = [
    ...r.productRules,
    ...r.aovBoosters,
    ...r.bundles.flatMap((b) => b.groups),
  ];
  return [
    ...new Set(targets.flatMap((t) => [...t.productIds, ...t.variantIds])),
  ];
}

const NODES_QUERY = `#graphql
  query RuleResources($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id title }
      ... on ProductVariant { id title product { id title } }
    }
  }`;

/** Titles for the GIDs in the rules, so the editor can show product names. */
export async function loadResourceLabels(
  graphql: AdminGraphql,
  ids: string[],
): Promise<ResourceLabels> {
  const labels: ResourceLabels = {};
  for (let i = 0; i < ids.length; i += 250) {
    try {
      const res = await graphql(NODES_QUERY, {
        variables: { ids: ids.slice(i, i + 250) },
      });
      const body = (await res.json()) as {
        data?: {
          nodes: ({
            id?: string;
            title?: string;
            product?: { id: string; title: string };
          } | null)[];
        };
      };
      for (const n of body.data?.nodes ?? []) {
        if (!n?.id) continue;
        labels[n.id] = n.product
          ? {
              title: `${n.product.title} – ${n.title}`,
              productId: n.product.id,
            }
          : { title: n.title ?? n.id };
      }
    } catch {
      // Labels are cosmetic; the editor falls back to showing the ID.
    }
  }
  return labels;
}
