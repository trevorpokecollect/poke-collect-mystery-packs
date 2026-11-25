import { Links, Meta, Outlet, Scripts, ScrollRestoration, type MiddlewareFunction } from "react-router";
import { canonicalRedirect } from "./site/canonical.server";

export const middleware: MiddlewareFunction<Response>[] = [
  async ({ request }, next) => canonicalRedirect(request) ?? next(),
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
