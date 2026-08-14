const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.AIteroPDF = {};
global.AIteroCompat = {};
global.AIteroOpenAI = {};

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
	assert.doesNotMatch(instructions, /OPENAI_API_KEY/);
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

test("shell config parsing accepts only literal API configuration assignments", () => {
	const { parseStaticShellAssignment } = assistant._test;
	assert.equal(
		parseStaticShellAssignment("export OPENAI_API_KEY='sk-project_literal'", "OPENAI_API_KEY"),
		"sk-project_literal",
	);
	assert.equal(
		parseStaticShellAssignment('OPENAI_MODEL="gpt-5.6-luna"', "OPENAI_MODEL"),
		"gpt-5.6-luna",
	);
	assert.equal(
		parseStaticShellAssignment("export OPENAI_API_KEY=$(security find-generic-password -w)", "OPENAI_API_KEY"),
		"",
	);
	assert.equal(
		parseStaticShellAssignment("export OPENAI_API_KEY=$OTHER_SECRET", "OPENAI_API_KEY"),
		"",
	);
	assert.equal(
		parseStaticShellAssignment("export UNRELATED='sk-ignore'", "OPENAI_API_KEY"),
		"",
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
	assert.doesNotMatch(source, /https?:\/\/[^`"']*katex/i);
});
