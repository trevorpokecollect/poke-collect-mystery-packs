  /* SITE: one-time 18+ confirmation before a Daily Spin (the server stores it, like Shopify's age gate). */
  function siteConfirmAge() {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'cbr-age';
      d.innerHTML = '<form method="dialog"><h2>Confirm Your Age</h2><p>Cardbit Is for Collectors 18 or Older.</p>' +
        '<label><input type="checkbox" name="age" required> I\'m 18 or Older</label>' +
        '<p class="cbr-age-error" role="alert"></p><div class="cbr-age-actions"><button type="button" class="cb-secondary" value="cancel">Cancel</button>' +
        '<button type="submit" class="cb-primary" value="ok">Continue</button></div></form>';
      root.append(d);
      const done = (ok) => { d.close(); d.remove(); resolve(ok); };
      d.querySelector('[value=cancel]').addEventListener('click', () => done(false));
      d.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
      d.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await call({ action: 'confirm-age' }); done(true); }
        catch (err) { d.querySelector('.cbr-age-error').textContent = err.message || 'Try Again.'; }
      });
      d.showModal();
    });
  }

