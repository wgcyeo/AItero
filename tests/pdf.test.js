"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const PDF = require("../src/content/pdf.js");

function page(pageIndex, text, pageLabel) {
  return {
    pageIndex,
    pageLabel: pageLabel || String(pageIndex + 1),
    text,
  };
}

test("worker mapping preserves leading, middle, and trailing blank pages", () => {
  const mapped = PDF.mapWorkerFullText({
    text: "\fmiddle page\f",
    extractedPages: 3,
    totalPages: 3,
  });

  assert.equal(mapped.trusted, true);
  assert.deepEqual(
    mapped.pages.map((record) => [record.pageIndex, record.text]),
    [
      [0, ""],
      [1, "middle page"],
      [2, ""],
    ],
  );
  assert.equal(mapped.coverage.status, "partial");
  assert.deepEqual(mapped.coverage.emptyPageIndexes, [0, 2]);
});

test("worker mapping rejects every conflicting page-count signal", () => {
  const separatorMismatch = PDF.mapWorkerFullText({
    text: "first\fsecond",
    extractedPages: 3,
    totalPages: 3,
  });
  assert.equal(separatorMismatch.trusted, false);
  assert.equal(separatorMismatch.reason, "page-separator-count-mismatch");

  const partialExtraction = PDF.mapWorkerFullText({
    text: "first\fsecond",
    extractedPages: 2,
    totalPages: 3,
  });
  assert.equal(partialExtraction.trusted, false);
  assert.equal(partialExtraction.reason, "partial-worker-extraction");

  const nonIntegerCount = PDF.mapWorkerFullText({
    text: "one",
    extractedPages: 1.5,
    totalPages: 1.5,
  });
  assert.equal(nonIntegerCount.trusted, false);
  assert.equal(nonIntegerCount.reason, "invalid-page-counts");
});

test("reader adapter is used only after unsafe worker mapping", async () => {
  let readerCalls = 0;
  const extracted = await PDF.extractPagesWithFallback({
    workerExtract: async () => ({
      text: "trimmed first page only",
      extractedPages: 2,
      totalPages: 2,
    }),
    readerExtract: async () => {
      readerCalls += 1;
      return {
        totalPages: 2,
        pageLabels: ["iv", "1"],
        pages: [
          { pageIndex: 0, text: "" },
          { pageIndex: 1, text: "body" },
        ],
      };
    },
  });

  assert.equal(readerCalls, 1);
  assert.equal(extracted.ok, true);
  assert.equal(extracted.source, "reader");
  assert.deepEqual(
    extracted.pages.map((record) => [
      record.pageIndex,
      record.pageLabel,
      record.text,
    ]),
    [
      [0, "iv", ""],
      [1, "1", "body"],
    ],
  );
});

test("page chunks stay page-local, overlap by 200 chars, and have stable opaque IDs", () => {
  const pages = [
    page(0, "a".repeat(2500), "i"),
    page(1, "b".repeat(1300), "1"),
    page(2, ""),
  ];
  const first = PDF.chunkPages(pages, { documentKey: "attachment:42" });
  const second = PDF.chunkPages(pages, { documentKey: "attachment:42" });

  assert.deepEqual(
    first.map((chunk) => [chunk.pageIndex, chunk.charStart, chunk.charEnd]),
    [
      [0, 0, 1200],
      [0, 1000, 2200],
      [0, 2000, 2500],
      [1, 0, 1200],
      [1, 1000, 1300],
    ],
  );
  assert.equal(first[0].charEnd - first[1].charStart, 200);
  assert.equal(first[3].charEnd - first[4].charStart, 200);
  assert.ok(first.every((chunk) => /^c_[a-f0-9]{16}$/.test(chunk.id)));
  assert.deepEqual(
    first.map((chunk) => chunk.id),
    second.map((chunk) => chunk.id),
  );
  assert.equal(first.some((chunk) => chunk.pageIndex === 2), false);
});

test("normal BM25 selection ranks local evidence and honors default count/character caps", () => {
  const chunks = [];
  for (let index = 0; index < 20; index += 1) {
    chunks.push({
      id: `c_${index.toString(16).padStart(16, "0")}`,
      pageIndex: index,
      pageLabel: String(index + 1),
      charStart: 0,
      text:
        `${index === 17 ? "quasar quasar quasar" : "ordinary evidence"} ` +
        "quasar ".repeat(600),
    });
  }

  const selected = PDF.selectContext(chunks, "quasar spectroscopy");
  assert.equal(selected.broad, false);
  assert.ok(selected.chunks.length <= PDF.NORMAL_MAX_CHUNKS);
  assert.ok(selected.charCount <= PDF.NORMAL_MAX_CHARS);
  assert.ok(selected.chunks.some((chunk) => chunk.pageIndex === 17));
  assert.ok(selected.chunks.every((chunk) =>
    chunk.selectionReasons.includes("bm25"),
  ));
});

test("broad English queries combine distributed pages with BM25 evidence", () => {
  const pages = Array.from({ length: 30 }, (_, pageIndex) =>
    page(
      pageIndex,
      pageIndex === 13
        ? "rare methodology rare methodology key contribution result limitation"
        : `background material ${pageIndex}`,
    ),
  );
  const chunks = PDF.chunkPages(pages, {
    chunkSize: 200,
    overlap: 20,
    documentKey: "broad-fixture",
  });

  assert.equal(PDF.isBroadQuery("Summarize the methods, results, and limitations"), true);
  assert.equal(PDF.isBroadQuery("Outline the main contributions and findings"), true);

  const selected = PDF.selectContext(
    chunks,
    "Summarize the rare methodology, main contribution, results, and limitations",
  );
  const pageIndexes = selected.chunks.map((chunk) => chunk.pageIndex);

  assert.equal(selected.broad, true);
  assert.ok(selected.chunks.length <= PDF.BROAD_MAX_CHUNKS);
  assert.ok(selected.charCount <= PDF.BROAD_MAX_CHARS);
  assert.ok(pageIndexes.includes(0), "distributed selection includes the start");
  assert.ok(pageIndexes.includes(29), "distributed selection includes the end");
  assert.ok(pageIndexes.includes(13), "BM25 adds the non-sampled relevant page");
  assert.ok(
    selected.chunks.some((chunk) =>
      chunk.selectionReasons.includes("distributed"),
    ),
  );
  assert.ok(
    selected.chunks.some((chunk) => chunk.selectionReasons.includes("bm25")),
  );
});

test("ordinary papers send every page chunk even when the question language differs", () => {
  const pages = Array.from({ length: 8 }, (_, pageIndex) =>
    page(pageIndex, `English paper evidence on page ${pageIndex + 1}.`),
  );
  const chunks = PDF.chunkPages(pages, {
    chunkSize: 200,
    overlap: 20,
    documentKey: "full-paper-fixture",
  });

  const selected = PDF.selectPaperContext(
    chunks,
    "¿Cuál es la contribución principal?",
  );

  assert.equal(selected.mode, "full");
  assert.equal(selected.chunks.length, chunks.length);
  assert.deepEqual(
    selected.chunks.map((chunk) => chunk.id),
    chunks.map((chunk) => chunk.id),
  );
  assert.ok(selected.chunks.every((chunk) =>
    chunk.selectionReasons.includes("full-paper"),
  ));
});

test("oversized cross-language questions fall back to distributed nonempty evidence", () => {
  const pages = Array.from({ length: 30 }, (_, pageIndex) =>
    page(pageIndex, `English-only evidence from page ${pageIndex + 1}.`),
  );
  const chunks = PDF.chunkPages(pages, {
    chunkSize: 200,
    overlap: 20,
    documentKey: "oversized-fixture",
  });

  const selected = PDF.selectPaperContext(
    chunks,
    "¿Por qué es importante este resultado?",
    { fullMaxChars: 1 },
  );

  assert.equal(selected.mode, "retrieval");
  assert.equal(selected.rankedCount, 0);
  assert.ok(selected.chunks.length > 0);
  assert.ok(selected.chunks.every((chunk) =>
    chunk.selectionReasons.includes("distributed-fallback"),
  ));
  assert.equal(selected.chunks[0].pageIndex, 0);
  assert.equal(selected.chunks.at(-1).pageIndex, 29);
});

test("citation parsing links only exact IDs from the selected evidence set", () => {
  const selectedChunks = [
    {
      id: "c_0123456789abcdef",
      pageIndex: 4,
      pageLabel: "iv",
      text: "trusted evidence",
    },
  ];
  const answer =
    "Claim <b>literal</b> [[cite:c_0123456789abcdef]] " +
    "fabricated [[cite:c_deadbeefdeadbeef]].";
  const segments = PDF.parseCitationMarkers(answer, selectedChunks);

  assert.deepEqual(
    segments.filter((segment) => segment.type === "citation"),
    [
      {
        type: "citation",
        id: "c_0123456789abcdef",
        pageIndex: 4,
        pageLabel: "iv",
        display: "[PDF 5]",
      },
    ],
  );
  const plainText = segments
    .filter((segment) => segment.type === "text")
    .map((segment) => segment.text)
    .join("");
  assert.match(plainText, /<b>literal<\/b>/);
  assert.match(plainText, /\[\[cite:c_deadbeefdeadbeef\]\]/);
});

test("coverage distinguishes all-image, partial, and complete PDFs", () => {
  const allImage = PDF.coverageForPages([
    page(0, ""),
    page(1, "   "),
    page(2, ""),
  ]);
  assert.equal(allImage.status, "all-empty");
  assert.equal(allImage.allEmpty, true);
  assert.equal(allImage.textPages, 0);
  assert.deepEqual(allImage.emptyPageIndexes, [0, 1, 2]);

  const partial = PDF.coverageForPages([
    page(0, "cover text"),
    page(1, ""),
    page(2, "body text"),
  ]);
  assert.equal(partial.status, "partial");
  assert.equal(partial.partial, true);
  assert.equal(partial.coverageRatio, 2 / 3);
  assert.deepEqual(partial.emptyPageIndexes, [1]);

  const complete = PDF.coverageForPages([
    page(0, "one"),
    page(1, "two"),
  ]);
  assert.equal(complete.status, "complete");
  assert.equal(complete.complete, true);
});

test("default PDF cache is a three-entry LRU", () => {
  const cache = new PDF.LRUCache();
  cache.set("a", 1).set("b", 2).set("c", 3);
  assert.equal(cache.get("a"), 1);
  cache.set("d", 4);

  assert.equal(cache.size, 3);
  assert.equal(cache.has("b"), false);
  assert.deepEqual(cache.keys(), ["c", "a", "d"]);
  assert.equal(PDF.pdfCache.maxEntries, 3);
});
