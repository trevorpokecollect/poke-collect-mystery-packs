// Cardbit transactional email templates. Table layout + inline styles for mail clients.
// Copy rules: "Cardbits" in customer copy, Title Case headings and buttons, no retail values.

import { BRAND, bits, esc, siteUrl, usd } from "../brand/html";

export type EmailCard = { title: string; image?: string | null; offerBits?: number | null };
export type EmailAddress = { name: string; street1: string; street2?: string; city: string; state: string; zip: string };

export type EmailData = {
  signin_code: { code: string; minutes: number; email?: string; returnTo?: string };
  topup_receipt: {
    orderId: string;
    paidCents: number;
    bits: number;
    bonusBits: number;
    balanceBits: number;
    paymentLabel: string;
  };
  pack_receipt: {
    orderId: string;
    lines: { name: string; quantity: number; bits: number }[];
    totalBits: number;
    balanceBits: number;
  };
  pack_opened: { packName: string; cards: EmailCard[] };
  buyback_confirmation: { cards: { title: string; bits: number }[]; totalBits: number; balanceBits: number };
  shipment_created: {
    shipmentId: string;
    cards: string[];
    feeKind: "FREE" | "CARDBITS" | "USD";
    processBy: string;
    address: EmailAddress;
  };
  shipment_shipped: {
    shipmentId: string;
    cards: string[];
    carrier: string;
    trackingNumber: string;
    trackingUrl: string | null;
  };
  shipment_delivered: { shipmentId: string; cardCount: number; trackingUrl: string | null };
};

export type EmailKind = keyof EmailData;

export type Rendered = { subject: string; preheader: string; html: string; text: string };

// ---------- layout ----------

function layout(opts: {
  preheader: string;
  heading: string;
  intro: string;
  body: string;
  cta?: { label: string; href: string };
  footnote?: string;
}) {
  const cta = opts.cta
    ? `<tr><td style="padding:8px 32px 28px"><a href="${esc(opts.cta.href)}" style="display:inline-block;background:${BRAND.cobalt};color:#fff;font-family:${BRAND.heading};font-weight:800;font-size:16px;text-decoration:none;padding:14px 26px;border-radius:999px">${esc(opts.cta.label)}</a></td></tr>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.ivory}">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.ivory}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid ${BRAND.line}">
<tr><td style="background:${BRAND.navy};padding:22px 32px">
<span style="font-family:${BRAND.heading};font-weight:800;font-size:28px;letter-spacing:-0.5px;color:#fff">cardbit</span>
<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${BRAND.apricot};margin-left:4px"></span>
</td></tr>
<tr><td style="padding:28px 32px 6px"><h1 style="margin:0;font-family:${BRAND.heading};font-weight:800;font-size:26px;line-height:1.2;color:${BRAND.navy}">${esc(opts.heading)}</h1></td></tr>
<tr><td style="padding:10px 32px 14px;font-family:${BRAND.body};font-size:16px;line-height:1.55;color:${BRAND.ink}">${opts.intro}</td></tr>
<tr><td style="padding:0 32px 14px;font-family:${BRAND.body};font-size:15px;line-height:1.5;color:${BRAND.ink}">${opts.body}</td></tr>
${cta}
<tr><td style="padding:18px 32px 26px;border-top:1px solid ${BRAND.line};font-family:${BRAND.body};font-size:12px;line-height:1.5;color:${BRAND.muted}">${opts.footnote ? `${opts.footnote}<br><br>` : ""}Cardbit LLC · Hosted by Poke-Collect.<br>Questions? Reply to this email or write to <a href="mailto:hello@cardbit.com" style="color:${BRAND.cobalt}">hello@cardbit.com</a>.</td></tr>
</table></td></tr></table></body></html>`;
}

const row = (left: string, right: string, strong = false) =>
  `<tr><td style="padding:8px 0;border-bottom:1px solid ${BRAND.line};font-family:${BRAND.body};font-size:15px;color:${BRAND.ink}">${left}</td><td align="right" style="padding:8px 0;border-bottom:1px solid ${BRAND.line};font-family:${strong ? BRAND.heading : BRAND.body};font-weight:${strong ? 800 : 400};font-size:15px;color:${BRAND.navy};white-space:nowrap">${right}</td></tr>`;
const table = (rows: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
const list = (items: string[], max = 40) => {
  const shown = items.slice(0, max).map((t) => `<li style="margin:0 0 4px">${esc(t)}</li>`).join("");
  const more = items.length > max ? `<li style="color:${BRAND.muted}">and ${items.length - max} more</li>` : "";
  return `<ul style="margin:0;padding-left:20px">${shown}${more}</ul>`;
};
const addressHtml = (a: EmailAddress) =>
  `${esc(a.name)}<br>${esc(a.street1)}${a.street2 ? `<br>${esc(a.street2)}` : ""}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}`;
const addressText = (a: EmailAddress) =>
  `${a.name}\n${a.street1}${a.street2 ? `\n${a.street2}` : ""}\n${a.city}, ${a.state} ${a.zip}`;
const carrierName = (c: string) =>
  ({ usps: "USPS", ups: "UPS", fedex: "FedEx", dhl_express: "DHL Express" })[c.toLowerCase()] ?? c.toUpperCase();
const textFooter = "\n\n—\nCardbit LLC · Hosted by Poke-Collect.\nQuestions? Reply or write to hello@cardbit.com.";
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

// ---------- templates ----------

export function renderEmail<K extends EmailKind>(kind: K, data: EmailData[K], env: NodeJS.ProcessEnv = process.env): Rendered {
  const base = siteUrl(env);
  switch (kind) {
    case "signin_code": {
      const d = data as EmailData["signin_code"];
      const preheader = `Your Cardbit sign-in code is ${d.code}`;
      // One-tap link: the code rides in the #fragment, so it never reaches server logs, and the
      // page asks for a tap before signing in (mail scanners that open links can't use it up).
      const link = d.email && d.code
        ? `${base}/sign-in/link?e=${encodeURIComponent(d.email)}${d.returnTo ? `&rt=${encodeURIComponent(d.returnTo)}` : ""}#c=${encodeURIComponent(d.code)}`
        : null;
      return {
        subject: `${d.code} Is Your Cardbit Sign-In Code`,
        preheader,
        html: layout({
          preheader,
          heading: "Your Sign-In Code",
          intro: link
            ? `Tap the button to sign in, or enter this code. It expires in ${d.minutes} minutes.`
            : `Enter this code to sign in to Cardbit. It expires in ${d.minutes} minutes.`,
          body: `<div style="font-family:${BRAND.heading};font-weight:800;font-size:40px;letter-spacing:10px;color:${BRAND.navy};background:${BRAND.ivory};border-radius:14px;padding:18px 0;text-align:center">${esc(d.code)}</div>`,
          cta: link ? { label: "Sign In To Cardbit", href: link } : undefined,
          footnote: "Didn't ask for this? You can ignore it. Nobody can sign in without the code, and Cardbit will never ask you for it.",
        }),
        text: `Your Cardbit sign-in code: ${d.code}\n\n${link ? `Or sign in with this link: ${link}\n\n` : ""}It expires in ${d.minutes} minutes. Didn't ask for this? Ignore this email. Cardbit will never ask you for the code.${textFooter}`,
      };
    }
    case "topup_receipt": {
      const d = data as EmailData["topup_receipt"];
      const total = d.bits + d.bonusBits;
      const preheader = `${bits(total)} added to your balance.`;
      return {
        subject: `Receipt: ${bits(total)} Added`,
        preheader,
        html: layout({
          preheader,
          heading: "Cardbits Added",
          intro: `Thanks for topping up. Your Cardbits are ready to spend on packs and singles.`,
          body: table(
            row("Paid", esc(`${usd(d.paidCents)} · ${d.paymentLabel}`)) +
              row("Cardbits", esc(bits(d.bits))) +
              (d.bonusBits ? row("Bonus Cardbits", esc(`+${bits(d.bonusBits)}`)) : "") +
              row("New balance", esc(bits(d.balanceBits)), true),
          ) + `<p style="margin:14px 0 0;font-size:13px;color:${BRAND.muted}">Order ${esc(d.orderId)}. Top-ups are final sale. Purchased Cardbits never expire.</p>`,
          cta: { label: "Open A Pack", href: `${base}/packs` },
        }),
        text: `Cardbits added\n\nPaid: ${usd(d.paidCents)} (${d.paymentLabel})\nCardbits: ${bits(d.bits)}${d.bonusBits ? `\nBonus Cardbits: +${bits(d.bonusBits)}` : ""}\nNew balance: ${bits(d.balanceBits)}\n\nOrder ${d.orderId}. Top-ups are final sale. Purchased Cardbits never expire.\n\nOpen a pack: ${base}/packs${textFooter}`,
      };
    }
    case "pack_receipt": {
      const d = data as EmailData["pack_receipt"];
      const count = d.lines.reduce((n, l) => n + l.quantity, 0);
      const preheader = `${count} pack${count === 1 ? "" : "s"} ready to open.`;
      return {
        subject: `Receipt: ${count} Pack${count === 1 ? "" : "s"} Ready To Open`,
        preheader,
        html: layout({
          preheader,
          heading: "Your Packs Are Ready",
          intro: `Every pack holds real cards that are already set aside for you. Open them whenever you like.`,
          body: table(
            d.lines.map((l) => row(esc(`${l.quantity} × ${l.name}`), esc(bits(l.bits)))).join("") +
              row("Total", esc(bits(d.totalBits)), true) +
              row("Balance", esc(bits(d.balanceBits))),
          ) + `<p style="margin:14px 0 0;font-size:13px;color:${BRAND.muted}">Order ${esc(d.orderId)}.</p>`,
          cta: { label: "Open My Packs", href: `${base}/openings` },
        }),
        text: `Your packs are ready\n\n${d.lines.map((l) => `${l.quantity} x ${l.name}: ${bits(l.bits)}`).join("\n")}\nTotal: ${bits(d.totalBits)}\nBalance: ${bits(d.balanceBits)}\n\nOrder ${d.orderId}.\nOpen them: ${base}/openings${textFooter}`,
      };
    }
    case "pack_opened": {
      const d = data as EmailData["pack_opened"];
      const lead = d.cards[0]?.title ?? "your cards";
      const preheader = `You pulled ${lead}${d.cards.length > 1 ? ` and ${d.cards.length - 1} more` : ""}.`;
      const cards = d.cards
        .map(
          (c) => `<tr>${c.image ? `<td width="64" style="padding:8px 12px 8px 0"><img src="${esc(c.image)}" width="56" alt="" style="display:block;border-radius:6px"></td>` : ""}<td style="padding:8px 0;font-family:${BRAND.body};font-size:15px;color:${BRAND.ink}">${esc(c.title)}${c.offerBits ? `<br><span style="font-size:13px;color:${BRAND.muted}">Buyback offer today: ${esc(bits(c.offerBits))}</span>` : ""}</td></tr>`,
        )
        .join("");
      return {
        subject: `You Pulled ${lead}`,
        preheader,
        html: layout({
          preheader,
          heading: `${d.packName} Opened`,
          intro: `Your cards are in My Vault. Keep them, ship them home, or sell them back for Cardbits.`,
          body: table(cards),
          cta: { label: "Go To My Vault", href: `${base}/vault` },
          footnote: "Buyback offers change daily. You'll see the current offer before you confirm.",
        }),
        text: `${d.packName} opened\n\n${d.cards.map((c) => `- ${c.title}${c.offerBits ? ` (buyback offer today: ${bits(c.offerBits)})` : ""}`).join("\n")}\n\nYour cards are in My Vault: ${base}/vault\nBuyback offers change daily.${textFooter}`,
      };
    }
    case "buyback_confirmation": {
      const d = data as EmailData["buyback_confirmation"];
      const preheader = `${bits(d.totalBits)} added to your balance.`;
      return {
        subject: `Buyback Complete: ${bits(d.totalBits)} Added`,
        preheader,
        html: layout({
          preheader,
          heading: "Buyback Complete",
          intro: `You sold ${d.cards.length === 1 ? "a card" : `${d.cards.length} cards`} back to Cardbit. The Cardbits are already in your balance.`,
          body: table(
            d.cards.map((c) => row(esc(c.title), esc(bits(c.bits)))).join("") +
              row("Total", esc(bits(d.totalBits)), true) +
              row("New balance", esc(bits(d.balanceBits))),
          ),
          cta: { label: "Spend Cardbits", href: `${base}/packs` },
        }),
        text: `Buyback complete\n\n${d.cards.map((c) => `- ${c.title}: ${bits(c.bits)}`).join("\n")}\nTotal: ${bits(d.totalBits)}\nNew balance: ${bits(d.balanceBits)}${textFooter}`,
      };
    }
    case "shipment_created": {
      const d = data as EmailData["shipment_created"];
      const n = d.cards.length;
      const fee = d.feeKind === "FREE" ? "Free shipping" : d.feeKind === "CARDBITS" ? "600 Cardbits" : "$6.00";
      const preheader = `We'll ship ${n} card${n === 1 ? "" : "s"} by ${fmtDate(d.processBy)}.`;
      return {
        subject: `Shipment Requested: ${n} Card${n === 1 ? "" : "s"}`,
        preheader,
        html: layout({
          preheader,
          heading: "We're Packing Your Cards",
          intro: `Your cards have left your vault and are reserved for this shipment. We ship within 48 hours, by <strong>${esc(fmtDate(d.processBy))}</strong>. You'll get tracking as soon as the label prints.`,
          body:
            table(row("Shipping", esc(fee)) + row("Cards", String(n))) +
            `<p style="margin:16px 0 6px;font-family:${BRAND.heading};font-weight:800;color:${BRAND.navy}">Shipping To</p><p style="margin:0 0 14px">${addressHtml(d.address)}</p>` +
            `<p style="margin:16px 0 6px;font-family:${BRAND.heading};font-weight:800;color:${BRAND.navy}">Cards</p>${list(d.cards)}`,
          cta: { label: "View Shipment", href: `${base}/shipments/${encodeURIComponent(d.shipmentId)}` },
          footnote: "We replace packages the carrier loses. If tracking shows delivered but the package was stolen or damaged, file a claim with the carrier.",
        }),
        text: `We're packing your cards\n\nWe ship within 48 hours, by ${fmtDate(d.processBy)}.\nShipping: ${fee}\n\nShipping to:\n${addressText(d.address)}\n\nCards:\n${d.cards.map((c) => `- ${c}`).join("\n")}\n\n${base}/shipments/${d.shipmentId}${textFooter}`,
      };
    }
    case "shipment_shipped": {
      const d = data as EmailData["shipment_shipped"];
      const preheader = `${carrierName(d.carrier)} tracking ${d.trackingNumber}`;
      return {
        subject: "Your Cards Have Shipped",
        preheader,
        html: layout({
          preheader,
          heading: "Your Cards Are On The Way",
          intro: `${carrierName(d.carrier)} has your package. Tracking number <strong>${esc(d.trackingNumber)}</strong>.`,
          body: `<p style="margin:0 0 6px;font-family:${BRAND.heading};font-weight:800;color:${BRAND.navy}">In This Package</p>${list(d.cards)}`,
          cta: d.trackingUrl ? { label: "Track Package", href: d.trackingUrl } : undefined,
        }),
        text: `Your cards are on the way\n\n${carrierName(d.carrier)} tracking: ${d.trackingNumber}${d.trackingUrl ? `\n${d.trackingUrl}` : ""}\n\nIn this package:\n${d.cards.map((c) => `- ${c}`).join("\n")}${textFooter}`,
      };
    }
    case "shipment_delivered": {
      const d = data as EmailData["shipment_delivered"];
      const preheader = "Tracking shows your package was delivered.";
      return {
        subject: "Your Cards Were Delivered",
        preheader,
        html: layout({
          preheader,
          heading: "Delivered",
          intro: `Tracking shows your ${d.cardCount} card${d.cardCount === 1 ? "" : "s"} arrived. Enjoy them.`,
          body: "",
          cta: { label: "Open Another Pack", href: `${base}/packs` },
          footnote: "Package missing or damaged? File a claim with the carrier, and write to us if you need help.",
        }),
        text: `Delivered\n\nTracking shows your ${d.cardCount} card${d.cardCount === 1 ? "" : "s"} arrived.${d.trackingUrl ? `\n${d.trackingUrl}` : ""}${textFooter}`,
      };
    }
  }
  throw new Error(`Unknown email kind ${String(kind)}`);
}
