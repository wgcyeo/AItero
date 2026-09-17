const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.AIteroPDF = require("../src/content/pdf.js");
global.AIteroCompat = {};
global.AIteroSession = {};

const assistant = require("../src/content/assistant.js");

test("full paper context is a stable prefix and is not duplicated into question history", () => {
	const chunks = [
		{ id: "c_0123456789abcdef", text: "Paper evidence." },
	];
	const question = assistant._test.createQuestionInput("What changed?");
	const input = assistant._test.createRequestInput([question], chunks, "full");

	assert.equal(input.length, 2);
	assert.equal(input[0].role, "user");
	assert.match(input[0].content, /^UNTRUSTED FULL PAPER TEXT/);
	assert.match(input[0].content, /SOURCE c_0123456789abcdef\nPaper evidence\./);
	assert.equal(input[1].content, "USER QUESTION\nWhat changed?");
	assert.doesNotMatch(input[1].content, /Paper evidence/);

	const followUp = assistant._test.createQuestionInput("Why does it matter?");
	const priorOutput = { type: "message", role: "assistant", content: [] };
	const nextInput = assistant._test.createRequestInput(
		[question, priorOutput, followUp],
		chunks,
		"full",
	);
	assert.equal(
		nextInput.filter(item => String(item.content || "").includes("Paper evidence.")).length,
		1,
	);
});

test("oversized paper context is labeled as a selected fallback", () => {
	const input = assistant._test.createRequestInput(
		[assistant._test.createQuestionInput("Explain the result.")],
		[{ id: "c_0123456789abcdef", text: "Selected evidence." }],
		"retrieval",
	);
	assert.match(input[0].content, /OVERSIZED PDF FALLBACK/);
});

test("system instructions isolate untrusted paper text and require opaque citations", () => {
	const instructions = assistant._test.SYSTEM_INSTRUCTIONS;
	assert.match(instructions, /untrusted source material/i);
	assert.match(instructions, /\[\[cite:<chunk-id>\]\]/);
	assert.match(instructions, /Never invent/);
	assert.match(instructions, /same language/i);
	assert.match(instructions, /Markdown links/);
});

test("external model links are limited to HTTPS URLs", () => {
	const { safeExternalURL } = assistant._test;
	assert.equal(safeExternalURL("https://example.com/paper?q=1"), "https://example.com/paper?q=1");
	assert.equal(safeExternalURL("http://example.com"), "");
	assert.equal(safeExternalURL("javascript:alert(1)"), "");
	assert.equal(safeExternalURL("not a URL"), "");
});

test("Codex status distinguishes signed-in, signed-out, and unavailable states", async () => {
	const { resolveCodexStatus } = assistant._test;
	for (const authenticated of [true, false]) {
		assert.deepEqual(await resolveCodexStatus({
			getCodexStatus: async () => ({ available: true, authenticated }),
		}), { available: true, authenticated });
	}
	const unavailable = await resolveCodexStatus({ getCodexStatus: async () => { throw new Error("not installed"); } });
	assert.equal(unavailable.available, false);
	assert.equal(unavailable.authenticated, false);
});

test("the composer has no provider selector or research-tool checkboxes", () => {
	const source = fs.readFileSync(
		path.join(__dirname, "..", "src", "content", "assistant.js"),
		"utf8",
	);
	assert.doesNotMatch(source, /providerSelect|webSearchToggle|parallelAgentsToggle/);
	assert.match(source, /enableWebSearch:\s*true/);
	assert.match(source, /enableParallelAgents:\s*true/);
});

test("context hints change immediately when the selected item or reader tab changes", () => {
	const { contextHint } = assistant._test;
	const libraryWindow = {
		ZoteroPane: { getSelectedItems: () => [{ id: 11 }] },
	};
	assert.equal(
		contextHint({ win: libraryWindow, item: { id: 11 }, tabType: "library" }),
		"library:11",
	);
	libraryWindow.ZoteroPane.getSelectedItems = () => [{ id: 22 }];
	assert.equal(
		contextHint({ win: libraryWindow, item: { id: 22 }, tabType: "library" }),
		"library:22",
	);

	assert.notEqual(
		contextHint({
			win: { Zotero_Tabs: { selectedID: "reader-a" } },
			item: { id: 11 },
			tabType: "reader",
		}),
		contextHint({
			win: { Zotero_Tabs: { selectedID: "reader-b" } },
			item: { id: 11 },
			tabType: "reader",
		}),
	);
});

test("library selection signatures are stable across row ordering but detect scope changes", () => {
	const { selectionSignature } = assistant._test;
	const win = {
		ZoteroPane: { getSelectedItems: () => [{ id: 22 }, { id: 11 }] },
	};
	assert.equal(selectionSignature(win), "11,22");
	win.ZoteroPane.getSelectedItems = () => [{ id: 11 }, { id: 22 }];
	assert.equal(selectionSignature(win), "11,22");
	win.ZoteroPane.getSelectedItems = () => [];
	assert.equal(selectionSignature(win), "");
});

test("pane Fluent messages localize attributes without replacing the custom body", () => {
	const ftl = fs.readFileSync(
		path.join(__dirname, "..", "src", "locale", "en-US", "aitero.ftl"),
		"utf8",
	);
	assert.match(ftl, /aitero-pane-header\s*=\s*\n\s+\.label\s*=/);
	assert.match(ftl, /aitero-pane-sidenav\s*=\s*\n\s+\.tooltiptext\s*=/);
	assert.match(ftl, /^aitero-pane-header[ \t]*=[ \t]*$/m);
	assert.match(ftl, /^aitero-ready-codex = Ready · Codex$/m);
});

test("safe markdown blocks recognize headings, lists, tables, code, and paragraphs", () => {
	const blocks = assistant._test.parseMarkdownBlocks([
		"## Findings",
		"",
		"- First **result** [[cite:c_0123456789abcdef]]",
		"- Second result",
		"",
		"| Memory | Role |",
		"| --- | --- |",
		"| Episodic | Events |",
		"",
		"```",
		"const value = 1;",
		"```",
		"",
		"A final paragraph.",
		"",
		"$$",
		"E = mc^2",
		"$$",
	].join("\n"));

	assert.deepEqual(blocks.map(block => block.type), [
		"heading",
		"list",
		"table",
		"code",
		"paragraph",
		"math",
	]);
	assert.equal(blocks[0].text, "Findings");
	assert.deepEqual(blocks[1].items, [
		"First **result** [[cite:c_0123456789abcdef]]",
		"Second result",
	]);
	assert.deepEqual(blocks[2].rows, [
		["Memory", "Role"],
		["Episodic", "Events"],
	]);
	assert.equal(blocks[3].text, "const value = 1;");
	assert.equal(blocks[5].text, "E = mc^2");
});

test("ordered list blocks preserve their source number across blank-line splits", () => {
	const blocks = assistant._test.parseMarkdownBlocks([
		"1. Build memory.",
		"",
		"2. Retrieve evidence.",
		"",
		"3. Generate the answer.",
	].join("\n"));
	assert.deepEqual(blocks.map(block => ({
		type: block.type,
		ordered: block.ordered,
		start: block.start,
	})), [
		{ type: "list", ordered: true, start: 1 },
		{ type: "list", ordered: true, start: 2 },
		{ type: "list", ordered: true, start: 3 },
	]);
});

test("chat export produces a readable Markdown transcript", () => {
	const markdown = assistant._test.formatConversationMarkdown(
		"A paper\nwith a title",
		[
			{ role: "user", text: "What changed?" },
			{ role: "assistant", text: "The result improved [PDF 5]." },
			{ role: "assistant", text: "An interrupted answer", incomplete: true },
		],
	);
	assert.equal(markdown, [
		"# AItero chat",
		"",
		"Paper: A paper with a title",
		"",
		"## You",
		"",
		"What changed?",
		"",
		"## AItero",
		"",
		"The result improved [PDF 5].",
		"",
		"## AItero (partial)",
		"",
		"An interrupted answer",
		"",
	].join("\n"));
});

test("exported answers replace internal citation IDs with PDF pages", () => {
	const chunk = {
		id: "c_0123456789abcdef",
		pageIndex: 4,
		pageLabel: "iv",
		text: "Evidence",
	};
	assert.equal(
		assistant._test.readableCitationText(
			"A supported claim [[cite:c_0123456789abcdef]].",
			[chunk],
		),
		"A supported claim [PDF 5].",
	);
});

test("chat export filenames remove cross-platform reserved characters", () => {
	assert.equal(
		assistant._test.exportFilename('Paper: a/b? <test>.  '),
		"Paper a b test - AItero chat.md",
	);
	assert.equal(assistant._test.exportFilename("..."), "PDF - AItero chat.md");
});

test("chat UI exposes selectable messages and Markdown export", () => {
	const source = fs.readFileSync(
		path.join(__dirname, "..", "src", "content", "assistant.js"),
		"utf8",
	);
	const ftl = fs.readFileSync(
		path.join(__dirname, "..", "src", "locale", "en-US", "aitero.ftl"),
		"utf8",
	);
	const css = fs.readFileSync(
		path.join(__dirname, "..", "src", "content", "style.css"),
		"utf8",
	);
	assert.doesNotMatch(source, /draggable|dragstart|setDragImage|dataTransfer/);
	assert.match(source, /File\.putContentsAsync\(/);
	assert.match(source, /formatConversationMarkdown\(this\.target\?\.title, messages\)/);
	assert.doesNotMatch(source, /copyTextToClipboard|aitero-message-copy|aitero-copy-icon/);
	assert.doesNotMatch(ftl, /aitero-copy-message|aitero-copied|aitero-error-copy/);
	assert.match(ftl, /aitero-export-chat\s*=\s*Export/);
	assert.match(css, /\.aitero-message\s*\{[\s\S]*?cursor:\s*text;[\s\S]*?user-select:\s*text/);
	assert.match(css, /\.aitero-button\.aitero-export-chat\s*\{[\s\S]*?background:\s*transparent/);
});

test("chat CSS establishes an independently scrollable flex viewport", () => {
	const css = fs.readFileSync(
		path.join(__dirname, "..", "src", "content", "style.css"),
		"utf8",
	);
	assert.match(css, /\.aitero-root\s*\{[\s\S]*?height:\s*max\([^;]*100vh/);
	assert.match(css, /\.aitero-chat-shell\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?min-height:\s*0;/);
	assert.match(css, /\.aitero-conversation\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/);
	assert.match(css, /overscroll-behavior:\s*contain/);
});

test("the active PDF view starts directly with chat without a paper metadata row", () => {
	const source = fs.readFileSync(
		path.join(__dirname, "..", "src", "content", "assistant.js"),
		"utf8",
	);
	assert.match(source, /if \(this\.target\?\.kind === "pdf"\) \{[\s\S]*?this\.contextBar\.hidden = true;/);
	assert.doesNotMatch(source, /targetNode\.textContent = this\.target\.title/);
	assert.doesNotMatch(source, /aitero-scope-not-loaded/);
});

test("streaming only pins to the bottom while the reader is already near it", () => {
	const source = fs.readFileSync(
		path.join(__dirname, "..", "src", "content", "assistant.js"),
		"utf8",
	);
	const css = fs.readFileSync(
		path.join(__dirname, "..", "src", "content", "style.css"),
		"utf8",
	);
	assert.match(source, /let keepPinned = this\._isConversationNearBottom\(\);/);
	assert.match(source, /if \(keepPinned\) this\._scrollConversation\(true\);/);
	assert.match(source, /aitero-jump-latest/);
	assert.doesNotMatch(css, /scroll-behavior:\s*smooth/);
});

test("math rendering is bundled, resource-local, and treats model TeX as untrusted", () => {
	const source = fs.readFileSync(
		path.join(__dirname, "..", "src", "content", "assistant.js"),
		"utf8",
	);
	assert.match(source, /type:\s*"math"/);
	assert.match(source, /renderer\.render\(source, element/);
	assert.match(source, /trust:\s*false/);
	assert.match(source, /maxExpand:\s*500/);
	assert.match(source, /loadSubScript\(`\$\{_rootURI\}vendor\/katex\/katex\.min\.js`, win\)/);
	assert.match(source, /_assetCacheKey = encodeURIComponent\(`\$\{version \|\| "dev"\}-\$\{Date\.now\(\)\}`\)/);
	assert.match(source, /katex\/katex\.min\.css\?aitero=\$\{_assetCacheKey\}/);
	assert.match(source, /content\/style\.css\?aitero=\$\{_assetCacheKey\}/);
	assert.doesNotMatch(source, /https?:\/\/[^`"']*katex/i);
});

test("bootstrap loads the session and Codex modules before the assistant and clears plugin preferences", () => {
	const source = fs.readFileSync(
		path.join(__dirname, "..", "src", "bootstrap.js"),
		"utf8",
	);
	assert.ok(source.indexOf("content/codex.js") < source.indexOf("content/assistant.js"));
	assert.match(source, /AIteroCodex\.configure\(\{ version \}\)/);
	assert.match(source, /deleteBranch\("extensions\.aitero-assistant\."\)/);
	assert.ok(source.indexOf("content/session.js") < source.indexOf("content/codex.js"));
});

test("release metadata declares Apache-2.0 and packages the project license", () => {
	const root = path.join(__dirname, "..");
	const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
	const packageScript = fs.readFileSync(path.join(root, "scripts", "package.mjs"), "utf8");
	assert.equal(packageMetadata.license, "Apache-2.0");
	assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
	assert.match(packageScript, /archivePath: "LICENSE"/);
});
