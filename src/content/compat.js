/*
 * Zotero 10 compatibility adapter. All private reader/PDF fallbacks live here
 * so future Zotero support can be updated without touching search, transport,
 * or UI code.
 */
var AIteroCompat = (() => {
	"use strict";

	class PdfExtractionError extends Error {
		constructor(code, cause) {
			super(code);
			this.name = "PdfExtractionError";
			this.code = code;
			this.cause = cause;
		}
	}

	function isPdfAttachment(item) {
		if (!item) return false;
		if (typeof item.isPDFAttachment === "function") {
			return item.isPDFAttachment();
		}
		return Boolean(
			typeof item.isAttachment === "function"
			&& item.isAttachment()
			&& item.attachmentContentType === "application/pdf"
		);
	}

	function trustedWorkerPages(attachmentId, result) {
		let extractedPages = result?.extractedPages;
		let totalPages = result?.totalPages;
		if (!Number.isInteger(extractedPages)
			|| !Number.isInteger(totalPages)
			|| totalPages < 1
			|| extractedPages !== totalPages
			|| typeof result?.text !== "string") {
			return null;
		}

		let parts = result.text.split("\f");
		if (parts.length !== totalPages) return null;
		return parts.map((text, pageIndex) => ({
			attachmentId,
			pageIndex,
			text: text.trim(),
		}));
	}

	function getActiveReader(win, attachmentId) {
		try {
			let tabID = win?.Zotero_Tabs?.selectedID;
			let reader = tabID ? Zotero.Reader.getByTabID(tabID) : null;
			return reader?.itemID === attachmentId ? reader : null;
		}
		catch (_error) {
			return null;
		}
	}

	function pageDataToText(pageData) {
		let out = "";
		for (let char of pageData?.chars ?? []) {
			if (char?.ignorable) continue;
			out += char?.u ?? char?.c ?? "";
			if (char?.paragraphBreakAfter) out += "\n\n";
			else if (char?.lineBreakAfter) out += "\n";
			else if (char?.spaceAfter) out += " ";
		}
		return out.trim();
	}

	async function extractWithOpenReader(attachmentId, reader) {
		if (!reader || reader.itemID !== attachmentId) return null;
		let view = reader._internalReader?._primaryView
			?? reader._internalReader?._lastView;
		if (!view) return null;
		if (view.initializedPromise) await view.initializedPromise;

		let frameWin = view._iframeWindow?.wrappedJSObject
			?? view._iframeWindow;
		let app = frameWin?.PDFViewerApplication;
		let pdfDocument = app?.pdfDocument;
		let totalPages = Number(app?.pdfViewer?.pagesCount ?? pdfDocument?.numPages);
		if (!pdfDocument?.getPageData || !Number.isInteger(totalPages) || totalPages < 1) {
			return null;
		}

		let pages = [];
		for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
			let pageData = await pdfDocument.getPageData({ pageIndex });
			pages.push({
				attachmentId,
				pageIndex,
				text: pageDataToText(pageData),
			});
		}
		return pages;
	}

	/*
	 * The Zotero 10.0 manager documents this argument as maxPages, but its
	 * bundled document worker also accepts an array of exact zero-based page
	 * indexes. Keep this private, version-gated behavior isolated here.
	 */
	async function extractWithZotero10PerPageWorker(attachmentId, totalPages) {
		if (!Number.isInteger(totalPages) || totalPages < 1) return null;
		let pages = [];
		for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
			let result = await Zotero.PDFWorker.getFullText(
				attachmentId,
				[pageIndex],
				true,
			);
			if (result?.extractedPages !== 1
				|| result?.totalPages !== totalPages
				|| typeof result?.text !== "string") {
				return null;
			}
			pages.push({
				attachmentId,
				pageIndex,
				text: result.text.trim(),
			});
		}
		return pages;
	}

	async function extractPdfPages({ attachmentId, reader = null }) {
		let initial;
		try {
			initial = await Zotero.PDFWorker.getFullText(attachmentId, null, true);
		}
		catch (error) {
			try {
				let pages = await extractWithOpenReader(attachmentId, reader);
				if (pages) return { pages, source: "reader" };
			}
			catch (_readerError) {
				// Preserve the original worker error below.
			}
			throw new PdfExtractionError("pdf-extraction-failed", error);
		}

		let pages = trustedWorkerPages(attachmentId, initial);
		if (pages) return { pages, source: "worker" };

		try {
			pages = await extractWithOpenReader(attachmentId, reader);
			if (pages) return { pages, source: "reader" };
		}
		catch (_error) {
			// Continue to the Zotero 10 worker fallback.
		}

		try {
			pages = await extractWithZotero10PerPageWorker(
				attachmentId,
				Number(initial?.totalPages),
			);
			if (pages) return { pages, source: "worker-prefix" };
		}
		catch (error) {
			throw new PdfExtractionError("pdf-page-mapping-failed", error);
		}

		throw new PdfExtractionError("pdf-page-mapping-failed");
	}

	async function navigateToPage({ win, attachmentId, pageIndex }) {
		let current = getActiveReader(win, attachmentId);
		if (current?.navigate) {
			await current.navigate({ pageIndex });
			return current;
		}

		let opened = await Zotero.Reader.open(attachmentId, { pageIndex });
		if (opened?.navigate) await opened.navigate({ pageIndex });
		return opened;
	}

	return {
		PdfExtractionError,
		extractPdfPages,
		extractWithOpenReader,
		extractWithZotero10PerPageWorker,
		getActiveReader,
		isPdfAttachment,
		navigateToPage,
		pageDataToText,
		trustedWorkerPages,
	};
})();

if (typeof module !== "undefined") module.exports = AIteroCompat;
