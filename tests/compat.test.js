const test = require("node:test");
const assert = require("node:assert/strict");

const compat = require("../src/content/compat.js");

test("compat worker mapping keeps an intentional blank middle page", () => {
	const pages = compat.trustedWorkerPages(42, {
		text: "first\f\flast",
		extractedPages: 3,
		totalPages: 3,
	});
	assert.deepEqual(pages.map(page => [page.pageIndex, page.text]), [
		[0, "first"],
		[1, ""],
		[2, "last"],
	]);
});

test("compat worker mapping rejects mismatched counts", () => {
	assert.equal(compat.trustedWorkerPages(1, {
		text: "first\flast",
		extractedPages: 2,
		totalPages: 3,
	}), null);
	assert.equal(compat.trustedWorkerPages(1, {
		text: "first\flast",
		extractedPages: 3,
		totalPages: 3,
	}), null);
	assert.equal(compat.trustedWorkerPages(1, {
		text: null,
		extractedPages: 1,
		totalPages: 1,
	}), null);
	assert.equal(compat.trustedWorkerPages(1, {
		text: "text",
		extractedPages: "1",
		totalPages: "1",
	}), null);
});

test("reader character reconstruction honors spaces and paragraph breaks", () => {
	assert.equal(compat.pageDataToText({ chars: [
		{ u: "A", spaceAfter: true },
		{ c: "B", paragraphBreakAfter: true },
		{ c: "C" },
		{ c: "x", ignorable: true },
	]}), "A B\n\nC");
});

test("Zotero 9 worker fallback requests exact zero-based pages", async () => {
	const calls = [];
	global.Zotero = {
		PDFWorker: {
			async getFullText(_id, pages) {
				calls.push(pages);
				const index = pages[0];
				return {
					text: index === 1 ? "" : `page-${index + 1}`,
					extractedPages: 1,
					totalPages: 3,
				};
			},
		},
	};
	const pages = await compat.extractWithZotero9PerPageWorker(9, 3);
	assert.deepEqual(calls, [[0], [1], [2]]);
	assert.deepEqual(pages.map(page => page.text), ["page-1", "", "page-3"]);
});
