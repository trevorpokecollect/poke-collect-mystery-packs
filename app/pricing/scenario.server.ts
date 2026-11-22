import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { gql } from "../lib/orders.server";
import Pricing, { type Catalog, type Draft } from "./calculator.mjs";

const namespace = "pricing_desk";
const keyFor = (version: string) =>
  "draft_" + createHash("sha256").update(version).digest("hex").slice(0, 32);
type Stored = { compareDigest: string; jsonValue: unknown; updatedAt: string };
type Installation = { id: string; metafield: Stored | null };

export async function loadScenario(admin: AdminApiContext, catalog: Catalog) {
  const { currentAppInstallation: installation } = await gql<{
    currentAppInstallation: Installation;
  }>(
    admin,
    `#graphql
    query StaffDeskScenario($ns: String!, $key: String!) {
      currentAppInstallation { id metafield(namespace: $ns, key: $key) { compareDigest jsonValue updatedAt } }
    }`,
    { ns: namespace, key: keyFor(catalog.version) },
  );
  const record = installation.metafield;
  if (record && !Pricing.validate(record.jsonValue, catalog)) {
    return {
      installation: installation.id,
      draft: Pricing.empty(catalog.version),
      digest: record.compareDigest,
      date: record.updatedAt,
      warning:
        "The saved draft references cards or sets that changed. Review the current pool before saving a replacement.",
    };
  }
  return {
    installation: installation.id,
    draft:
      (record?.jsonValue as Draft | undefined) ??
      Pricing.empty(catalog.version),
    digest: record?.compareDigest ?? null,
    date: record?.updatedAt ?? null,
    warning: "",
  };
}

export async function saveScenario(
  admin: AdminApiContext,
  catalog: Catalog,
  draft: unknown,
  digest: string | null,
) {
  if (!Pricing.validate(draft, catalog))
    return {
      ok: false as const,
      message:
        "These settings do not match this catalog. Check the card, price and percentage fields.",
    };
  const current = await loadScenario(admin, catalog);
  if (
    current.date &&
    !current.warning &&
    isDeepStrictEqual(current.draft, draft)
  )
    return { ok: true as const, digest: current.digest, date: current.date };
  const conflict = {
    ok: false as const,
    message:
      "Another staff member saved a newer draft. Export your edits, then reload the saved draft.",
  };
  if (digest !== current.digest) return conflict;
  const response = await admin.graphql(
    `#graphql
    mutation StaffDeskSave($fields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $fields) { metafields { compareDigest updatedAt } userErrors { code message } }
    }`,
    {
      variables: {
        fields: [
          {
            ownerId: current.installation,
            namespace,
            key: keyFor(catalog.version),
            type: "json",
            value: JSON.stringify(draft),
            compareDigest: digest,
          },
        ],
      },
    },
  );
  const result = (await response.json()) as {
    data?: {
      metafieldsSet?: {
        metafields: { compareDigest: string; updatedAt: string }[];
        userErrors: { code: string }[];
      };
    };
    errors?: unknown;
  };
  const out = result.data?.metafieldsSet;
  if (
    out?.userErrors.some((e) =>
      ["STALE_OBJECT", "INVALID_COMPARE_DIGEST"].includes(e.code),
    )
  )
    return conflict;
  if (
    !response.ok ||
    result.errors ||
    !out?.metafields?.[0] ||
    out.userErrors.length
  )
    return {
      ok: false as const,
      message:
        "Shopify could not save these settings. Your edits are still open.",
    };
  return {
    ok: true as const,
    digest: out.metafields[0].compareDigest,
    date: out.metafields[0].updatedAt,
  };
}
