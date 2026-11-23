import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { escapeHtml as esc } from "../lib/winners";
import { loadClaim, submitClaim, type ClaimView } from "../lib/winners.server";

// Prize claim page at /apps/packs/campaigns/claim/<token>, linked from the winner email.
// Returned as Liquid (Content-Type application/liquid) so Shopify wraps it in the
// store's theme. Every dynamic value goes through esc(), which also neutralizes
// "{" and "}" so nothing a winner types can run as Liquid.
// This is a two-segment path, so it never collides with proxy.$slug.

function shopFrom(request: Request) {
  return new URL(request.url).searchParams.get("shop") ?? "";
}

/** Where the form posts back to, built from Shopify's path_prefix (merchants can rename the proxy). */
function formAction(request: Request, token: string) {
  const prefix = new URL(request.url).searchParams.get("path_prefix") ?? "";
  const safe = /^\/[\w/-]{1,100}$/.test(prefix) ? prefix+"/campaigns" : "/apps/packs/campaigns";
  return `${safe}/claim/${encodeURIComponent(token)}`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { liquid } = await authenticate.public.appProxy(request);
  const view = await loadClaim(shopFrom(request), params.token);
  return liquid(page(view, formAction(request, params.token ?? "")), {
    headers: { "Cache-Control": "no-store" },
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { liquid } = await authenticate.public.appProxy(request);
  const form = Object.fromEntries(
    [...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]),
  );
  const { view, error } = await submitClaim(
    shopFrom(request),
    params.token,
    form,
  );
  return liquid(
    page(view, formAction(request, params.token ?? ""), error, form),
    { headers: { "Cache-Control": "no-store" } },
  );
};

const STYLE = `<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap" rel="stylesheet">
<style>
.pcc{--red:#4057f5;--red-dark:#b81d27;--ink:#161616;--yellow:#ffd800;--cream:#f1eee4;
  max-width:640px;margin:32px auto;padding:0 16px;color:#1a1a1a;font-family:"Helvetica Neue",Arial,sans-serif}
.pcc__card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(20,20,26,.1);border:1px solid rgba(0,0,0,.08)}
.pcc__hero{background:var(--ink);color:#fff;padding:24px;border-bottom:4px solid var(--yellow)}
.pcc__kicker{font-family:Oswald,"Arial Narrow",Impact,sans-serif;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--yellow);font-size:.8em}
.pcc__title{margin:8px 0 4px;font-family:Oswald,"Arial Narrow",Impact,sans-serif;font-weight:700;font-size:2em;line-height:1.1;text-transform:uppercase;color:#fff}
.pcc__prize{margin:0;color:#ff6b6b;font-weight:700}
.pcc__image{display:block;width:100%;max-height:320px;object-fit:contain;background:var(--cream)}
.pcc__bundle{display:flex;align-items:flex-end;justify-content:center;gap:12px;height:320px;padding:16px;box-sizing:border-box;background:var(--cream)}
.pcc__part{flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px}
.pcc__part img{max-width:100%;max-height:85%;object-fit:contain}
.pcc__qty{padding:3px 12px;border-radius:999px;background:var(--yellow);color:var(--ink);font-family:Oswald,"Arial Narrow",Impact,sans-serif;font-weight:700}
.pcc__body{padding:24px}
.pcc__body p{margin:0 0 14px;line-height:1.55}
.pcc__form{display:grid;gap:12px;grid-template-columns:1fr 1fr}
.pcc__form label{display:grid;gap:4px;font-size:.85em;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
.pcc__wide{grid-column:1/-1}
.pcc__form input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid rgba(0,0,0,.2);border-radius:10px;background:#fafafa;font:inherit;font-weight:400;text-transform:none;color:#1a1a1a}
.pcc__form input:focus{outline:none;border-color:var(--red);box-shadow:0 0 0 3px rgba(226,47,57,.18);background:#fff}
.pcc__btn{grid-column:1/-1;padding:14px 18px;border:0;border-radius:10px;background:linear-gradient(120deg,var(--red),var(--red-dark));color:#fff;font-family:Oswald,"Arial Narrow",Impact,sans-serif;font-weight:700;font-size:1.05em;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;box-shadow:0 6px 16px rgba(226,47,57,.3)}
.pcc__btn:hover,.pcc__btn:focus-visible{background:var(--ink)}
.pcc__error{grid-column:1/-1;margin:0;padding:10px 12px;border-radius:10px;background:#fdecec;color:var(--red-dark);font-weight:700}
.pcc__note{font-size:.88em;color:#555}
.pcc__done{display:inline-block;padding:6px 12px;border-radius:999px;background:var(--yellow);color:var(--ink);font-family:Oswald,"Arial Narrow",Impact,sans-serif;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.85em}
@media (max-width:560px){.pcc__form{grid-template-columns:1fr}.pcc__title{font-size:1.6em}}
</style>`;

function shell(
  kicker: string,
  title: string,
  body: string,
  image?: string | null,
  items?: { imageUrl: string | null; quantity: number }[] | null,
) {
  // Bundle prizes show every product, with "3x" above repeated ones.
  const pictures =
    items && (items.length > 1 || items[0].quantity > 1)
      ? `<div class="pcc__bundle">${items
          .map(
            (i) =>
              `<div class="pcc__part">${i.quantity > 1 ? `<span class="pcc__qty">${i.quantity}x</span>` : ""}${i.imageUrl ? `<img src="${esc(i.imageUrl)}" alt="">` : ""}</div>`,
          )
          .join("")}</div>`
      : image
        ? `<img class="pcc__image" src="${esc(image)}" alt="">`
        : "";
  return `${STYLE}
<div class="pcc"><div class="pcc__card">
${pictures}
<div class="pcc__hero"><div class="pcc__kicker">${esc(kicker)}</div><h1 class="pcc__title">${esc(title)}</h1></div>
<div class="pcc__body">${body}</div>
</div></div>`;
}

function input(
  name: string,
  label: string,
  value: string,
  opts: {
    required?: boolean;
    wide?: boolean;
    autocomplete: string;
    type?: string;
  },
) {
  return `<label${opts.wide ? ' class="pcc__wide"' : ""}>${esc(label)}
<input name="${name}" type="${opts.type ?? "text"}" value="${esc(value)}" autocomplete="${opts.autocomplete}"${opts.required === false ? "" : " required"}></label>`;
}

function page(
  view: ClaimView,
  action: string,
  error?: string,
  values: Record<string, string> = {},
) {
  switch (view.kind) {
    case "invalid":
      return shell(
        "Prize claim",
        "Link not recognized",
        `<p>This claim link isn't valid. Please use the link from your winner email, or reply to that email for help.</p>`,
      );
    case "closed":
      return shell(
        "Prize claim",
        "This claim has closed",
        `<p>The window to claim your prize from <strong>${esc(view.title)}</strong> has ended. If you think this is a mistake, reply to your winner email and we'll take a look.</p>`,
      );
    case "claimed":
      return shell(
        "You're all set",
        view.prize,
        `<p><span class="pcc__done">Details received</span></p>
<p>Thanks! We have your shipping details for <strong>${esc(view.prize)}</strong> from ${esc(view.title)}. We'll email you when it ships.</p>`,
      );
    case "form": {
      const v = (k: string, d = "") => values[k] ?? d;
      const deadline = view.deadline.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      return shell(
        "You won!",
        view.prize,
        `<p>Congratulations! You won <strong>${esc(view.prize)}</strong> in ${esc(view.title)}. Confirm where we should send it by <strong>${esc(deadline)}</strong>.</p>
<form class="pcc__form" method="post" action="${esc(action)}">
${error ? `<p class="pcc__error" role="alert">${esc(error)}</p>` : ""}
${input("name", "Full name", v("name", view.defaults.name), { wide: true, autocomplete: "name" })}
${input("address1", "Address", v("address1"), { wide: true, autocomplete: "address-line1" })}
${input("address2", "Apartment, suite (optional)", v("address2"), { wide: true, required: false, autocomplete: "address-line2" })}
${input("city", "City", v("city"), { autocomplete: "address-level2" })}
${input("province", "State", v("province"), { autocomplete: "address-level1" })}
${input("zip", "ZIP code", v("zip"), { autocomplete: "postal-code" })}
${input("country", "Country", v("country", "United States"), { autocomplete: "country-name" })}
${input("phone", "Phone", v("phone"), { wide: true, type: "tel", autocomplete: "tel" })}
<button class="pcc__btn" type="submit">Confirm my details</button>
</form>
<p class="pcc__note" style="margin-top:14px">Prizes ship only to US addresses (the 50 states and DC). We only use these details to ship your prize.</p>`,
        view.imageUrl,
        view.items,
      );
    }
  }
}
