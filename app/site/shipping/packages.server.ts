// Saved shipping packages + shipment weight for the label desk.
//
// Weight = package empty weight + cards × ozPerCard + packingOz (slip, team bags, tape).
// ozPerCard defaults to 0.3 oz: card ~1.8 g + penny sleeve ~0.6 g + toploader ~6 g ≈ 8.4 g.
// Staff can override the weight on a shipment (e.g. after weighing it on a scale).
// Carriers bill USPS Ground Advantage by the ounce, rounded up, so we round up to 0.1 oz and never
// under-declare.

import type { PrismaClient, SiteShipPackage } from "@prisma/client";
import { parcelFor, type Parcel } from "./policy";

export const SHIP_SETTINGS_KEY = "cardbit-site:ship-settings";
export type ShipSettings = { ozPerCard: number; packingOz: number };
export const DEFAULT_SHIP_SETTINGS: ShipSettings = { ozPerCard: 0.3, packingOz: 0.3 };

export class PackageError extends Error {}

type Db = Pick<PrismaClient, "siteShipPackage" | "appValue" | "$transaction">;

export async function getShipSettings(db: Pick<PrismaClient, "appValue">): Promise<ShipSettings> {
  const row = await db.appValue.findUnique({ where: { key: SHIP_SETTINGS_KEY } });
  if (!row) return { ...DEFAULT_SHIP_SETTINGS };
  try {
    const v = JSON.parse(row.value) as Partial<ShipSettings>;
    return {
      ozPerCard: num(v.ozPerCard, DEFAULT_SHIP_SETTINGS.ozPerCard),
      packingOz: num(v.packingOz, DEFAULT_SHIP_SETTINGS.packingOz),
    };
  } catch {
    return { ...DEFAULT_SHIP_SETTINGS };
  }
}

export async function saveShipSettings(db: Pick<PrismaClient, "appValue">, input: Partial<ShipSettings>) {
  const cur = await getShipSettings(db);
  const next: ShipSettings = {
    ozPerCard: input.ozPerCard === undefined ? cur.ozPerCard : bounded(input.ozPerCard, 0.01, 16, "Weight per card"),
    packingOz: input.packingOz === undefined ? cur.packingOz : bounded(input.packingOz, 0, 64, "Packing weight"),
  };
  const value = JSON.stringify(next);
  await db.appValue.upsert({ where: { key: SHIP_SETTINGS_KEY }, create: { key: SHIP_SETTINGS_KEY, value }, update: { value } });
  return next;
}

export async function listPackages(db: Pick<PrismaClient, "siteShipPackage">) {
  return db.siteShipPackage.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { maxCards: "asc" }, { name: "asc" }] });
}

export type PackageInput = {
  id?: string;
  name: string;
  kind?: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightOz: number;
  maxCards?: number | null;
  isDefault?: boolean;
};

const KINDS = ["MAILER", "BOX", "ENVELOPE"];

export async function savePackage(db: Db, input: PackageInput) {
  const name = String(input.name ?? "").trim().slice(0, 60);
  if (!name) throw new PackageError("Give the package a name.");
  const kind = KINDS.includes(String(input.kind ?? "").toUpperCase()) ? String(input.kind).toUpperCase() : "MAILER";
  const data = {
    name,
    kind,
    lengthIn: bounded(input.lengthIn, 0.1, 108, "Length"),
    widthIn: bounded(input.widthIn, 0.1, 108, "Width"),
    heightIn: bounded(input.heightIn, 0.01, 108, "Height"),
    weightOz: bounded(input.weightOz, 0, 1120, "Empty weight"),
    maxCards: input.maxCards === null || input.maxCards === undefined || (input.maxCards as unknown) === "" ? null : Math.round(bounded(input.maxCards, 1, 100000, "Max cards")),
  };
  return db.$transaction(async (tx) => {
    const count = await tx.siteShipPackage.count({ where: { active: true, ...(input.id ? { id: { not: input.id } } : {}) } });
    const makeDefault = Boolean(input.isDefault) || count === 0;
    if (makeDefault) await tx.siteShipPackage.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    if (input.id) {
      const cur = await tx.siteShipPackage.findUnique({ where: { id: input.id } });
      if (!cur || !cur.active) throw new PackageError("Package not found.");
      return tx.siteShipPackage.update({ where: { id: input.id }, data: { ...data, ...(makeDefault ? { isDefault: true } : {}) } });
    }
    return tx.siteShipPackage.create({ data: { ...data, isDefault: makeDefault } });
  });
}

/** Retires a package (old shipments keep their packageId). The default moves to the next package. */
export async function deletePackage(db: Db, id: string) {
  return db.$transaction(async (tx) => {
    const cur = await tx.siteShipPackage.findUnique({ where: { id } });
    if (!cur || !cur.active) throw new PackageError("Package not found.");
    await tx.siteShipPackage.update({ where: { id }, data: { active: false, isDefault: false } });
    if (cur.isDefault) {
      const next = await tx.siteShipPackage.findFirst({ where: { active: true }, orderBy: [{ maxCards: "asc" }, { createdAt: "asc" }] });
      if (next) await tx.siteShipPackage.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

/** Smallest saved package that fits the card count, else the default package, else null. */
export function autoPackage(packages: SiteShipPackage[], cardCount: number) {
  const fits = packages
    .filter((p) => p.active && p.maxCards != null && p.maxCards >= cardCount)
    .sort((a, b) => a.maxCards! - b.maxCards! || a.lengthIn * a.widthIn * a.heightIn - b.lengthIn * b.widthIn * b.heightIn);
  return fits[0] ?? packages.find((p) => p.active && p.isDefault) ?? null;
}

export type ParcelChoice = { packageId?: string | null; weightOz?: number | null };

export type ParcelPlan = {
  parcel: Parcel;
  packageId: string | null;
  packageName: string;
  auto: boolean;
  weight: { packageOz: number; cardsOz: number; packingOz: number; calculatedOz: number; overrideOz: number | null; totalOz: number };
};

/**
 * The parcel a label is quoted and bought with. Without saved packages it falls back to the
 * built-in sizes in policy.ts so labels still work.
 */
export async function planParcel(db: Pick<PrismaClient, "siteShipPackage" | "appValue">, cardCount: number, choice: ParcelChoice = {}): Promise<ParcelPlan> {
  const [packages, settings] = await Promise.all([listPackages(db), getShipSettings(db)]);
  let pkg: SiteShipPackage | null = null;
  if (choice.packageId) {
    pkg = packages.find((p) => p.id === choice.packageId) ?? null;
    if (!pkg) throw new PackageError("That package isn't available anymore. Pick another.");
  } else pkg = autoPackage(packages, cardCount);

  const builtIn = parcelFor(cardCount);
  const packageOz = pkg ? pkg.weightOz : 0;
  const cardsOz = settings.ozPerCard * cardCount;
  const packingOz = pkg ? settings.packingOz : 0;
  // Built-in sizes already include their own mailer weight.
  const calculatedOz = roundUp(pkg ? packageOz + cardsOz + packingOz : builtIn.weightOz);
  const overrideOz = choice.weightOz != null && Number.isFinite(Number(choice.weightOz)) ? bounded(choice.weightOz, 0.1, 1120, "Weight") : null;
  const totalOz = roundUp(overrideOz ?? calculatedOz);
  const parcel: Parcel = pkg
    ? { length: pkg.lengthIn, width: pkg.widthIn, height: pkg.heightIn, weightOz: totalOz, template: pkg.name }
    : { ...builtIn, weightOz: totalOz };
  return {
    parcel,
    packageId: pkg?.id ?? null,
    packageName: pkg?.name ?? `Built-in ${builtIn.template}`,
    auto: !choice.packageId,
    weight: { packageOz: roundUp(packageOz), cardsOz: roundUp(cardsOz), packingOz: roundUp(packingOz), calculatedOz, overrideOz, totalOz },
  };
}

const roundUp = (oz: number) => Math.ceil(oz * 10 - 1e-9) / 10;
function num(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function bounded(v: unknown, min: number, max: number, label: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new PackageError(`${label} must be between ${min} and ${max}.`);
  return n;
}
