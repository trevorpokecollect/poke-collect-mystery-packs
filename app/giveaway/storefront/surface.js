(function () {
  const root = document.querySelector("[data-cardbit-daily]");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  const find = (s) => root.querySelector(s),
    escape = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const endpoint = "/apps/packs/api/giveaway",
    path = "/apps/packs/giveaways",
    q = new URLSearchParams(location.search);
  const sources = {
    whatnot: ["Whatnot", "https://whatnot.com/invite/pokecollectcards", 100],
    facebook: [
      "Facebook",
      "https://www.facebook.com/profile.php?id=61596993114628",
      50,
    ],
    instagram: ["Instagram", "https://www.instagram.com/cardbitshop/", 50],
  };
  const states =
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VA VT WA WV WI WY".split(
      " ",
    );
  const labels = {
    daily: "Free daily entry",
    whatnot: "Whatnot",
    facebook: "Facebook",
    instagram: "Instagram",
    purchase: "Cardbit purchases",
    referral: "Qualified referrals",
    share: "Today's share",
    adjust: "Owner adjustment",
    "free-entry": "Free bonus entries",
  };
  let state,
    busy = false,
    refreshing = false,
    dayInFlight = "",
    notice = find("[data-message]");
  const param = q.get("ref");
  try {
    if (param && /^[a-f\d-]{36}$/i.test(param))
      sessionStorage.setItem("cbGiveawayRef", param);
  } catch {
    // Private browsing can disable session storage. The current link still carries the referral.
  }
  function ref() {
    try {
      return param || sessionStorage.getItem("cbGiveawayRef") || "";
    } catch {
      return param || "";
    }
  }
  function act(text, id, main = false) {
    return (
      '<button type="button" class="cbg-btn ' +
      (main ? "primary" : "") +
      '" data-act="' +
      id +
      '">' +
      text +
      "</button>"
    );
  }
  function link(text, url, id, extra = "") {
    return (
      '<a class="cbg-btn ' +
      extra +
      '" href="' +
      escape(url) +
      '" ' +
      (id ? 'data-link="' + id + '" target="_blank" rel="noopener"' : "") +
      ">" +
      text +
      "</a>"
    );
  }
  const row = (title, detail, action) =>
    '<div class="cbg-row"><div><b>' +
    escape(title) +
    "</b><small>" +
    escape(detail) +
    "</small></div>" +
    action +
    "</div>";
  const done = '<span class="cbg-complete">Completed</span>';
  async function call(body) {
    const r = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const v = await r.json().catch(() => ({}));
    if (!r.ok || v.error)
      throw Error(v.error || "Couldn’t load the giveaway. Try again.");
    return v;
  }
  function countdown() {
    if (!state) return;
    const delta = Date.parse(state.closesAt) - Date.now();
    if (delta <= 0) {
      find("[data-count]").textContent = "Drawing closes";
      if (!refreshing && !busy && dayInFlight !== state.day) {
        dayInFlight = state.day;
        load();
      }
      return;
    }
    const n = Math.floor(delta / 60000);
    find("[data-count]").textContent =
      Math.floor(n / 60) + "h " + (n % 60) + "m";
  }
  function render(s) {
    state = s;
    root.setAttribute("aria-busy", "false");
    find("[data-day]").textContent = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      weekday: "short",
    }).format(new Date(s.closesAt));
    countdown();
    const rules = find("[data-rules]");
    rules.hidden = !s.rulesUrl;
    if (s.rulesUrl) rules.href = s.rulesUrl;
    find("[data-free]").textContent = s.freeInstructions || "";
    find("[data-total]").textContent = s.entered
      ? s.total.toLocaleString() + " entries"
      : "";
    const entry = find("[data-entry]"),
      login =
        "/account/login?return_url=" +
        encodeURIComponent(
          path + (ref() ? "?ref=" + encodeURIComponent(ref()) : ""),
        );
    if (!s.enabled) entry.innerHTML = "<p>Entries are currently closed.</p>";
    else if (!s.signedIn)
      entry.innerHTML =
        "<p>Sign in to your Cardbit account to enter the daily draw.</p>" +
        link("Sign in", login, "", "primary");
    else if (!s.subscribed)
      entry.innerHTML =
        "<p>Enable email marketing on your Cardbit account, then check your eligibility here.</p>" +
        link("Email signup", "/?cb=welcome", "") +
        " " +
        act("Check subscription", "refresh", true);
    else if (s.held)
      entry.innerHTML = "<p>Your giveaway account is under review.</p>";
    else if (!s.whatnotDone)
      entry.innerHTML =
        '<p>Visit Whatnot once to unlock this and future draws. Your first entry includes the 100-entry bonus.</p><label>State of residence<select data-region><option value="">Choose a state or DC</option>' +
        states.map((x) => "<option>" + x + "</option>").join("") +
        '</select></label><label><input type="checkbox" data-adult> I’m 18 or older and live in the state selected above.</label>' +
        link("Visit Whatnot ↗", sources.whatnot[1], "whatnot", "primary");
    else if (!s.entered)
      entry.innerHTML =
        "<p>Your Whatnot visit is saved. Enter once for the draw that closes at 8 p.m. Central.</p>" +
        act("Join Today's Giveaway", "enter", true);
    else
      entry.innerHTML =
        '<p class="cbg-complete">You’re entered for today.</p><p>Come back after the draw to enter again.</p>';
    find("[data-bonuses]").hidden = !(
      s.enabled &&
      s.entered &&
      s.subscribed &&
      !s.held
    );
    const url = new URL(path, "https://cardbit.com");
    if (s.refCode) url.searchParams.set("ref", s.refCode);
    find("[data-tasks]").innerHTML =
      ["facebook", "instagram"]
        .map((k) =>
          row(
            sources[k][0],
            "+" + sources[k][2] + " entries · Once per account",
            s.claimed.includes(k) ? done : link("Visit ↗", sources[k][1], k),
          ),
        )
        .join("") +
      row(
        "Share the giveaway",
        "+" + s.shareEntries + " entries · Once per draw",
        s.byKind.share ? done : act("Share", "share"),
      ) +
      row(
        "Refer a friend",
        "+" +
          s.referralEntries +
          " entries when a new referral makes a purchase",
        act("Get link", "referral"),
      ) +
      row(
        "Buy Cardbits",
        "1 entry per 100 purchased Cardbits",
        link("View top-ups", "/?cb=cardbits", ""),
      ) +
      '<div data-refbox hidden><label>Your referral link<input class="cbg-link-input" readonly value="' +
      escape(url.href) +
      '"></label>' +
      act("Copy link", "copy") +
      "</div><div data-sharebox hidden></div>";
    find("[data-breakdown]").innerHTML = Object.entries(s.byKind).length
      ? Object.entries(s.byKind)
          .map(([k, n]) =>
            row(
              labels[k] || k,
              "",
              '<strong class="cbg-value">' +
                Number(n).toLocaleString() +
                "</strong>",
            ),
          )
          .join("") +
        (s.entered
          ? ""
          : "<p>Enter today to count these entries in the draw.</p>")
      : "<p>No entries in this draw yet.</p>";
    find("[data-winners]").innerHTML = s.winners.length
      ? s.winners
          .map((w) =>
            row(
              w.day,
              w.yours ? "You won" : "Prize awarded",
              '<b class="cbg-value">10,000</b>',
            ),
          )
          .join("")
      : "<p>Completed draws will appear here.</p>";
  }
  async function load() {
    refreshing = true;
    try {
      render(await call());
    } catch (e) {
      find("[data-entry]").innerHTML = act("Retry", "refresh");
      notice.textContent = e.message;
    } finally {
      refreshing = false;
    }
  }
  async function mutate(body) {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    notice.textContent = "";
    try {
      render(await call(body));
    } catch (e) {
      notice.textContent = e.message;
    } finally {
      busy = false;
      root.setAttribute("aria-busy", "false");
    }
  }
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act],[data-link]");
    if (!el) return;
    const id = el.dataset.act || el.dataset.link;
    if (busy) {
      e.preventDefault();
      return;
    }
    if (id === "refresh") {
      await load();
      return;
    }
    if (id === "whatnot") {
      const adult = find("[data-adult]").checked,
        region = find("[data-region]").value;
      if (!adult || !region) {
        e.preventDefault();
        notice.textContent =
          "Select your state and confirm you are 18 or older.";
        return;
      }
      await mutate({ intent: "whatnot", adult, region, ref: ref() });
      return;
    }
    if (el.dataset.link) {
      await mutate({ intent: "social", network: id });
      return;
    }
    if (id === "enter") {
      await mutate({ intent: "enter", expectedDay: state.day });
      return;
    }
    const address =
      find("[data-refbox] input")?.value || "https://cardbit.com" + path;
    if (id === "referral") {
      find("[data-refbox]").hidden = false;
      find("[data-refbox] input").select();
      return;
    }
    if (id === "copy") {
      try {
        await navigator.clipboard.writeText(address);
        notice.textContent = "Referral link copied.";
      } catch {
        find("[data-refbox] input").select();
        notice.textContent = "Select and copy your referral link.";
      }
      return;
    }
    if (id === "share") {
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Cardbit daily giveaway",
            url: address,
          });
          await mutate({ intent: "share" });
        } catch (err) {
          if (err.name !== "AbortError")
            notice.textContent = "Sharing is unavailable. Try again.";
        }
      } else {
        const box = find("[data-sharebox]");
        box.hidden = false;
        box.innerHTML =
          '<p>Send the giveaway link using your email app, then confirm the share.</p><a class="cbg-btn" href="mailto:?subject=Cardbit%20daily%20giveaway&amp;body=' +
          encodeURIComponent(address) +
          '" data-email-share>Share by email</a> <span data-shared></span>';
        box
          .querySelector("[data-email-share]")
          .addEventListener("click", () => {
            box.querySelector("[data-shared]").innerHTML = act(
              "I shared the link",
              "shared",
            );
          });
      }
      return;
    }
    if (id === "shared") await mutate({ intent: "share" });
  });
  load();
  const timer = setInterval(() => {
    if (!root.isConnected) clearInterval(timer);
    else countdown();
  }, 30000);
})();
