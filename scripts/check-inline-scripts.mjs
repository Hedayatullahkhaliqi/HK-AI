import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync("index.html", "utf8");
const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
if (blocks.length === 0) throw new Error("No inline scripts found");

for (let i = 0; i < blocks.length; i++) {
  const source = blocks[i][1].trim();
  if (!source) continue;
  new Script(source, { filename: \`index.html:inline-script-\${i + 1}\` });
}
console.log(\`Validated \${blocks.length} inline script block(s).\`);
