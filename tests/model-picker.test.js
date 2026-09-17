const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const models = require("../src/content/model-picker.js");

const catalog = [
	{
		model: "gpt-6-astra", displayName: "GPT-6-Astra", defaultReasoningEffort: "medium",
		isDefault: true, description: "A long model description that should never appear in the menu.",
		supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "ultra"].map(reasoningEffort => ({ reasoningEffort })),
		serviceTiers: [{ id: "priority", name: "Fast", description: "2x speed, increased usage" }],
	},
	{
		model: "standard-only", displayName: "Standard only", defaultReasoningEffort: "low",
		supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }],
		serviceTiers: [],
	},
];

function mountPicker(t) {
	const dom = new JSDOM('<main></main><button id="outside">Outside</button>');
	const changes = [];
	const picker = new models.ModelPicker({ doc: dom.window.document, onChange: value => changes.push(value) });
	picker.setOptions(models.fromCodexModels(catalog));
	dom.window.document.querySelector("main").append(picker.element);
	t.after(() => { picker.destroy(); dom.window.close(); });
	return { picker, changes, doc: dom.window.document, win: dom.window };
}

function choose(picker, name) {
	const option = Array.from(picker.panel.querySelectorAll(".aitero-model-option"))
		.find(button => button.querySelector(".aitero-model-option-name").textContent === name);
	assert.ok(option, `The ${name} option is visible`);
	assert.equal(option.disabled, false);
	option.click();
}

test("the picker advances model > effort > speed and commits only the complete selection", t => {
	const { picker, changes, doc } = mountPicker(t);
	picker.trigger.click();
	choose(picker, "Standard only");
	assert.equal(picker.panel.querySelector(".aitero-model-heading").textContent, "Reasoning effort");
	choose(picker, "Low");
	assert.equal(picker.panel.querySelector(".aitero-model-heading").textContent, "Response speed");
	assert.equal(changes.length, 0);
	choose(picker, "Standard");
	assert.deepEqual(changes, [{ model: "standard-only", effort: "low", speed: "standard" }]);
	assert.equal(picker.panel.hidden, true);
	assert.equal(doc.activeElement, picker.trigger);
	assert.match(picker.trigger.textContent, /Standard onlyLow · Standard/);
	assert.deepEqual(picker.getRequestOptions(), { model: "standard-only", reasoningEffort: "low", serviceTier: "default" });
});

test("Escape, outside clicks, and disabling discard unfinished changes", t => {
	const { picker, changes, win, doc } = mountPicker(t);
	for (const dismiss of [
		() => picker.panel.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
		() => doc.getElementById("outside").dispatchEvent(new win.Event("pointerdown", { bubbles: true })),
		() => { picker.disabled = true; },
	]) {
		picker.disabled = false;
		picker.open();
		choose(picker, "Standard only");
		dismiss();
		assert.equal(picker.panel.hidden, true);
		assert.equal(picker.value, null);
	}
	assert.deepEqual(changes, []);
});

test("keyboard navigation, backtracking, and disabled Fast options work", t => {
	const { picker, win, doc } = mountPicker(t);
	picker.trigger.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
	assert.equal(doc.activeElement.textContent, "GPT-6-Astra✓");
	doc.activeElement.dispatchEvent(new win.KeyboardEvent("keydown", { key: "End", bubbles: true }));
	assert.equal(doc.activeElement.textContent, "Standard only›");
	doc.activeElement.click();
	assert.equal(picker.draft.effort, "medium");
	choose(picker, "Medium");
	const fast = picker.panel.querySelector(".aitero-model-option:disabled");
	assert.equal(fast.textContent, "Fast");
	assert.match(fast.title, /not available/);
	picker.panel.querySelector(".aitero-model-steps button").click();
	choose(picker, "GPT-6-Astra");
	choose(picker, "Ultra");
	choose(picker, "Fast");
	assert.equal(picker.getRequestOptions().serviceTier, "priority");
	assert.equal(picker.getRequestOptions().reasoningEffort, "ultra");
});

test("mouse focus cannot dismiss the menu before Model or an option handles its click", t => {
	const { picker, win, doc } = mountPicker(t);
	picker.trigger.click();
	const mouseClick = button => {
		button.dispatchEvent(new win.Event("pointerdown", { bubbles: true, composed: true }));
		const down = new win.MouseEvent("mousedown", { bubbles: true, cancelable: true });
		button.dispatchEvent(down);
		// macOS can focus a containing pane instead of the HTML button.
		if (!down.defaultPrevented) doc.getElementById("outside").focus();
		button.click();
	};
	mouseClick(picker.panel.querySelectorAll(".aitero-model-option")[0]);
	assert.equal(picker.step, 1);
	assert.equal(picker.panel.hidden, false);
	mouseClick(picker.panel.querySelector(".aitero-model-steps button"));
	assert.equal(picker.step, 0);
	assert.equal(picker.panel.hidden, false);
	mouseClick(picker.panel.querySelectorAll(".aitero-model-option")[1]);
	assert.equal(picker.step, 1);
	assert.equal(picker.draft.model, "standard-only");
});

test("model rows contain only Codex model names and no separate default option", t => {
	const { picker } = mountPicker(t);
	picker.setOptions(models.fromCodexModels(catalog), null, { model: "standard-only", effort: "medium" });
	assert.equal(picker.trigger.textContent, "Standard only⌄");
	assert.deepEqual(picker.getRequestOptions(), {});
	picker.open();
	assert.equal(picker.draft.effort, "medium");
	assert.deepEqual(Array.from(picker.panel.querySelectorAll(".aitero-model-option"), button => button.textContent), [
		"GPT-6-Astra›", "Standard only✓",
	]);
	choose(picker, "GPT-6-Astra");
	choose(picker, "High");
	choose(picker, "Fast");
	assert.equal(picker.getRequestOptions().serviceTier, "priority");
	picker.setOptions([], { model: "removed-model" });
	picker.open();
	assert.match(picker.panel.textContent, /Models unavailable/);
	assert.deepEqual(picker.getRequestOptions(), {});
});

test("Codex catalog capabilities filter hidden models and retain advertised tier IDs", () => {
	const available = models.fromCodexModels([
		...catalog,
		{ ...catalog[0], model: "hidden", hidden: true },
		{ ...catalog[0], model: "image-only", inputModalities: ["image"] },
		{ ...catalog[0], model: "legacy", serviceTiers: undefined, additionalSpeedTiers: ["fast"] },
	]);
	assert.deepEqual(available.map(model => model.id), ["gpt-6-astra", "standard-only", "legacy"]);
	assert.equal(available[0].fastTier, "priority");
	assert.equal(available[1].fastTier, null);
	assert.equal(available[2].fastTier, "fast");
	assert.deepEqual(models.normalizeSelection({ model: "standard-only", effort: "ultra", speed: "fast" }, available), {
		model: "standard-only", effort: "low", speed: "standard",
	});
});

global.AIteroModels = models;
global.AIteroPDF = require("../src/content/pdf.js");
global.AIteroSession = require("../src/content/session.js");
global.AIteroCompat = {};
const { _test: assistant } = require("../src/content/assistant.js");

async function mountPane(t, { authenticated = true, available = true, preferences = new Map() } = {}) {
	const dom = new JSDOM("<main></main>");
	global.Services = {
		prefs: {
			getStringPref: (key, fallback) => preferences.get(key) || fallback,
			setStringPref: (key, value) => preferences.set(key, value),
		},
	};
	global.AIteroCodex = {
		getStatus: async () => ({ available, authenticated }),
		getModels: async () => catalog,
		getModelDefaults: async () => ({ model: "standard-only" }),
	};
	dom.window.fetch = () => { throw new Error("Tests must not access the network"); };
	const pane = new assistant.PaneController({ doc: dom.window.document, body: dom.window.document.querySelector("main") });
	t.after(() => {
		pane.destroy();
		dom.window.close();
	});
	await pane._refreshCodexStatus();
	pane.target = {
		kind: "pdf", attachmentId: 1, revision: 1,
		item: { fileExists: async () => true, attachmentModificationTime: 1 },
	};
	const pages = [{ pageIndex: 0, text: "Synthetic paper evidence." }];
	pane._getPdfData = async () => ({
		chunks: global.AIteroPDF.chunkPages(pages),
		coverage: global.AIteroPDF.coverageForPages(pages),
	});
	pane._renderTarget();
	return { pane, preferences };
}

const completed = () => ({
	response: { output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Answer." }] }] },
	visibleText: "Answer.",
});

test("fresh installations inherit Codex configuration without persisting or sending overrides", async t => {
	const { pane, preferences } = await mountPane(t);
	assert.equal(pane.modelPicker.value, null);
	assert.equal(pane.modelPicker.trigger.textContent, "Standard only⌄");
	assert.equal(preferences.size, 0);
	const sent = [];
	global.AIteroCodex.streamResponse = async options => { sent.push(options); return completed(); };
	await pane.send("Use the Codex defaults.");
	for (const key of ["model", "reasoningEffort", "serviceTier"]) assert.equal(Object.hasOwn(sent[0], key), false);
	assert.equal(preferences.size, 0);
	const restored = await mountPane(t, { preferences });
	assert.equal(restored.pane.modelPicker.value, null);
	assert.deepEqual(restored.pane.modelPicker.getRequestOptions(), {});
});

test("failed model discovery keeps inherited defaults and can recover on the next check", async t => {
	const { pane } = await mountPane(t);
	pane.modelConfiguration = null;
	pane.modelsLoaded = false;
	global.AIteroCodex.getModels = async () => { throw new Error("Offline"); };
	global.AIteroCodex.getModelDefaults = async () => { throw new Error("Unavailable"); };
	await pane._refreshCodexStatus();
	pane.modelPicker.trigger.click();
	assert.equal(pane.modelPicker.panel.hidden, false);
	assert.match(pane.modelPicker.panel.textContent, /Models unavailable/);
	assert.deepEqual(pane.modelPicker.getRequestOptions(), {});
	global.AIteroCodex.getModels = async () => catalog;
	await pane._refreshCodexStatus();
	pane.modelPicker.open();
	choose(pane.modelPicker, "Standard only");
	assert.equal(pane.modelPicker.step, 1);
});

test("the pane persists choices and sends the selected settings on follow-ups", async t => {
	const { pane, preferences } = await mountPane(t);
	pane.modelPicker.open();
	choose(pane.modelPicker, "GPT-6-Astra");
	choose(pane.modelPicker, "Low");
	choose(pane.modelPicker, "Standard");
	assert.deepEqual(assistant.readModelSettings(), { model: "gpt-6-astra", effort: "low", speed: "standard" });
	let sent = [];
	global.AIteroCodex.streamResponse = async options => {
		assert.equal(pane.modelPicker.trigger.disabled, true);
		sent.push(options);
		return completed();
	};
	await pane.send("Explain the evidence.");
	assert.equal(sent[0].model, "gpt-6-astra");
	assert.equal(sent[0].reasoningEffort, "low");
	assert.equal(sent[0].serviceTier, "default");
	pane.modelPicker.open();
	choose(pane.modelPicker, "GPT-6-Astra");
	choose(pane.modelPicker, "High");
	choose(pane.modelPicker, "Fast");
	await pane.send("Explain further.");
	assert.equal(sent[1].reasoningEffort, "high");
	assert.equal(sent[1].serviceTier, "priority");
	assert.equal(sent[1].input.length, 4);
	pane.clearConversation("new-chat");
	assert.equal(pane.modelPicker.value.effort, "high");
	const restored = await mountPane(t, { preferences });
	assert.equal(restored.pane.modelPicker.value.effort, "high");
});

test("signed-out and unavailable Codex block submission and show the appropriate recovery", async t => {
	for (const available of [true, false]) {
		const { pane } = await mountPane(t, { available, authenticated: false });
		let calls = 0;
		global.AIteroCodex.streamResponse = async () => { calls++; return completed(); };
		await pane.send("Summarize.");
		assert.equal(calls, 0);
		assert.equal(pane.session.history.length, 0);
		assert.equal(pane.modelPicker.trigger.disabled, true);
		assert.equal(pane.signInButton.hidden, !available);
		assert.equal(pane.statusNode.getAttribute("data-l10n-id"), available ? "aitero-codex-sign-in-required" : "aitero-codex-unavailable");
	}
});

test("previous Codex preferences survive migration to the single selection", async t => {
	const selection = { model: "gpt-6-astra", effort: "high", speed: "standard" };
	const preferences = new Map([["extensions.aitero-assistant.modelSettings", JSON.stringify({ codex: selection })]]);
	const { pane } = await mountPane(t, { preferences });
	assert.deepEqual(pane.modelPicker.value, selection);
	assistant.saveModelSelection(selection);
	assert.deepEqual(JSON.parse(preferences.get("extensions.aitero-assistant.modelSettings")), selection);
});

test("failed and cancelled Codex turns leave the previous conversation intact", async t => {
	const { pane } = await mountPane(t);
	global.AIteroCodex.streamResponse = async () => completed();
	await pane.send("Initial question.");
	const baseline = pane.session.history;
	for (const error of [new global.AIteroSession.ResponseFailedError(), new global.AIteroSession.CancelledError()]) {
		global.AIteroCodex.streamResponse = async () => { throw error; };
		await pane.send("Failed follow-up.");
		assert.deepEqual(pane.session.history, baseline);
		assert.equal(pane.session.hasActiveTurn, false);
	}
});
