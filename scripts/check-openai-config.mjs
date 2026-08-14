import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

globalThis.AIteroPDF = {};
globalThis.AIteroCompat = {};
globalThis.AIteroOpenAI = {};

const require = createRequire(import.meta.url);
const assistant = require("../src/content/assistant.js");
const { parseStaticShellAssignment } = assistant._test;

if (String(process.env.OPENAI_API_KEY ?? "").trim()) {
  process.stdout.write("OPENAI_API_KEY is available in the current environment.\n");
  process.exit(0);
}

for (const name of [".zshrc", ".bashrc"]) {
  const path = resolve(homedir(), name);
  let source;
  try {
    source = await readFile(path, "utf8");
  }
  catch (_error) {
    continue;
  }
  if (parseStaticShellAssignment(source, "OPENAI_API_KEY")) {
    process.stdout.write(`OPENAI_API_KEY was detected as a safe literal in ~/${name}.\n`);
    process.exit(0);
  }
}

process.stderr.write(
  "OPENAI_API_KEY was not found in the environment, ~/.zshrc, or ~/.bashrc.\n",
);
process.exitCode = 1;
