import { useEffect, useMemo, useRef, useState } from "react";
// The storefront widget itself, so the preview can't drift from what shoppers see.
import widgetCss from "../../../../../extensions/mystery-packs-theme/assets/giveaway.css?raw";
import widgetJs from "../../../../../extensions/mystery-packs-theme/assets/giveaway.js?raw";
import popupJs from "../../../../../extensions/mystery-packs-theme/assets/daily-popup.js?raw";
import type { CampaignFormValues } from "../lib/campaign-form";
import { previewData, type PreviewPrize } from "../lib/preview";
import { Select } from "./fields";

type Device = "desktop" | "phone";
type View = "page" | "popup";
type Layout = "three" | "wide" | "narrow";

const SIZE: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 780 },
};

const ACCENT = "#4057F5";

// Keeps "</script>" inside the inlined code and data from closing the script tag.
const inline = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1");

// Stand-ins for the theme's header icons, so the phone preview shows where the gift icon goes.
const ICON_SEARCH =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const ICON_CART =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2 12h12l2-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>';

export function pageHtml(device: Device, view: View, layout: Layout) {
  const widgetClass =
    view === "popup"
      ? "pcg"
      : layout === "three"
        ? "pcg pcg--wide pcg--three"
        : layout === "wide"
          ? "pcg pcg--wide"
          : "pcg";
  const widget = `<div class="${widgetClass}" data-pcg data-slug="preview" data-proxy="/apps/packs/campaigns" style="--pcg-accent:${ACCENT};--pcg-radius:22px"><div class="pcg__loading">Loading giveaway…</div></div>`;
  const body =
    view === "popup"
      ? `<header class="fake-header"><b>Cardbit</b><div class="header__icons"><span class="header__icon">${ICON_SEARCH}</span><span class="header__icon" id="cart-icon-bubble">${ICON_CART}</span></div></header>
<div class="fake-page"></div>
<div class="pcg-pop pcg-pop--left pcg-pop--mobile-tab" data-pcg-pop data-auto="false" data-delay="0" style="--pcg-accent:${ACCENT}">
<button class="pcg-pop__launcher" type="button" hidden><img class="pcg-pop__thumb" alt="" hidden><span class="pcg-pop__text"><b>Daily giveaway</b><small data-pcg-pop-sub>Enter free</small></span></button>
<dialog class="pcg-pop__dialog"><button class="pcg-pop__close" type="button" aria-label="Close">&times;</button>${widget}</dialog></div>`
      : `<main class="page">${widget}</main>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${widgetCss}</style>
<style>
html,body{margin:0;background:#fff;color:#1a1a1a;font-family:"Helvetica Neue",Arial,sans-serif}
.page{padding:${device === "phone" ? "16px 12px" : "32px 48px"}}
.fake-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#fff;border-bottom:1px solid #eee}
.header__icons{display:flex;align-items:center;gap:6px}.header__icon{display:flex;padding:6px;color:#1a1a1a}
.fake-page{min-height:100vh;background:repeating-linear-gradient(#f1eee4 0 120px,#fff 120px 240px)}
</style>
<script>
window.__pcgData = null;
// Stands in for the app proxy: every request gets the editor's current values.
window.fetch = function () {
  return Promise.resolve(new Response(JSON.stringify(window.__pcgData || {}), { status: 200, headers: { "Content-Type": "application/json" } }));
};
window.open = function () { return null; };
function pcgHeight() {
  var m = document.querySelector("main");
  if (m) parent.postMessage({ pcgPreviewHeight: Math.ceil(m.getBoundingClientRect().height) }, "*");
}
window.addEventListener("message", function (e) {
  if (!e.data || !e.data.pcgPreviewData) return;
  window.__pcgData = e.data.pcgPreviewData;
  document.querySelectorAll("[data-pcg]").forEach(function (r) { if (r.__pcg) r.__pcg.load(); });
});
</script>
</head><body>${body}
<script>${inline(widgetJs)}</script>
${view === "popup" ? `<script>${inline(popupJs)}</script>` : ""}
<script>
if (document.querySelector("main")) new ResizeObserver(pcgHeight).observe(document.querySelector("main"));
// Nothing navigates away from the preview.
document.addEventListener("click", function (e) {
  if (e.target.closest && e.target.closest("a[href]")) e.preventDefault();
}, true);
${view === "popup" ? `document.addEventListener("pcg:loaded", function () { var b = document.querySelector(".pcg-pop__launcher"); var d = document.querySelector(".pcg-pop__dialog"); if (b && d && !d.open && !window.__pcgOpened) { window.__pcgOpened = true; b.click(); } });` : ""}
parent.postMessage({ pcgPreviewReady: true }, "*");
</script>
</body></html>`;
}

function Toggle<T extends string>(props: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <s-stack direction="inline" gap="none">
      {props.options.map(([value, label]) => (
        <s-button
          key={value}
          variant={props.value === value ? "primary" : "secondary"}
          onClick={() => props.onChange(value)}
        >
          {label}
        </s-button>
      ))}
    </s-stack>
  );
}

/**
 * The storefront widget rendered from the editor's current values, in a sandboxed frame.
 * Text and entry changes update in place; switching device or view reloads the frame.
 */
export function GiveawayPreview(props: {
  values: CampaignFormValues;
  imageUrl: string | null;
  dailyPrize?: PreviewPrize | null;
}) {
  const daily = props.values.settings.daily.enabled;
  const [device, setDevice] = useState<Device>("desktop");
  const [picked, setView] = useState<View>("popup");
  // Popups only exist for daily giveaways.
  const view: View = daily ? picked : "page";
  const [layout, setLayout] = useState<Layout>("three");
  const [entered, setEntered] = useState(false);
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(SIZE.desktop.height);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const data = useMemo(
    () =>
      previewData(props.values, {
        imageUrl: props.imageUrl,
        entered,
        dailyPrize:
          props.dailyPrize ??
          (daily
            ? { title: "Today's prize (picked from your store)", imageUrl: null }
            : null),
      }),
    [props.values, props.imageUrl, props.dailyPrize, entered, daily],
  );
  const html = useMemo(
    () => pageHtml(device, view, layout),
    [device, view, layout],
  );
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  }, [data]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.pcgPreviewReady)
        frame.current?.contentWindow?.postMessage(
          { pcgPreviewData: latest.current },
          "*",
        );
      if (typeof e.data?.pcgPreviewHeight === "number")
        setHeight(e.data.pcgPreviewHeight);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Typing updates the open frame after a short pause instead of reloading it.
  useEffect(() => {
    const t = window.setTimeout(
      () =>
        frame.current?.contentWindow?.postMessage({ pcgPreviewData: data }, "*"),
      250,
    );
    return () => window.clearTimeout(t);
  }, [data]);

  const size = SIZE[device];
  const scale = Math.min(1, width / size.width);
  const frameHeight =
    view === "popup" ? size.height : Math.max(height, device === "phone" ? 400 : 300);

  return (
    <s-section heading="Preview">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200">
          <Toggle
            value={device}
            options={[
              ["desktop", "Desktop"],
              ["phone", "Phone"],
            ]}
            onChange={setDevice}
          />
          {daily && (
            <Toggle
              value={view}
              options={[
                ["popup", "Popup"],
                ["page", "Page"],
              ]}
              onChange={setView}
            />
          )}
          <Toggle
            value={entered ? "in" : "out"}
            options={[
              ["out", "Sign-up"],
              ["in", "Entered"],
            ]}
            onChange={(v) => setEntered(v === "in")}
          />
        </s-stack>
        {view === "page" && device === "desktop" && (
          <Select
            label="Theme block layout"
            value={layout}
            options={[
              { value: "three", label: "Three columns, full width" },
              { value: "wide", label: "Two columns" },
              { value: "narrow", label: "One column" },
            ]}
            onChange={setLayout}
          />
        )}
        <div
          ref={box}
          style={{
            width: "100%",
            height: frameHeight * scale,
            overflow: "hidden",
            border: "1px solid #e3e3e3",
            borderRadius: 8,
            background: "#fff",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <iframe
            ref={frame}
            key={html}
            title="Giveaway preview"
            sandbox="allow-scripts"
            srcDoc={html}
            style={{
              flex: "none",
              width: size.width,
              height: frameHeight,
              border: 0,
              transform: `scale(${scale})`,
              transformOrigin: "top center",
            }}
          />
        </div>
        <s-text color="subdued">
          Shows unsaved changes. Buttons and links don&apos;t do anything here,
          and your theme&apos;s fonts and colors may differ slightly on the
          store.
        </s-text>
      </s-stack>
    </s-section>
  );
}
