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

test("Zotero 10 worker fallback requests exact zero-based pages", async () => {
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
	const pages = await compat.extractWithPerPageWorker(9, 3);
	assert.deepEqual(calls, [[0], [1], [2]]);
	assert.deepEqual(pages.map(page => page.text), ["page-1", "", "page-3"]);
});

test("newer Zotero versions use validated page data without a major-version gate", async () => {
	for (const version of ["10.0.2", "10.1", "11.0", "12.0"]) {
		global.Zotero = {
			version,
			PDFWorker: {
				async getFullText(_id, pages) {
					return {
						text: pages ? ["first", "", "last"][pages[0]] : "first last",
						extractedPages: pages ? 1 : 3,
						totalPages: 3,
					};
				},
			},
		};
		const result = await compat.extractPdfPages({ attachmentId: 9 });
		assert.deepEqual(result.pages.map(page => [page.pageIndex, page.text]), [
			[0, "first"], [1, ""], [2, "last"],
		]);
	}
});

test("unsupported future worker behavior fails instead of inventing page citations", async () => {
	global.Zotero = {
		version: "11.0",
		PDFWorker: {
			async getFullText() {
				return { text: "combined text", extractedPages: 3, totalPages: 3 };
			},
		},
	};
	await assert.rejects(
		compat.extractPdfPages({ attachmentId: 9 }),
		error => error.code === "pdf-page-mapping-failed",
	);
});

test("opening a PDF for a citation waits for initialization without navigating twice", async () => {
	let initialize;
	const opened = {
		itemID: 9,
		_initPromise: new Promise(resolve => { initialize = resolve; }),
		navigate() { assert.fail("Reader.open already applies the requested location"); },
	};
	global.Zotero = { Reader: {
		async open(id, location) {
			assert.equal(id, 9);
			assert.deepEqual(location, { pageIndex: 5 });
			return opened;
		},
	} };
	let finished = false;
	const promise = compat.navigateToPage({ attachmentId: 9, pageIndex: 5 })
		.then(reader => { finished = true; return reader; });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(finished, false);
	initialize();
	assert.equal(await promise, opened);
});

test("an active reader must initialize before citation navigation", async () => {
	let initialize;
	const locations = [];
	const reader = {
		itemID: 9,
		_initPromise: new Promise(resolve => { initialize = resolve; }),
		navigate(location) { locations.push(location); },
	};
	global.Zotero = { Reader: { getByTabID: () => reader } };
	const promise = compat.navigateToPage({
		win: { Zotero_Tabs: { selectedID: "reader-tab" } },
		attachmentId: 9,
		pageIndex: 2,
	});
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(locations, []);
	initialize();
	assert.equal(await promise, reader);
	assert.deepEqual(locations, [{ pageIndex: 2 }]);
});
