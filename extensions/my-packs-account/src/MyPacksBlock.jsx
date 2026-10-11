import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

// The app's Railway URL (customer account pages can't reach the storefront app proxy).
const APP_URL = 'https://app-production-9bd21.up.railway.app';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await shopify.sessionToken.get();
        const response = await fetch(`${APP_URL}/api/my-packs`, {headers: {Authorization: `Bearer ${token}`}});
        if (response.ok) setData(await response.json());
      } catch (error) {
        console.error(error);
      }
    })();
  }, []);

  // Customers who never bought a pack see nothing.
  if (!data || !data.packs) return null;

  const t = shopify.i18n.translate;
  const unopened = data.unopened > 0;
  return (
    <s-section heading={t('heading')}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{unopened ? t('bodyUnopened', {count: data.unopened}) : t('body')}</s-paragraph>
        <s-button variant="primary" href={data.url} target="_blank">
          {t(unopened ? 'openPacks' : 'viewPacks')}
        </s-button>
      </s-stack>
    </s-section>
  );
}
