// Хост едет на машину одним бандлом, поэтому исходники движков нельзя читать
// с диска плагина: они встраиваются в TypeScript и разворачиваются в dataDir.
// Запускается из npm run embed и перед сборкой.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = [
  { key: "voiced.py", path: join(root, "python", "voiced.py") },
  { key: "engines.py", path: join(root, "python", "engines.py") },
  { key: "download.py", path: join(root, "python", "download.py") },
];

const parts = await Promise.all(
  assets.map(async ({ key, path }) => {
    const source = await readFile(path, "utf8");
    return `  ${JSON.stringify(key)}: ${JSON.stringify(source)},`;
  }),
);

await writeFile(
  join(root, "src", "embedded-assets.generated.ts"),
  `// Сгенерировано scripts/embed-assets.mjs — не редактировать вручную.
// Источники: python/*.py, swift/*.swift
export const EMBEDDED_ASSETS: Record<string, string> = {
${parts.join("\n")}
};
`,
);
console.log(`embedded ${assets.length} assets`);
