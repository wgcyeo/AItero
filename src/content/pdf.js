var AIteroPDF = (() => {
  "use strict";

  const DEFAULT_CHUNK_SIZE = 1200;
  const DEFAULT_CHUNK_OVERLAP = 200;
  const NORMAL_MAX_CHUNKS = 12;
  const NORMAL_MAX_CHARS = 30000;
  const BROAD_MAX_CHUNKS = 18;
  const BROAD_MAX_CHARS = 50000;
  const DEFAULT_DISTRIBUTED_CHUNKS = 9;
  // This cap applies to the serialized, overlapping SOURCE chunks, not the
  // raw PDF character count. It leaves substantial headroom in GPT-5.6
  // Luna's context window for instructions, follow-up turns, and output.
  const FULL_CONTEXT_MAX_CHARS = 750000;

  function isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function normalizeText(value) {
    const text = typeof value === "string" ? value : String(value ?? "");
    const normalizedNewlines = text.replace(/\r\n?/g, "\n");
    return typeof normalizedNewlines.normalize === "function"
      ? normalizedNewlines.normalize("NFC")
      : normalizedNewlines;
  }

  function makePageRecord(pageIndex, text, pageLabel) {
    return {
      pageIndex,
      pageLabel: normalizeText(pageLabel || "").trim() || String(pageIndex + 1),
      text: normalizeText(text).trim(),
    };
  }

  /**
   * Report extraction coverage without discarding blank/image-only pages.
   */
  function coverageForPages(pages) {
    const safePages = Array.isArray(pages) ? pages : [];
    const textPageIndexes = [];
    const emptyPageIndexes = [];
    let textChars = 0;

    for (let position = 0; position < safePages.length; position += 1) {
      const page = safePages[position] || {};
      const pageIndex = isNonNegativeInteger(page.pageIndex)
        ? page.pageIndex
        : position;
      const text = normalizeText(page.text).trim();
      if (text) {
        textPageIndexes.push(pageIndex);
        textChars += text.length;
      } else {
        emptyPageIndexes.push(pageIndex);
      }
    }

    const totalPages = safePages.length;
    const textPages = textPageIndexes.length;
    const emptyPages = emptyPageIndexes.length;
    const allEmpty = totalPages > 0 && textPages === 0;
    const partial = textPages > 0 && emptyPages > 0;
    const complete = totalPages > 0 && emptyPages === 0;

    return {
      totalPages,
      textPages,
      emptyPages,
      textChars,
      textPageIndexes,
      emptyPageIndexes,
      coverageRatio: totalPages ? textPages / totalPages : 0,
      allEmpty,
      partial,
      complete,
      status:
        totalPages === 0
          ? "empty-document"
          : allEmpty
            ? "all-empty"
            : partial
              ? "partial"
              : "complete",
    };
  }

  function untrustedWorkerResult(reason, result) {
    return {
      trusted: false,
      source: "worker",
      reason,
      extractedPages: result?.extractedPages,
      totalPages: result?.totalPages,
      pages: [],
      coverage: coverageForPages([]),
    };
  }

  /**
   * Map Zotero 9.0.6 PDFWorker output to canonical zero-based pages.
   *
   * The worker trims its aggregate string, so leading/trailing blank pages can
   * remove form-feed separators. The map is therefore trusted only when every
   * independent page-count signal agrees exactly.
   */
  function mapWorkerFullText(result) {
    if (!result || typeof result !== "object") {
      return untrustedWorkerResult("missing-worker-result", result);
    }
    const { extractedPages, totalPages } = result;
    if (
      !isNonNegativeInteger(extractedPages) ||
      !isNonNegativeInteger(totalPages) ||
      totalPages < 1
    ) {
      return untrustedWorkerResult("invalid-page-counts", result);
    }
    if (extractedPages !== totalPages) {
      return untrustedWorkerResult("partial-worker-extraction", result);
    }
    if (typeof result.text !== "string") {
      return untrustedWorkerResult("missing-worker-text", result);
    }

    // Do not trim or filter before assigning indexes. Empty entries are real
    // PDF pages and must continue occupying their original positions.
    const parts = result.text.split("\f");
    if (parts.length !== totalPages) {
      return untrustedWorkerResult("page-separator-count-mismatch", result);
    }

    const pages = parts.map((text, pageIndex) =>
      makePageRecord(pageIndex, text, String(pageIndex + 1)),
    );
    return {
      trusted: true,
      source: "worker",
      reason: null,
      extractedPages,
      totalPages,
      pages,
      coverage: coverageForPages(pages),
    };
  }

  /**
   * Normalize the result of a reader-specific compatibility adapter.
   *
   * Adapter shape:
   *   { totalPages, pageLabels?, pages: [{ pageIndex?, pageLabel?, text }] }
   * It must return one record for every PDF page. This keeps the pure module
   * independent of Zotero's private reader objects while making page shifts
   * impossible to accept silently.
   */
  function normalizeReaderPages(result) {
    const rawPages = Array.isArray(result) ? result : result?.pages;
    const totalPages = Array.isArray(result)
      ? result.length
      : result?.totalPages;
    if (
      !Array.isArray(rawPages) ||
      !isNonNegativeInteger(totalPages) ||
      totalPages < 1
    ) {
      return {
        trusted: false,
        source: "reader",
        reason: "invalid-reader-result",
        pages: [],
        coverage: coverageForPages([]),
      };
    }
    if (rawPages.length !== totalPages) {
      return {
        trusted: false,
        source: "reader",
        reason: "reader-page-count-mismatch",
        pages: [],
        coverage: coverageForPages([]),
      };
    }

    const labels = Array.isArray(result?.pageLabels) ? result.pageLabels : [];
    const slots = new Array(totalPages);
    for (let position = 0; position < rawPages.length; position += 1) {
      const rawPage = rawPages[position] || {};
      const pageIndex = isNonNegativeInteger(rawPage.pageIndex)
        ? rawPage.pageIndex
        : position;
      if (pageIndex >= totalPages || slots[pageIndex]) {
        return {
          trusted: false,
          source: "reader",
          reason: "invalid-reader-page-index",
          pages: [],
          coverage: coverageForPages([]),
        };
      }
      slots[pageIndex] = makePageRecord(
        pageIndex,
        rawPage.text,
        rawPage.pageLabel || labels[pageIndex],
      );
    }
    if (slots.some((page) => !page)) {
      return {
        trusted: false,
        source: "reader",
        reason: "missing-reader-page",
        pages: [],
        coverage: coverageForPages([]),
      };
    }

    return {
      trusted: true,
      source: "reader",
      reason: null,
      totalPages,
      pages: slots,
      coverage: coverageForPages(slots),
    };
  }

  /** Rebuild the text format used by Zotero's document worker from reader chars. */
  function reconstructReaderPageText(chars) {
    if (!Array.isArray(chars)) return "";
    const output = [];
    for (const char of chars) {
      if (!char || typeof char !== "object") continue;
      if (!char.ignorable) {
        output.push(normalizeText(char.c ?? char.u ?? ""));
        if (
          char.spaceAfter ||
          (char.lineBreakAfter && !char.paragraphBreakAfter)
        ) {
          output.push(" ");
        }
      }
      if (!char.ignorable && char.paragraphBreakAfter) {
        output.push("\n");
      }
    }
    return normalizeText(output.join("")).trim();
  }

  /**
   * Run injected extraction adapters in safe order. No Zotero globals are
   * referenced here; runtime code supplies the callbacks.
   *
   * workerExtract(): Promise<{ text, extractedPages, totalPages }>
   * readerExtract(): Promise<{ totalPages, pageLabels?, pages }>
   */
  async function extractPagesWithFallback(options) {
    const workerExtract = options?.workerExtract;
    const readerExtract = options?.readerExtract;
    const attempts = [];

    if (typeof workerExtract === "function") {
      try {
        const mapped = mapWorkerFullText(await workerExtract());
        attempts.push({ source: "worker", reason: mapped.reason });
        if (mapped.trusted) {
          return { ok: true, ...mapped, attempts };
        }
      } catch (error) {
        attempts.push({
          source: "worker",
          reason: "worker-threw",
          error: String(error?.message || error),
        });
      }
    }

    if (typeof readerExtract === "function") {
      try {
        const mapped = normalizeReaderPages(await readerExtract());
        attempts.push({ source: "reader", reason: mapped.reason });
        if (mapped.trusted) {
          return { ok: true, ...mapped, attempts };
        }
      } catch (error) {
        attempts.push({
          source: "reader",
          reason: "reader-threw",
          error: String(error?.message || error),
        });
      }
    }

    return {
      ok: false,
      trusted: false,
      source: null,
      reason: "no-page-safe-extraction",
      pages: [],
      coverage: coverageForPages([]),
      attempts,
    };
  }

  function fnv1a32(value, seed) {
    let hash = (seed ?? 0x811c9dc5) >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function hex32(value) {
    return value.toString(16).padStart(8, "0");
  }

  function deterministicChunkId(material) {
    const left = fnv1a32(material, 0x811c9dc5);
    const right = fnv1a32(material, 0x9e3779b9);
    return `c_${hex32(left)}${hex32(right)}`;
  }

  /** Split each page independently. Chunks never span a page boundary. */
  function chunkPages(pages, options) {
    const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const overlap = options?.overlap ?? DEFAULT_CHUNK_OVERLAP;
    const documentKey = normalizeText(options?.documentKey || "pdf");
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new TypeError("chunkSize must be a positive integer");
    }
    if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
      throw new TypeError("overlap must be an integer smaller than chunkSize");
    }

    const orderedPages = (Array.isArray(pages) ? pages : [])
      .slice()
      .sort((left, right) => left.pageIndex - right.pageIndex);
    const seenPages = new Set();
    const chunks = [];
    const step = chunkSize - overlap;

    for (const page of orderedPages) {
      if (!isNonNegativeInteger(page?.pageIndex)) {
        throw new TypeError("every page must have a zero-based pageIndex");
      }
      if (seenPages.has(page.pageIndex)) {
        throw new TypeError("duplicate pageIndex");
      }
      seenPages.add(page.pageIndex);
      const text = normalizeText(page.text).trim();
      if (!text) continue;

      for (let charStart = 0; charStart < text.length; charStart += step) {
        const charEnd = Math.min(text.length, charStart + chunkSize);
        const chunkText = text.slice(charStart, charEnd);
        const material = [
          documentKey,
          page.pageIndex,
          charStart,
          charEnd,
          chunkText,
        ].join("\u241f");
        chunks.push({
          id: deterministicChunkId(material),
          pageIndex: page.pageIndex,
          pageLabel:
            normalizeText(page.pageLabel || "").trim() ||
            String(page.pageIndex + 1),
          charStart,
          charEnd,
          text: chunkText,
        });
        if (charEnd === text.length) break;
      }
    }
    return chunks;
  }

  const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "about",
    "for",
    "give",
    "in",
    "is",
    "me",
    "of",
    "on",
    "paper",
    "please",
    "the",
    "this",
    "to",
    "what",
    "with",
  ]);

  function tokenize(value) {
    const normalized = normalizeText(value).normalize("NFKC").toLowerCase();
    const words = normalized.match(/[\p{L}\p{N}]+/gu) || [];
    return words.filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  }

  function buildBM25Index(chunks) {
    const safeChunks = Array.isArray(chunks) ? chunks.slice() : [];
    const documentFrequency = new Map();
    let totalTerms = 0;
    const documents = safeChunks.map((chunk) => {
      const terms = tokenize(chunk.text);
      totalTerms += terms.length;
      const termFrequency = new Map();
      for (const term of terms) {
        termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
      }
      for (const term of termFrequency.keys()) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }
      return { terms, termFrequency };
    });

    return {
      chunks: safeChunks,
      documents,
      documentFrequency,
      averageLength: safeChunks.length ? totalTerms / safeChunks.length : 0,
    };
  }

  function rankBM25(chunksOrIndex, query, options) {
    const index = Array.isArray(chunksOrIndex)
      ? buildBM25Index(chunksOrIndex)
      : chunksOrIndex;
    if (!index || !Array.isArray(index.chunks)) return [];
    const queryTerms = Array.from(new Set(tokenize(query)));
    if (!queryTerms.length || !index.chunks.length) return [];

    const k1 = Number.isFinite(options?.k1) ? options.k1 : 1.2;
    const b = Number.isFinite(options?.b) ? options.b : 0.75;
    const documentCount = index.chunks.length;
    const averageLength = index.averageLength || 1;
    const ranked = [];

    for (let documentIndex = 0; documentIndex < documentCount; documentIndex += 1) {
      const document = index.documents[documentIndex];
      const documentLength = document.terms.length;
      let score = 0;
      for (const term of queryTerms) {
        const frequency = document.termFrequency.get(term) || 0;
        if (!frequency) continue;
        const df = index.documentFrequency.get(term) || 0;
        const inverseDocumentFrequency = Math.log(
          1 + (documentCount - df + 0.5) / (df + 0.5),
        );
        const denominator =
          frequency +
          k1 * (1 - b + b * (documentLength / averageLength));
        score +=
          inverseDocumentFrequency *
          ((frequency * (k1 + 1)) / denominator);
      }
      if (score > 0 || options?.includeZero) {
        ranked.push({ chunk: index.chunks[documentIndex], score });
      }
    }

    ranked.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.chunk.pageIndex !== right.chunk.pageIndex) {
        return left.chunk.pageIndex - right.chunk.pageIndex;
      }
      if ((left.chunk.charStart || 0) !== (right.chunk.charStart || 0)) {
        return (left.chunk.charStart || 0) - (right.chunk.charStart || 0);
      }
      return String(left.chunk.id).localeCompare(String(right.chunk.id));
    });
    return ranked;
  }

  const BROAD_ENGLISH_PATTERN =
    /\b(?:summary|summari[sz]e|overview|outline|key\s+(?:points?|findings?|ideas?|takeaways?)|main\s+(?:points?|findings?|ideas?|contributions?)|contributions?|method(?:s|ology|ological)?|approaches?|results?|findings?|limitations?|weakness(?:es)?|conclusions?|entire\s+(?:paper|document)|whole\s+(?:paper|document))\b/i;
  function isBroadQuery(query) {
    const text = normalizeText(query).trim();
    return BROAD_ENGLISH_PATTERN.test(text);
  }

  function documentOrder(left, right) {
    if (left.pageIndex !== right.pageIndex) {
      return left.pageIndex - right.pageIndex;
    }
    if ((left.charStart || 0) !== (right.charStart || 0)) {
      return (left.charStart || 0) - (right.charStart || 0);
    }
    return String(left.id).localeCompare(String(right.id));
  }

  /** Select the first chunk from evenly distributed pages, including endpoints. */
  function selectDistributedChunks(chunks, requestedCount) {
    const count = Math.max(0, requestedCount ?? DEFAULT_DISTRIBUTED_CHUNKS);
    if (!count) return [];
    const firstChunkByPage = new Map();
    for (const chunk of (Array.isArray(chunks) ? chunks : []).slice().sort(documentOrder)) {
      if (!firstChunkByPage.has(chunk.pageIndex)) {
        firstChunkByPage.set(chunk.pageIndex, chunk);
      }
    }
    const pageChunks = Array.from(firstChunkByPage.values());
    if (pageChunks.length <= count) return pageChunks;
    if (count === 1) return [pageChunks[0]];

    const selected = [];
    const selectedIndexes = new Set();
    for (let position = 0; position < count; position += 1) {
      const index = Math.round(
        (position * (pageChunks.length - 1)) / (count - 1),
      );
      if (!selectedIndexes.has(index)) {
        selectedIndexes.add(index);
        selected.push(pageChunks[index]);
      }
    }
    return selected;
  }

  function selectContext(chunks, query, options) {
    const broad = options?.broad ?? isBroadQuery(query);
    const maxChunks =
      options?.maxChunks ?? (broad ? BROAD_MAX_CHUNKS : NORMAL_MAX_CHUNKS);
    const maxChars =
      options?.maxChars ?? (broad ? BROAD_MAX_CHARS : NORMAL_MAX_CHARS);
    if (!Number.isInteger(maxChunks) || maxChunks < 0) {
      throw new TypeError("maxChunks must be a non-negative integer");
    }
    if (!Number.isInteger(maxChars) || maxChars < 0) {
      throw new TypeError("maxChars must be a non-negative integer");
    }

    const ranked = rankBM25(chunks, query);
    const candidates = new Map();
    const addCandidate = (chunk, reason, score) => {
      if (!chunk || !chunk.id) return;
      const existing = candidates.get(chunk.id);
      if (existing) {
        existing.reasons.add(reason);
        if (Number.isFinite(score)) existing.score = Math.max(existing.score, score);
        return;
      }
      candidates.set(chunk.id, {
        chunk,
        reasons: new Set([reason]),
        score: Number.isFinite(score) ? score : 0,
      });
    };

    if (broad) {
      for (const chunk of selectDistributedChunks(
        chunks,
        options?.distributedChunks ?? DEFAULT_DISTRIBUTED_CHUNKS,
      )) {
        addCandidate(chunk, "distributed", 0);
      }
    }
    for (const entry of ranked) {
      addCandidate(entry.chunk, "bm25", entry.score);
    }
    // A lexical query can have no overlap with the PDF when the user asks in
    // another language. Never send an empty paper context in that case.
    if (!broad && ranked.length === 0) {
      for (const chunk of selectDistributedChunks(
        chunks,
        options?.distributedChunks ?? DEFAULT_DISTRIBUTED_CHUNKS,
      )) {
        addCandidate(chunk, "distributed-fallback", 0);
      }
    }

    const orderedCandidates = Array.from(candidates.values());
    // Broad queries reserve document coverage first, then add lexical hits.
    // Normal queries are already entirely score ordered.
    orderedCandidates.sort((left, right) => {
      if (broad) {
        const leftDistributed = left.reasons.has("distributed") ? 1 : 0;
        const rightDistributed = right.reasons.has("distributed") ? 1 : 0;
        if (leftDistributed !== rightDistributed) {
          return rightDistributed - leftDistributed;
        }
      }
      if (right.score !== left.score) return right.score - left.score;
      return documentOrder(left.chunk, right.chunk);
    });

    const selected = [];
    let charCount = 0;
    for (const entry of orderedCandidates) {
      if (selected.length >= maxChunks) break;
      const length = normalizeText(entry.chunk.text).length;
      if (charCount + length > maxChars) continue;
      selected.push({
        ...entry.chunk,
        selectionReasons: Array.from(entry.reasons).sort(),
        bm25Score: entry.score,
      });
      charCount += length;
    }
    selected.sort(documentOrder);

    return {
      broad,
      chunks: selected,
      charCount,
      maxChunks,
      maxChars,
      rankedCount: ranked.length,
    };
  }

  /**
   * Use every extractable page chunk for ordinary papers. Retrieval is only a
   * safety fallback when the serialized full-paper context exceeds the cap.
   */
  function selectPaperContext(chunks, query, options) {
    const ordered = (Array.isArray(chunks) ? chunks : [])
      .filter((chunk) => chunk && chunk.id && normalizeText(chunk.text).length)
      .slice()
      .sort(documentOrder);
    const fullMaxChars = options?.fullMaxChars ?? FULL_CONTEXT_MAX_CHARS;
    if (!Number.isInteger(fullMaxChars) || fullMaxChars < 0) {
      throw new TypeError("fullMaxChars must be a non-negative integer");
    }
    const fullCharCount = ordered.reduce(
      (sum, chunk) => sum + normalizeText(chunk.text).length,
      0,
    );
    if (fullCharCount <= fullMaxChars) {
      return {
        mode: "full",
        broad: false,
        chunks: ordered.map((chunk) => ({
          ...chunk,
          selectionReasons: ["full-paper"],
          bm25Score: 0,
        })),
        charCount: fullCharCount,
        fullCharCount,
        fullChunkCount: ordered.length,
        maxChars: fullMaxChars,
        rankedCount: 0,
      };
    }

    const fallback = selectContext(chunks, query, options?.retrieval);
    return {
      ...fallback,
      mode: "retrieval",
      fullCharCount,
      fullChunkCount: ordered.length,
      fullMaxChars,
    };
  }

  function selectedChunkMap(selectedChunks) {
    const map = new Map();
    for (const chunk of Array.isArray(selectedChunks) ? selectedChunks : []) {
      if (
        typeof chunk?.id === "string" &&
        /^c_[a-f0-9]{16}$/i.test(chunk.id) &&
        isNonNegativeInteger(chunk.pageIndex)
      ) {
        map.set(chunk.id, chunk);
      }
    }
    return map;
  }

  /**
   * Parse only exact, selected opaque IDs. The result contains text/citation
   * data, never HTML; callers must render text fields with textContent.
   * Unknown or malformed markers remain part of ordinary text.
   */
  function parseCitationMarkers(value, selectedChunks) {
    const text = normalizeText(value);
    const allowed = selectedChunkMap(selectedChunks);
    const markerPattern = /\[\[cite:(c_[a-f0-9]{16})\]\]/gi;
    const segments = [];
    let textStart = 0;
    let match;

    const appendText = (content) => {
      if (!content) return;
      const previous = segments[segments.length - 1];
      if (previous?.type === "text") {
        previous.text += content;
      } else {
        segments.push({ type: "text", text: content });
      }
    };

    while ((match = markerPattern.exec(text)) !== null) {
      const id = match[1];
      const chunk = allowed.get(id);
      if (!chunk) {
        // Keep scanning so a later valid marker can still be converted. The
        // unknown marker stays inside the pending plain-text slice.
        continue;
      }
      appendText(text.slice(textStart, match.index));
      segments.push({
        type: "citation",
        id,
        pageIndex: chunk.pageIndex,
        pageLabel:
          normalizeText(chunk.pageLabel || "").trim() ||
          String(chunk.pageIndex + 1),
        display: `[PDF ${chunk.pageIndex + 1}]`,
      });
      textStart = markerPattern.lastIndex;
    }
    appendText(text.slice(textStart));
    return segments;
  }

  class LRUCache {
    constructor(maxEntries = 3) {
      if (!Number.isInteger(maxEntries) || maxEntries < 1) {
        throw new TypeError("maxEntries must be a positive integer");
      }
      this.maxEntries = maxEntries;
      this._entries = new Map();
    }

    get size() {
      return this._entries.size;
    }

    has(key) {
      return this._entries.has(key);
    }

    get(key) {
      if (!this._entries.has(key)) return undefined;
      const value = this._entries.get(key);
      this._entries.delete(key);
      this._entries.set(key, value);
      return value;
    }

    set(key, value) {
      if (this._entries.has(key)) this._entries.delete(key);
      this._entries.set(key, value);
      while (this._entries.size > this.maxEntries) {
        const oldestKey = this._entries.keys().next().value;
        this._entries.delete(oldestKey);
      }
      return this;
    }

    delete(key) {
      return this._entries.delete(key);
    }

    clear() {
      this._entries.clear();
    }

    keys() {
      return Array.from(this._entries.keys());
    }
  }

  const pdfCache = new LRUCache(3);

  return {
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CHUNK_OVERLAP,
    NORMAL_MAX_CHUNKS,
    NORMAL_MAX_CHARS,
    BROAD_MAX_CHUNKS,
    BROAD_MAX_CHARS,
    FULL_CONTEXT_MAX_CHARS,
    coverageForPages,
    mapWorkerFullText,
    normalizeReaderPages,
    reconstructReaderPageText,
    extractPagesWithFallback,
    chunkPages,
    tokenize,
    buildBM25Index,
    rankBM25,
    isBroadQuery,
    selectDistributedChunks,
    selectContext,
    selectPaperContext,
    parseCitationMarkers,
    LRUCache,
    pdfCache,
  };
})();

if (typeof module !== "undefined") module.exports = AIteroPDF;
