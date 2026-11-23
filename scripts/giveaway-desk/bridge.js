import { redirect } from "react-router";
export async function rpc(action, fields = {}) {
  const result = await fetch("/staff/cardbit-api", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF": document.querySelector('meta[name="cardbit-csrf"]').content,
    },
    body: JSON.stringify({ ...fields, action }),
  });
  const value = await result.json().catch(() => ({}));
  if (!result.ok || value.error)
    throw Error(value.error || "Your session expired. Reload the page.");
  return value;
}
async function formFields(request) {
  const fields = [];
  for (const [key, value] of await request.formData()) {
    if (typeof value === "string") fields.push([key, value]);
    else if (value.size) {
      if (value.size > 5 * 1024 * 1024)
        throw Error("Select a file under 5 MB.");
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(value);
      });
      fields.push([key, { base64, name: value.name, mime: value.type }]);
    }
  }
  return fields;
}
export async function load({ request }) {
  const url = new URL(request.url),
    fields = request.method === "POST" ? await formFields(request) : undefined;
  const res = await rpc("giveaway-campaign", {
    path: url.pathname + url.search,
    method: request.method,
    fields,
  });
  if (res.redirect) return redirect(res.redirect);
  return res.data;
}
export async function downloadFile(url, fallback) {
  const u = new URL(url, location.href);
  const res = await rpc("giveaway-campaign", {
    path: u.pathname + u.search,
    method: "GET",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([res.csv], { type: "text/csv" }));
  a.download = res.filename || fallback;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export function useAppBridge() {
  return { resourcePicker: pick };
}
function pick(opts) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "cb-picker";
    dlg.innerHTML =
      '<form method="dialog"><h2>Choose Cardbit inventory</h2><label>Product search <input type="search" autofocus></label><p role="status"></p><div class="cb-results"></div><footer><button value="cancel">Cancel</button><button value="select">Use selection</button></footer></form>';
    document.body.append(dlg);
    const area = dlg.querySelector(".cb-results"),
      input = dlg.querySelector("input"),
      status = dlg.querySelector('[role="status"]'),
      selection = new Map(),
      existing = new Map((opts.selectionIds || []).map((p) => [p.id, p])),
      seen = new Map();
    let request = 0,
      timer;
    const variantOnly = opts.type === "variant";
    async function search() {
      const n = ++request;
      status.textContent = "Loading inventory…";
      try {
        const { products } = await rpc("giveaway-products", {
          search: input.value,
        });
        if (n !== request || !dlg.open) return;
        area.replaceChildren();
        status.textContent = products.length ? "" : "No matching products.";
        for (const product of products) {
          const variants = product.variants.nodes.map((v) => ({
            ...v,
            product: {
              id: product.id,
              title: product.title,
              handle: product.handle,
              images: product.media.nodes
                .filter((m) => m.preview?.image)
                .map((m) => ({ originalSrc: m.preview.image.url })),
            },
            image: v.media.nodes[0]?.preview?.image
              ? { originalSrc: v.media.nodes[0].preview.image.url }
              : null,
          }));
          const p = {
            ...product,
            images: product.media.nodes
              .filter((m) => m.preview?.image)
              .map((m) => ({ originalSrc: m.preview.image.url })),
            totalVariants: product.variantsCount.count,
            variants,
          };
          const items = variantOnly
            ? variants
            : [
                p,
                ...(opts.filter?.variants === false || p.hasOnlyDefaultVariant
                  ? []
                  : variants),
              ];
          for (const item of items) {
            const isProduct = item.id === p.id;
            seen.set(item.id, item);
            const label = document.createElement("label"),
              box = document.createElement("input");
            box.type = opts.multiple ? "checkbox" : "radio";
            box.name = "resource";
            const preset = existing.get(p.id);
            if (
              !selection.has(item.id) &&
              preset &&
              (isProduct
                ? !preset.variants?.length
                : preset.variants?.some((v) => v.id === item.id))
            )
              selection.set(item.id, item);
            box.checked = selection.has(item.id);
            box.addEventListener("change", () => {
              if (!opts.multiple) selection.clear();
              if (box.checked) selection.set(item.id, item);
              else selection.delete(item.id);
            });
            label.append(
              box,
              document.createTextNode(
                isProduct ? p.title : p.title + " · " + item.title,
              ),
            );
            area.append(label);
          }
        }
      } catch (e) {
        status.textContent = e.message;
      }
    }
    dlg.addEventListener("close", () => {
      clearTimeout(timer);
      const out = [...selection.values()];
      let result = out;
      if (!variantOnly) {
        const merged = new Map();
        for (const item of out) {
          if (!item.product) {
            merged.set(item.id, item);
            continue;
          }
          const pid = item.product.id;
          if (selection.has(pid)) continue;
          const parent = seen.get(pid);
          if (!parent) continue;
          const group = merged.get(pid) || { ...parent, variants: [] };
          group.variants.push(item);
          merged.set(pid, group);
        }
        result = [...merged.values()];
      }
      dlg.remove();
      resolve(dlg.returnValue === "select" ? result : undefined);
    });
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(search, 200);
    });
    dlg.showModal();
    search();
  });
}
