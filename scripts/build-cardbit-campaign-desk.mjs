// Builds the browser-only campaign editor used by Card Broker. The route handlers stay in Mystery Packs.
import esbuild from "esbuild";
import ts from "typescript";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)),
  root = path.resolve(here, ".."),
  legacy = path.join(root, "app/giveaway/legacy/app/routes"),
  bridge = path.join(here, "giveaway-desk/bridge.js");
const pages = [
  ["/staff/cardbit-campaigns", "app._index"],
  ["/staff/cardbit-campaigns/campaigns/new", "app.campaigns.new"],
  ["/staff/cardbit-campaigns/campaigns/:id", "app.campaigns.$id"],
  ["/staff/cardbit-campaigns/campaigns/:id/edit", "app.campaigns.$id_.edit"],
  [
    "/staff/cardbit-campaigns/campaigns/:id/analytics",
    "app.campaigns.$id_.analytics",
  ],
  [
    "/staff/cardbit-campaigns/campaigns/:id/import",
    "app.campaigns.$id_.import",
  ],
  [
    "/staff/cardbit-campaigns/campaigns/:id/entrants/:entrantId",
    "app.campaigns.$id_.entrants.$entrantId",
  ],
];
const entry =
  'import React from "react"; import {createRoot} from "react-dom/client"; import {createBrowserRouter,RouterProvider,useRouteError} from "react-router"; import {load} from ' +
  JSON.stringify(bridge) +
  ";" +
  pages
    .map(
      (p, i) =>
        "import Page" +
        i +
        " from " +
        JSON.stringify(path.join(legacy, p[1] + ".tsx")) +
        ";",
    )
    .join("\n") +
  'function ErrorBox(){const e=useRouteError();return <main role="alert"><h2>Campaign unavailable</h2><p>{e?.message||"Try again shortly."}</p><a href="/staff/cardbit-campaigns">Back to campaigns</a></main>}const router=createBrowserRouter([' +
  pages
    .map(
      (p, i) =>
        "{path:" +
        JSON.stringify(p[0]) +
        ",Component:Page" +
        i +
        ",loader:load,action:load,ErrorBoundary:ErrorBox}",
    )
    .join(",") +
  ']);createRoot(document.getElementById("campaign-root")).render(<RouterProvider router={router}/>);';
const seen = new Set();
await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  jsx: "automatic",
  bundle: true,
  platform: "browser",
  target: "es2022",
  banner: { js: "/* eslint-env browser, es2022 */" },
  minify: true,
  legalComments: "eof",
  outfile: process.argv[2] || path.join(root, "public/cardbit-campaigns.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "browser-only-campaigns",
      setup(b) {
        b.onResolve(
          { filter: /^@shopify\/app-bridge-react$|\/lib\/download$/ },
          () => ({ path: bridge }),
        );
        b.onResolve({ filter: /\?raw$/ }, (a) => ({
          path: path.resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: "raw",
        }));
        b.onLoad({ filter: /.*/, namespace: "raw" }, async (a) => ({
          contents: await fs.readFile(a.path, "utf8"),
          loader: "text",
        }));
        b.onLoad(
          { filter: /legacy\/app\/routes\/app\..*\.tsx$/ },
          async (a) => {
            const raw = await fs.readFile(a.path, "utf8"),
              src = ts.createSourceFile(
                a.path,
                raw,
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX,
              );
            const remaining = src.statements.filter((n) => {
              if (ts.isImportDeclaration(n)) {
                const id = n.moduleSpecifier.text;
                if (
                  id.includes(".server") ||
                  id.includes("/db.server") ||
                  id.includes("shopify-app-react-router/server")
                )
                  return false;
              }
              if (
                ts.isVariableStatement(n) &&
                n.declarationList.declarations.some((d) =>
                  ["loader", "action", "headers"].includes(d.name.getText(src)),
                )
              )
                return false;
              return true;
            });
            seen.add(a.path);
            return {
              contents: remaining.map((n) => n.getFullText(src)).join("\n"),
              loader: "tsx",
              resolveDir: path.dirname(a.path),
            };
          },
        );
      },
    },
  ],
});
if (seen.size !== pages.length)
  throw Error("Campaign page bundle is incomplete.");
