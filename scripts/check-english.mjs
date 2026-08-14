import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SKIPPED_DIRECTORIES = new Set([".git", "dist", "node_modules"]);
const BINARY_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".ttf",
  ".woff",
  ".woff2",
  ".xpi",
  ".zip",
]);
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (entry.isFile() && !BINARY_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const path of await collect(ROOT)) {
  if ((await stat(path)).size > 2_000_000) continue;
  const lines = (await readFile(path, "utf8")).split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (HANGUL.test(line)) {
      violations.push(`${relative(ROOT, path)}:${index + 1}`);
    }
  });
}

if (violations.length) {
  process.stderr.write("Hangul text is not allowed in this English-only repository:\n");
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
}
else {
  process.stdout.write("English-only content check passed.\n");
}
