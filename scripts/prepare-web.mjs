import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "www");
const source = resolve(root, "index.html");
const destination = resolve(output, "index.html");
const apiOrigin = "https://hk-ai.pages.dev";

mkdirSync(output, { recursive: true });

let html = readFileSync(source, "utf8");

// The website uses same-origin /api routes. A packaged native WebView has a
// local origin, so point its API requests at the existing Cloudflare Pages backend.
html = html.replace(/(["'])\/api\//g, `$1${apiOrigin}/api/`);

writeFileSync(destination, html, "utf8");
console.log("Prepared HK.AI web assets in www/");
