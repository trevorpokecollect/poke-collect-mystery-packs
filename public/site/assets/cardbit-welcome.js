/* Loaded by the Cardbit draft only. Contact details and confirmations here are fixtures. */
(() => {
  'use strict';
  const script = document.querySelector('script[data-cardbit-welcome]');
  if (!script) return;
  const isSample = script.hasAttribute('data-sample-wallet');
  const databaseName = 'cardbit-welcome-preview-v1-' + script.dataset.owner;
  const methods = {
    email: {
      name: 'Email Newsletter', amount: 200,
      field: 'Email Address', type: 'email', join: 'Join Newsletter', confirm: 'Confirm Email Preference',
      description: 'New Editions and Featured Singles in Your Inbox.',
      consent: 'Email Me Cardbit News and Offers.', ledger: 'Newsletter Signup'
    },
    sms: {
      name: 'Text Alerts', amount: 300,
      field: 'Mobile Number', type: 'tel', join: 'Join Text Alerts', confirm: 'Confirm Text Preference',
      description: 'Get a Text When a New Pack Drops.',
      consent: 'I Agree to Recurring Automated Marketing Texts from Cardbit.', ledger: 'Text Signup'
    }
  };
  const channels = Object.keys(methods);
  const maxReward = channels.reduce((sum, key) => sum + methods[key].amount, 0);
  const termsVersion = 'welcome-preview-1';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const receipt = (records, key) => records?.[key] || {};
  const earned = records => channels.reduce((sum, key) =>
    sum + (receipt(records, key).awardedAt ? methods[key].amount : 0), 0);
  const badge = amount => '<span class="cbw-amount">+' + amount + ' <span>Cardbits</span></span>';
  function status(records, key) {
    const channel = receipt(records, key);
    if (channel.status === 'pending') return 'Awaiting Confirmation';
    if (channel.status === 'subscribed') return 'Preference Saved';
    if (channel.status === 'unsubscribed') return 'Turned Off';
    return 'Available to Earn';
  }
  function coin() {
    return window.cardbitValueIcon ? '<img class="cbw-coin" src="' + escape(window.cardbitValueIcon) +
      '" alt="" width="72" height="72" decoding="async">' : '';
  }
  function sampleLink(route, text, style = 'cb-secondary') {
    const url = new URL(script.dataset.entry, location.origin);
    url.searchParams.set('cb', route);
    return '<a class="' + style + '" href="' + escape(url.href) + '"' +
      (isSample ? ' data-cb-route="' + escape(route) + '"' : '') + '>' + text + '</a>';
  }
  function teaser(placement) {
    return '<cardbit-welcome-summary data-placement="' + placement + '"></cardbit-welcome-summary>';
  }
  // Both the storefront summary and the offer read the same sample wallet.
  async function readRewards() {
    if (!window.indexedDB) {
      const saved = JSON.parse(localStorage.getItem(databaseName) || 'null');
      return saved?.accounts?.collector?.welcome || {};
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('store');
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Your wallet is busy. Please try again.'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('store', 'readonly');
        const read = tx.objectStore('store').get('state');
        tx.oncomplete = () => { db.close(); resolve(read.result?.accounts?.collector?.welcome || {}); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }
  class WelcomeSummary extends HTMLElement {
    connectedCallback() {
      this.paint(null);
      this.update = () => readRewards().then(records => {
        const statusKey = JSON.stringify(channels.map(key => [receipt(records,key).status, Boolean(receipt(records,key).awardedAt)]));
        if (this.isConnected && this.statusKey !== statusKey) {
          this.statusKey = statusKey;
          this.paint(records);
        }
      }).catch(() => {});
      this.update();
      window.addEventListener('focus', this.update);
    }
    disconnectedCallback() { window.removeEventListener('focus', this.update); }
    paint(records) {
      const account = this.dataset.placement === 'account';
      const total = earned(records);
      const started = channels.some(key => Boolean(receipt(records,key).status));
      const title = account || started ? 'Welcome Rewards' : 'Get Up to ' + maxReward + ' Free Cardbits';
      const positions = channels.map(key => {
        const method = methods[key];
        const detail = account && records ? status(records, key) + (receipt(records, key).awardedAt ? ' · Reward Earned' : '') : '';
        return '<li><strong>' + method.amount + '</strong><span>' + method.name +
          (detail ? '<small>' + detail + '</small>' : '') + '</span></li>';
      }).join('');
      this.innerHTML = '<section class="cbw-summary cbw-' + (account ? 'account' : 'home') + '">' +
        '<div class="cbw-summary-title">' + coin() + '<div><h2>' + title + '</h2><p>' +
        (account || started ? (records ? total + ' of ' + maxReward + ' Cardbits Earned.' : 'See Your Signup Rewards.') :
          'Choose Email, Texts, or Both. Earn Cardbits When You Confirm.') + '</p></div></div>' +
        '<ul class="cbw-split">' + positions + '</ul>' + sampleLink('welcome', account || started ? 'View Rewards' : 'Get Started', 'cb-primary') + '</section>';
    }
  }
  function details(key) {
    const policies = '<a href="' + escape(script.dataset.policies) + '" target="_blank" rel="noopener">Terms and Privacy</a>';
    return key === 'sms' ? '<p class="cbw-legal" id="cbw-sms-terms">Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is optional for purchase. ' + policies + '.</p>' : '';
  }
  function methodCard(key, records) {
    const m = methods[key], current = receipt(records, key);
    const pending = current.status === 'pending', subscribed = current.status === 'subscribed';
    const btn = (action, text, style) => '<button type="button" class="' + style + '" data-cbw-action="' + action + '">' + text + '</button>';
    let controls;
    if (pending) {
      controls = '<div class="cbw-pending"><b>Confirm Your Preference</b><p>This Preference Is Saved on This Device.</p></div>' +
        '<div class="cbw-controls">' + btn('confirm', m.confirm, 'cb-primary') +
        btn('unsubscribe', 'Cancel Request', 'cbw-quiet') + '</div>';
    } else if (subscribed) {
      controls = '<div class="cbw-confirmed"><b>Reward Earned</b><p>' + m.amount + ' Cardbits Added to Your Wallet.</p></div>' +
        btn('unsubscribe', key === 'email' ? 'Turn Off Email' : 'Turn Off Texts', 'cbw-quiet');
    } else {
      controls = '<form data-cbw-form><label class="cbw-field">' + m.field +
        '<input type="' + m.type + '" autocomplete="' + m.type + '" data-cbw-contact required></label>' +
        '<label class="cbw-consent"><input type="checkbox" required' + (key === 'sms' ? ' aria-describedby="cbw-sms-terms"' : '') +
        '><span>' + m.consent + '</span></label>' + details(key) +
        (current.awardedAt ? '<p class="cbw-kept">Reward Already Earned. You Can Rejoin at Any Time.</p>' : '') +
        '<button class="cb-secondary" type="submit">' + (current.awardedAt ? 'Subscribe Again' : m.join) + '</button></form>';
    }
    return '<section class="cbw-method" data-cbw-channel="' + key + '" aria-labelledby="cbw-' + key + '-name">' +
      '<div class="cbw-method-head"><h2 id="cbw-' + key + '-name" tabindex="-1">' + m.name + '</h2>' + badge(m.amount) +
      '</div><p class="cbw-desc">' + m.description + '</p>' + controls + '</section>';
  }
  function page(state) {
    if (!isSample || !state?.account || state.storageUnavailable) {
      return '<div class="cb-wrap cb-page cbw-page"><h1>Welcome Rewards</h1><p>Enable Browser Storage and Reload to View Your Rewards.</p></div>';
    }
    const records = state.welcome, total = earned(records);
    const policies = escape(script.dataset.policies);
    return '<div class="cb-wrap cb-page cbw-page" data-cbw-panel><header class="cbw-intro"><div>' +
      '<h1>Get Up to <span>' + maxReward + '</span> Free Cardbits</h1><p>Choose How You Hear About New Packs and Singles. Confirm Each Signup to Earn Its Reward.</p></div>' +
      '<div class="cbw-total">' + coin() + '<div><b>' + total + ' <span>/ ' + maxReward + '</span></b><small>Cardbits Earned</small></div></div></header>' +
      '<div class="cbw-methods">' + channels.map(key => methodCard(key, records)).join('') + '</div>' +
      '<p class="cbw-feedback" role="status" aria-live="polite" tabindex="-1"></p>' +
      '<div class="cbw-after"><p>One Reward per Channel. No Purchase Required. You Keep Earned Cardbits If You Unsubscribe. ' +
      '<a href="' + policies + '" target="_blank" rel="noopener">Cardbit Policies</a>.</p>' +
      (total ? '<div class="cbw-controls">' + sampleLink('cardbits','View My Wallet') + sampleLink('shop','Shop Singles','cb-primary') + '</div>' : '') +
      '</div></div>';
  }
  // This function is reachable only from the isolated device wallet transaction.
  // The caller records any credit and the receipt in the very same transaction.
  function change(account, action, key, at) {
    if (!isSample || !Object.hasOwn(methods, key)) throw Error('Choose an available signup channel.');
    const method = methods[key];
    const records = account.welcome ||= {};
    const current = records[key] ||= {};
    if (action === 'welcome-request') {
      if (current.status !== 'subscribed' && current.status !== 'pending') {
        Object.assign(current, {status:'pending', requestedAt:at, termsVersion});
      }
    } else if (action === 'welcome-unsubscribe') {
      if (current.status !== 'unsubscribed') Object.assign(current, {status:'unsubscribed', withdrawnAt:at});
    } else if (action === 'welcome-confirm') {
      if (current.status === 'subscribed') return 0;
      if (current.status !== 'pending') throw Error('Request a confirmation for this channel first.');
      Object.assign(current, {status:'subscribed', confirmedAt:at});
      if (!current.awardedAt) { current.awardedAt = at; return method.amount; }
    } else { throw Error('This signup action is unavailable.'); }
    return 0;
  }
  function bind(panel, ctx) {
    async function act(control, action) {
      if (ctx.busy()) return;
      const key = control.closest('[data-cbw-channel]').dataset.cbwChannel;
      const prior = receipt(ctx.state()?.welcome, key);
      const feedback = panel.querySelector('.cbw-feedback');
      ctx.setBusy(true);
      control.disabled = true;
      panel.setAttribute('aria-busy','true');
      feedback.textContent = 'Saving…';
      try {
        const store = window.CardbitStore;
        const result = await store.action({action:'welcome-' + action, id:key, requestId:store.requestKey()});
        ctx.setState(result.state);
        const label = methods[key].name;
        const message = action === 'request' ? 'Confirm Your ' + label + ' Preference.' :
          action === 'unsubscribe' ? (prior.status === 'pending' ? 'Request Canceled.' : 'Preference Turned Off. You Keep Your Earned Cardbits.') :
          prior.awardedAt ? 'Preference Saved. You’ve Already Earned This Reward.' :
          methods[key].amount + ' Cardbits Added to Your Wallet.';
        const wasHere = panel.isConnected;
        ctx.render();
        if (wasHere) {
          const next = ctx.root().querySelector('[data-cbw-panel]');
          const live = next?.querySelector('.cbw-feedback');
          if (live) live.textContent = message;
          next?.querySelector('#cbw-' + key + '-name')?.focus({preventScroll:true});
        }
      } catch (error) {
        feedback.textContent = error?.message || 'The Reward Could Not Be Saved. Try Again.';
        if (panel.isConnected) feedback.focus({preventScroll:true});
      } finally {
        ctx.setBusy(false);
        control.disabled = false;
        panel.removeAttribute('aria-busy');
      }
    }
    panel.addEventListener('submit', event => {
      const form = event.target.closest('[data-cbw-form]');
      if (!form) return;
      event.preventDefault();
      if (!form.reportValidity()) return;
      const key = form.closest('[data-cbw-channel]').dataset.cbwChannel;
      const field = form.querySelector('[data-cbw-contact]');
      // The draft has no sender. Only reserved contacts can exercise its isolated wallet.
      // Never transmit, record or grant a subscription for an actual contact here.
      const input = field.value.trim();
      const reserved = key === 'email'
        ? ['collector@example.com', 'collector@example.test'].includes(input.toLowerCase())
        : /^(?:1)?2025550146$/.test(input.replace(/[^\d]/g, '')) && /^[+\d\s().-]+$/.test(input);
      if (!reserved) {
        const feedback = panel.querySelector('.cbw-feedback');
        feedback.textContent = (key === 'email' ? 'Email Signup' : 'Text Signup') + ' Is Temporarily Unavailable. Please Try Again Later.';
        feedback.focus({preventScroll:true});
        return;
      }
      act(form.querySelector('[type="submit"]'), 'request');
    });
    panel.addEventListener('click', event => {
      const control = event.target.closest('[data-cbw-action]');
      if (control) act(control, control.dataset.cbwAction);
    });
  }
  if (!customElements.get('cardbit-welcome-summary')) customElements.define('cardbit-welcome-summary', WelcomeSummary);
  window.CardbitWelcome = Object.freeze({isSample, databaseName, entry:script.dataset.entry, exit:script.dataset.exit,
    methods, teaser, page, change, bind});
})();
