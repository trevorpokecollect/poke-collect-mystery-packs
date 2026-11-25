// Shipping desk for Card Broker's Orders page (POST /internal/site-shipping, pairing secret).
// Card Broker authenticates its own staff and passes the acting email (audit only). Every write goes
// through the same service functions as /staff/shipping, so the double-label claim, Fix Card row claim,
// fee refunds and customer emails behave identically.

import { shelfLabel } from "../core/stock.server";
import type { SiteShipPackage, SiteShipment, SiteShipmentItem } from "@prisma/client";
import {
  buyLabel,
  cancelShipment,
  fixShipmentCard,
  markShipped,
  ratesForShipment,
  shippingQueue,
  ShippingError,
  type ShippingDeps,
} from "./service.server";
import type { Address, Rate } from "./shippo.server";
import { packingSlipHtml } from "./packing-slip";
import { CopyLockError, FeePaymentError } from "./types";
import {
  deletePackage,
  getShipSettings,
  listPackages,
  PackageError,
  planParcel,
  savePackage,
  saveShipSettings,
  type ParcelChoice,
  type ParcelPlan,
} from "./packages.server";

type Shipment = SiteShipment & { items: SiteShipmentItem[] };

export class BrokerShipError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function view(s: Shipment, email: string | null, now: Date) {
  const a = s.toAddress as unknown as Address;
  return {
    id: s.id,
    status: s.status,
    customerId: s.customerId,
    email,
    toName: s.toName,
    address: { name: a.name, street1: a.street1, street2: a.street2 ?? null, city: a.city, state: a.state, zip: a.zip },
    addressValidated: s.addressValidated,
    cardCount: s.cardCount,
    feeKind: s.feeKind,
    feeBits: s.feeBits,
    feeCents: s.feeCents,
    processBy: s.processBy.toISOString(),
    overdue: ["PAID", "LABEL_PENDING"].includes(s.status) && s.processBy < now,
    createdAt: s.createdAt.toISOString(),
    revision: s.updatedAt.toISOString(),
    carrier: s.carrier,
    service: s.service,
    postageCents: s.postageCents,
    trackingNumber: s.trackingNumber,
    trackingUrl: s.trackingUrl,
    labelUrl: s.labelUrl,
    trackingStatus: s.trackingStatus,
    trackingDetail: s.trackingDetail,
    shippedAt: iso(s.shippedAt),
    deliveredAt: iso(s.deliveredAt),
    canFix: s.status === "PAID",
    canBuyLabel: s.status === "PAID",
    canMarkShipped: s.status === "LABEL_PURCHASED",
    canCancel: s.status === "PAID" || s.status === "DRAFT",
    items: [...s.items]
      .sort((x, y) => (x.slot ?? 1e9) - (y.slot ?? 1e9) || (x.pocket ?? 1e9) - (y.pocket ?? 1e9) || x.title.localeCompare(y.title))
      .map((i) => ({ copyId: i.copyId, title: i.title, image: i.image, slot: i.slot, pocket: i.pocket, location: i.slot != null ? shelfLabel(i.slot, i.pocket) : null })),
  };
}

const rateView = (r: Rate) => ({ rateId: r.rateId, carrier: r.carrier, service: r.service, serviceToken: r.serviceToken, cents: r.amountCents, days: r.days });

const packageView = (p: SiteShipPackage) => ({
  id: p.id, name: p.name, kind: p.kind, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn,
  weightOz: p.weightOz, maxCards: p.maxCards, isDefault: p.isDefault,
});

const planView = (p: ParcelPlan) => ({
  packageId: p.packageId, packageName: p.packageName, auto: p.auto,
  dimensions: { lengthIn: p.parcel.length, widthIn: p.parcel.width, heightIn: p.parcel.height },
  weight: p.weight,
});

async function packagesPayload(deps: ShippingDeps) {
  const [packages, settings] = await Promise.all([listPackages(deps.db), getShipSettings(deps.db)]);
  return { packages: packages.map(packageView), settings };
}

function choiceFrom(b: Record<string, unknown>): ParcelChoice & { service?: string } {
  const w = b.weightOz;
  return {
    packageId: typeof b.packageId === "string" && b.packageId ? b.packageId : null,
    weightOz: w === null || w === undefined || w === "" ? null : Number(w),
    service: typeof b.service === "string" && b.service ? b.service : undefined,
  };
}

async function emailOf(deps: ShippingDeps, ids: string[]) {
  if (!ids.length) return new Map<string, string | null>();
  const rows = await deps.db.siteCustomer.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, email: true } });
  return new Map(rows.map((r) => [r.id, r.email]));
}

async function detail(deps: ShippingDeps, id: string) {
  const s = await deps.db.siteShipment.findUnique({ where: { id }, include: { items: true } });
  if (!s) throw new BrokerShipError("Shipment not found.", 404);
  const emails = await emailOf(deps, [s.customerId]);
  return view(s, emails.get(s.customerId) ?? null, deps.now?.() ?? new Date());
}

function provider(deps: ShippingDeps) {
  return { name: deps.provider?.name ?? null, ready: Boolean(deps.provider), live: deps.provider ? !deps.provider.test : false };
}

const str = (b: Record<string, unknown>, k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");

/**
 * intents: queue | detail {id, rates?, packageId?, weightOz?} | label {id, rateId?, service?, packageId?, weightOz?}
 * | swap|remove {id, copyId, revision?} | shipped {id} | cancel {id, reason?} | slip {id}
 * | packages | package-save {package} | package-delete {packageId} | settings-save {ozPerCard?, packingOz?}
 */
export async function brokerShippingAction(deps: ShippingDeps, b: Record<string, unknown>, actor: string) {
  const intent = str(b, "intent") || "queue";
  const id = str(b, "id");
  const need = () => {
    if (!id) throw new BrokerShipError("Missing shipment id.");
    return id;
  };
  try {
    switch (intent) {
      case "queue": {
        const now = deps.now?.() ?? new Date();
        const rows = await shippingQueue(deps.db, now);
        const emails = await emailOf(deps, rows.map((r) => r.customerId));
        return { provider: provider(deps), shipments: rows.map((r) => view(r, emails.get(r.customerId) ?? null, now)) };
      }
      case "detail": {
        const shipment = await detail(deps, need());
        const pk = await packagesPayload(deps);
        const base = { provider: provider(deps), shipment, ...pk };
        if (shipment.status !== "PAID") return base;
        const choice = choiceFrom(b);
        const parcelPlan = planView(await planParcel(deps.db, shipment.cardCount, choice));
        if (!b.rates) return { ...base, plan: parcelPlan };
        try {
          const r = await ratesForShipment(deps, shipment.id, choice);
          return { ...base, plan: planView(r.plan), rates: r.rates.map(rateView), suggested: r.suggested?.rateId ?? null };
        } catch (err) {
          return { ...base, plan: parcelPlan, rates: [], suggested: null, rateError: err instanceof Error ? err.message : String(err) };
        }
      }
      case "packages":
        return await packagesPayload(deps);
      case "package-save": {
        const input = (b.package && typeof b.package === "object" ? b.package : {}) as Record<string, unknown>;
        await savePackage(deps.db, {
          id: typeof input.id === "string" && input.id ? input.id : undefined,
          name: String(input.name ?? ""),
          kind: typeof input.kind === "string" ? input.kind : undefined,
          lengthIn: Number(input.lengthIn),
          widthIn: Number(input.widthIn),
          heightIn: Number(input.heightIn),
          weightOz: Number(input.weightOz),
          maxCards: input.maxCards === "" || input.maxCards == null ? null : Number(input.maxCards),
          isDefault: input.isDefault === true || input.isDefault === "true" || input.isDefault === "on",
        });
        return { ok: true, message: "Package saved.", ...(await packagesPayload(deps)) };
      }
      case "package-delete":
        await deletePackage(deps.db, str(b, "packageId"));
        return { ok: true, message: "Package removed.", ...(await packagesPayload(deps)) };
      case "settings-save":
        await saveShipSettings(deps.db, {
          ozPerCard: b.ozPerCard === undefined || b.ozPerCard === "" ? undefined : Number(b.ozPerCard),
          packingOz: b.packingOz === undefined || b.packingOz === "" ? undefined : Number(b.packingOz),
        });
        return { ok: true, message: "Weights saved.", ...(await packagesPayload(deps)) };
      case "label": {
        const s = await buyLabel(deps, need(), actor, str(b, "rateId") || undefined, choiceFrom(b));
        return { ok: true, message: `Label bought: ${(s.carrier ?? "").toUpperCase()} ${s.trackingNumber ?? ""}`.trim(), shipment: await detail(deps, s.id) };
      }
      case "swap":
      case "remove": {
        const copyId = str(b, "copyId");
        if (!copyId) throw new BrokerShipError("Missing copy id.");
        await fixShipmentCard(deps, need(), { action: intent, copyId, revision: str(b, "revision") || undefined }, actor);
        return {
          ok: true,
          message: intent === "swap" ? "Card swapped. Pull the new copy shown." : "Card removed and returned to the customer's vault.",
          shipment: await detail(deps, id),
        };
      }
      case "shipped":
        await markShipped(deps, need(), actor);
        return { ok: true, message: "Marked dropped off. The customer was emailed tracking.", shipment: await detail(deps, id) };
      case "cancel":
        await cancelShipment(deps, need(), actor, str(b, "reason") || "staff canceled");
        return { ok: true, message: "Shipment canceled. Cards are back in the vault and any Cardbits fee was refunded.", shipment: await detail(deps, id) };
      case "slip": {
        const s = await deps.db.siteShipment.findUnique({ where: { id: need() }, include: { items: true } });
        if (!s) throw new BrokerShipError("Shipment not found.", 404);
        return { html: packingSlipHtml(s) };
      }
      default:
        throw new BrokerShipError("Unknown intent.");
    }
  } catch (err) {
    if (err instanceof BrokerShipError) throw err;
    if (err instanceof ShippingError) {
      throw new BrokerShipError([err.message, ...err.details].join(" "), err.code === "NOT_FOUND" ? 404 : 409);
    }
    if (err instanceof CopyLockError || err instanceof FeePaymentError) throw new BrokerShipError(err.message, 409);
    if (err instanceof PackageError) throw new BrokerShipError(err.message, 422);
    throw err;
  }
}
