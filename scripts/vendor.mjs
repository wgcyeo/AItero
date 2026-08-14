import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KATEX_DIST = resolve(ROOT, "node_modules", "katex", "dist");
const TARGET = resolve(ROOT, "src", "vendor", "katex");

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });
await cp(resolve(KATEX_DIST, "katex.min.js"), resolve(TARGET, "katex.min.js"));
await cp(resolve(KATEX_DIST, "katex.min.css"), resolve(TARGET, "katex.min.css"));
await cp(resolve(KATEX_DIST, "fonts"), resolve(TARGET, "fonts"), { recursive: true });
await cp(resolve(ROOT, "node_modules", "katex", "LICENSE"), resolve(TARGET, "LICENSE"));
