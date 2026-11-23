# Cardbit Vault Market History

The signed shopper and wallet routes read a rolling 90 days of TCGplayer Market for the collector’s held printings. The signed preview resolves its designated account and condition before matching cards. The wallet uses its existing ownership query. Current Holdings values the same quantities on each comparable date. Vault Balance tracks dated ownership valuations.

The default connection uses the existing Card Broker Site API to match the product ID, game and printing, then reads the daily chart from Card Broker Market over HTTPS. The catalog credential goes only to the configured Site API. The chart request contains just the catalog card ID. Cardbit caches printing history for one hour. Missing and ambiguous records are omitted. The optional server-side Market database connection uses the same Card and PricePoint records and requires a read-only role. Both paths honor the Cardbit market-display setting.

Pool tiers and targets use Poke-Collect retail, which includes the Japanese language markup. The retail-based Cardbits offer uses that price directly. With the market-based policy, Cardbit applies the 20% Japanese markup to market before applying the offer rate. At $20 market and $24 retail, the default 80% offer is 1,920 Cardbits. The dollar chart always displays the raw market benchmark.

Run the six workspace tests named market-chart, vault-market, shopper-market-route, model, sources and portfolio with Vitest. To verify a deployment, open the signed shopper vault in the unpublished Cardbit theme, select 90D, and inspect the priced-day count and chart data.
