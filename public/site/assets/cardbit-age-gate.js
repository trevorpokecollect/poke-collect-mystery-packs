/* One-time 18+ confirmation for signed-in Cardbit customers.
   The Mystery Packs app stores it and requires it before a pack is bought with
   Cardbits. A confirmation ticked on the Sign Up tab is saved automatically.
   If the app endpoint is unavailable, the page is left as it is. */
(() => {
  const dialog = document.getElementById('cbx-age');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const endpoint = dialog.dataset.ageEndpoint;
  const form = dialog.querySelector('form');
  const box = form.elements.age;
  const error = dialog.querySelector('#cbx-age-error');
  const submit = dialog.querySelector('[data-cbx-age-submit]');
  const FLAG = 'cardbit:age-confirmed';

  function signupFlag() {
    try { return sessionStorage.getItem(FLAG); } catch (_) { return null; }
  }
  function clearFlag() {
    try { sessionStorage.removeItem(FLAG); } catch (_) {}
  }
  async function save(source) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ confirm: true, source }),
    });
    if (!response.ok) throw new Error('save failed');
    clearFlag();
    document.dispatchEvent(new CustomEvent('cardbit:age-confirmed'));
  }
  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  // Customers must confirm (or sign out); Escape does not dismiss the gate.
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  box.addEventListener('change', () => { if (box.checked) error.hidden = true; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!box.checked) { showError("Confirm You're 18 or Older to Continue."); box.focus(); return; }
    submit.setAttribute('aria-busy', 'true');
    try {
      await save('prompt');
      dialog.close();
    } catch (_) {
      showError("We Couldn't Save That. Try Again.");
    } finally {
      submit.removeAttribute('aria-busy');
    }
  });

  (async () => {
    let status;
    try {
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (!response.ok) return;
      status = await response.json();
    } catch (_) { return; }
    if (status && status.confirmed) { clearFlag(); return; }
    if (signupFlag()) {
      try { await save('signup'); return; } catch (_) { /* fall through to the prompt */ }
    }
    dialog.showModal();
    box.focus();
  })();
})();
