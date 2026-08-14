import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = resolve(ROOT, "src");
const DIST_DIR = resolve(ROOT, "dist");
const DOS_DATE = (1 << 5) | 1; // 1980-01-01, the earliest ZIP timestamp
const DOS_TIME = 0;
const FILE_MODE = 0o100644;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function collectFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));

  const files = [];
  for (const entry of entries) {
    const diskPath = resolve(directory, entry.name);
    const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(diskPath, archivePath));
    }
    else if (entry.isFile()) {
      files.push({ archivePath, diskPath });
    }
    else {
      throw new Error(`Refusing to package non-regular entry: ${archivePath}`);
    }
  }
  return files;
}

function makeLocalHeader(name, crc, size) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8 names, no data descriptor
  header.writeUInt16LE(0, 8); // STORE avoids compressor-version variance
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function makeCentralHeader(name, crc, size, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4); // UNIX, ZIP 2.0
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((FILE_MODE * 0x10000) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function makeEndRecord(entryCount, centralSize, centralOffset) {
  if (entryCount > 0xffff) {
    throw new Error("ZIP64 is not supported");
  }
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

async function buildArchive(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.archivePath, "utf8");
    const content = await readFile(file.diskPath);
    const crc = crc32(content);
    const localHeader = makeLocalHeader(name, crc, content.length);

    localParts.push(localHeader, name, content);
    centralParts.push(
      makeCentralHeader(name, crc, content.length, offset),
      name,
    );
    offset += localHeader.length + name.length + content.length;
  }

  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    makeEndRecord(files.length, central.length, offset),
  ]);
}

async function main() {
  const packageMetadata = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
  const version = packageMetadata.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("package.json must contain a semantic x.y.z version");
  }

  const source = await stat(SOURCE_DIR).catch(() => null);
  if (!source?.isDirectory()) {
    throw new Error(`Source directory does not exist: ${relative(ROOT, SOURCE_DIR)}`);
  }

  const files = await collectFiles(SOURCE_DIR);
  files.sort((a, b) => Buffer.compare(
    Buffer.from(a.archivePath),
    Buffer.from(b.archivePath),
  ));
  if (files.length === 0) {
    throw new Error("Source directory contains no files");
  }

  const manifestFile = files.find((file) => file.archivePath === "manifest.json");
  if (!manifestFile) {
    throw new Error("Source directory does not contain manifest.json");
  }
  const manifest = JSON.parse(await readFile(manifestFile.diskPath, "utf8"));
  if (manifest.version !== version) {
    throw new Error(`Version mismatch: package.json=${version}, manifest.json=${manifest.version}`);
  }

  const archive = await buildArchive(files);
  const digest = createHash("sha256").update(archive).digest("hex");
  const xpiName = `aitero-assistant-${version}.xpi`;
  const xpiPath = resolve(DIST_DIR, xpiName);
  const checksumPath = `${xpiPath}.sha256`;

  await mkdir(DIST_DIR, { recursive: true });
  await rm(xpiPath, { force: true });
  await rm(checksumPath, { force: true });
  await writeFile(xpiPath, archive, { mode: 0o644 });
  await chmod(xpiPath, 0o644);
  await writeFile(checksumPath, `${digest}  ${xpiName}\n`, { mode: 0o644 });
  await chmod(checksumPath, 0o644);

  process.stdout.write(`${relative(ROOT, xpiPath).split(sep).join("/")}\n`);
  process.stdout.write(`${relative(ROOT, checksumPath).split(sep).join("/")}\n`);
}

await main();
