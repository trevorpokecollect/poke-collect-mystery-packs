import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

// The app's Railway URL. The app proxy (/apps/packs) isn't reachable from checkout, so call the app directly.
const APP_URL = 'https://app-production-9bd21.up.railway.app';
const POLL_MS = 2000;
const MAX_POLLS = 30;

export default async () => {
  render(<Extension />, document.body);
};

async function fetchLink() {
  const token = await shopify.sessionToken.get();
  const url = new URL(`${APP_URL}/api/pack-link`);
  url.searchParams.set('surface', 'account');
  url.searchParams.set('checkoutToken', shopify.checkoutToken.value ?? '');
  url.searchParams.set('variants', (shopify.lines?.value ?? []).map((line) => line.merchandise?.id).filter(Boolean).join(','));
  const response = await fetch(url.toString(), {headers: {Authorization: `Bearer ${token}`}});
  if (!response.ok) throw new Error(`pack-link ${response.status}`);
  return response.json();
}

function Extension() {
  const [link, setLink] = useState({status: 'loading'});
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer;
    async function poll() {
      polls += 1;
      try {
        const data = await fetchLink();
        if (cancelled) return;
        setLink(data);
        if (data.status !== 'pending') return;
      } catch (error) {
        console.error(error);
      }
      if (cancelled) return;
      if (polls < MAX_POLLS) timer = setTimeout(poll, POLL_MS);
      else setSlow(true);
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Orders without a mystery pack show nothing.
  if (link.status === 'loading' || link.status === 'none') return null;

  const t = shopify.i18n.translate;

  if (link.status === 'pending') {
    return (
      <s-section heading={t('pendingHeading')}>
        <PackLayout image={link.packImageUrl}>
          <s-paragraph>{t(slow ? 'slowBody' : 'pendingBody')}</s-paragraph>
          {slow ? null : <s-spinner accessibilityLabel={t('pendingHeading')} />}
        </PackLayout>
      </s-section>
    );
  }

  const heading = link.packs > 1 ? t('readyHeadingMany', {number: link.packs}) : t('readyHeading', {series: link.series});
  const opened = link.unopened === 0;
  return (
    <s-section heading={heading}>
      <PackLayout image={link.packImageUrl}>
        <s-paragraph>{t(opened ? 'openedBody' : 'readyBody')}</s-paragraph>
        <s-button variant="primary" href={link.url} target="_blank" inlineSize="fill">
          {t(opened ? 'viewPacks' : 'openNow')}
        </s-button>
      </PackLayout>
    </s-section>
  );
}

function PackLayout({image, children}) {
  return (
    <s-grid gridTemplateColumns={image ? '96px 1fr' : '1fr'} gap="base" alignItems="center">
      {image ? <s-image src={image} alt="" aspectRatio="1" objectFit="cover" borderRadius="base" /> : null}
      <s-stack gap="base">{children}</s-stack>
    </s-grid>
  );
}
