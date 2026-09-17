const test = require("node:test");
const assert = require("node:assert/strict");

const codex = require("../src/content/codex.js");

class FakeConnection {
	constructor({ authenticated = true, accountType = "chatgpt", onTurnStart } = {}) {
		this.authenticated = authenticated;
		this.accountType = accountType;
		this.onTurnStart = onTurnStart;
		this.requests = [];
		this.notificationListeners = new Set();
		this.closeListeners = new Set();
		this.workdir = "/tmp/aitero-test-empty";
		this.closed = false;
	}

	async request(method, params) {
		this.requests.push({ method, params });
		if (method === "account/read") {
			return { account: this.authenticated ? { type: this.accountType } : null };
		}
		if (method === "account/login/start") {
			return {
				type: "chatgpt",
				loginId: "login-1",
				authUrl: "https://auth.openai.com/example",
			};
		}
		if (method === "thread/start") {
			return { thread: { id: "thread-1", ephemeral: true } };
		}
		if (method === "turn/start") {
			setTimeout(() => this.onTurnStart?.(this, params), 0);
			return { turn: { id: "turn-1", status: "inProgress", items: [] } };
		}
		return {};
	}

	onNotification(listener) {
		this.notificationListeners.add(listener);
		return () => this.notificationListeners.delete(listener);
	}

	onClose(listener) {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	emit(method, params) {
		for (const listener of this.notificationListeners) listener(method, params);
	}
}

test("JSONL parsing handles split chunks and rejects incomplete records", () => {
	const parser = new codex._test.JsonLineParser();
	assert.deepEqual(parser.feed('{"id":1,"res'), []);
	assert.deepEqual(parser.feed('ult":{}}\n{"method":"ready"}\n'), [
		{ id: 1, result: {} },
		{ method: "ready" },
	]);
	assert.deepEqual(parser.finish(), []);

	const incomplete = new codex._test.JsonLineParser();
	incomplete.feed('{"id":');
	assert.throws(() => incomplete.finish(), /incomplete JSON/i);
});

test("Codex input flattening preserves user and assistant turns", () => {
	assert.equal(codex._test.formatInput([
		{ role: "user", content: "Paper context" },
		{
			role: "assistant",
			content: [{ type: "output_text", text: "Prior answer" }],
		},
		{ role: "user", content: "Follow-up" },
	]), "USER\nPaper context\n\nASSISTANT\nPrior answer\n\nUSER\nFollow-up");
});

test("tool configuration independently gates web search and parallel agents", () => {
	assert.ok(codex._test.APP_SERVER_ARGUMENTS.includes("features.shell_tool=false"));
	assert.ok(codex._test.APP_SERVER_ARGUMENTS.includes("features.unified_exec=false"));
	assert.ok(codex._test.APP_SERVER_ARGUMENTS.includes("features.apps=false"));
	assert.ok(codex._test.APP_SERVER_ARGUMENTS.includes("features.computer_use=false"));
	assert.ok(codex._test.APP_SERVER_ARGUMENTS.includes("features.plugins=false"));
	assert.ok(codex._test.APP_SERVER_ARGUMENTS.includes("mcp_servers={}"));
	const isolated = codex._test.threadConfig({
		enableWebSearch: false,
		enableParallelAgents: false,
	});
	assert.equal(isolated.web_search, "disabled");
	assert.equal(isolated.agents.enabled, false);
	assert.equal(isolated.features.shell_tool, false);
	assert.equal(isolated.features.unified_exec, false);
	assert.equal(isolated.features.apps, false);
	assert.equal(isolated.features.computer_use, false);
	assert.equal(isolated.features.plugins, false);
	assert.equal(isolated.history.persistence, "none");

	const research = codex._test.threadConfig({
		enableWebSearch: true,
		enableParallelAgents: true,
	});
	assert.equal(research.web_search, "live");
	assert.equal(research.agents.enabled, true);
	assert.equal(research.agents.max_concurrent_threads_per_session, 3);
	assert.equal(Object.hasOwn(research.agents, "default_subagent_model"), false);
	assert.equal(Object.hasOwn(research.agents, "default_subagent_reasoning_effort"), false);
	assert.equal(Object.hasOwn(research.features, "fast_mode"), false);
	assert.equal(
		codex._test.itemAllowed("collabAgentToolCall", {
			enableWebSearch: true,
			enableParallelAgents: true,
		}),
		true,
	);
	assert.equal(
		codex._test.itemAllowed("commandExecution", {
			enableWebSearch: true,
			enableParallelAgents: true,
		}),
		false,
	);
});

test("ChatGPT browser login is delegated to App Server without exposing tokens", async () => {
	const connection = new FakeConnection({ authenticated: false });
	const client = new codex._test.CodexClient({ connection });
	let opened = "";
	const resultPromise = client.login(async url => {
		opened = url;
		connection.authenticated = true;
		setTimeout(() => connection.emit("account/login/completed", {
			loginId: "login-1",
			success: true,
		}), 0);
	});
	assert.deepEqual(await resultPromise, { available: true, authenticated: true });
	assert.equal(opened, "https://auth.openai.com/example");
	assert.deepEqual(connection.requests[0], {
		method: "account/login/start",
		params: {
			type: "chatgpt",
			appBrand: "chatgpt",
			useHostedLoginSuccessPage: true,
		},
	});
	assert.doesNotMatch(JSON.stringify(connection.requests), /accessToken/i);
	assert.equal(connection.requests.at(-1).params.refreshToken, false);
});

test("only ChatGPT accounts can start a turn", async () => {
	for (const options of [
		{ authenticated: false },
		{ accountType: "apiKey" },
		{ accountType: "amazonBedrock" },
	]) {
		const connection = new FakeConnection(options);
		const client = new codex._test.CodexClient({ connection });
		assert.deepEqual(await client.getStatus(), { available: true, authenticated: false });
		await assert.rejects(client.streamResponse({ input: [] }), error => error.code === "codex-auth-required");
		assert.ok(connection.requests.every(call => call.method === "account/read"));
	}
});

test("defaults inherit Codex model, effort, and speed in an ephemeral read-only thread", async () => {
	const deltas = [];
	const activities = [];
	const connection = new FakeConnection({
		onTurnStart(fake) {
			fake.emit("item/started", {
				threadId: "thread-1",
				turnId: "turn-1",
				item: { id: "web-1", type: "webSearch", query: "current result" },
			});
			fake.emit("item/started", {
				threadId: "thread-1",
				turnId: "turn-1",
				item: {
					id: "agent-1",
					type: "collabAgentToolCall",
					tool: "spawnAgent",
					status: "inProgress",
				},
			});
			fake.emit("item/agentMessage/delta", {
				threadId: "thread-1",
				turnId: "turn-1",
				itemId: "message-1",
				delta: "draft",
			});
			fake.emit("turn/completed", {
				threadId: "thread-1",
				turn: {
					id: "turn-1",
					status: "completed",
					items: [{ id: "message-1", type: "agentMessage", text: "Final answer" }],
				},
			});
		},
	});
	const client = new codex._test.CodexClient({ connection });
	const result = await client.streamResponse({
		instructions: "Paper rules",
		input: [{ role: "user", content: "Question" }],
		onDelta: delta => deltas.push(delta),
		onToolActivity: item => activities.push(item.type),
	});

	assert.equal(result.visibleText, "Final answer");
	assert.deepEqual(deltas, ["draft"]);
	assert.deepEqual(activities, ["webSearch", "collabAgentToolCall"]);
	const threadStart = connection.requests.find(call => call.method === "thread/start");
	assert.equal(threadStart.params.ephemeral, true);
	assert.equal(Object.hasOwn(threadStart.params, "model"), false);
	assert.equal(threadStart.params.modelProvider, "openai");
	assert.equal(Object.hasOwn(threadStart.params, "serviceTier"), false);
	assert.equal(Object.hasOwn(threadStart.params.config, "model_reasoning_effort"), false);
	assert.equal(Object.hasOwn(threadStart.params.config.features, "fast_mode"), false);
	assert.equal(threadStart.params.sandbox, "read-only");
	assert.equal(threadStart.params.approvalPolicy, "never");
	assert.equal(threadStart.params.config.web_search, "live");
	assert.equal(threadStart.params.config.agents.enabled, true);
	const turnStart = connection.requests.find(call => call.method === "turn/start");
	assert.deepEqual(turnStart.params.sandboxPolicy, {
		type: "readOnly",
		networkAccess: false,
	});
	assert.equal(Object.hasOwn(turnStart.params, "effort"), false);
	assert.equal(Object.hasOwn(turnStart.params, "serviceTier"), false);
	assert.ok(connection.requests.some(call => call.method === "thread/unsubscribe"));
});

test("a blocked active tool fails closed even when research tools are enabled", async () => {
	const connection = new FakeConnection({
		onTurnStart(fake) {
			fake.emit("item/started", {
				threadId: "thread-1",
				turnId: "turn-1",
				item: { id: "command-1", type: "commandExecution" },
			});
		},
	});
	const client = new codex._test.CodexClient({ connection });
	await assert.rejects(
		client.streamResponse({
			instructions: "Paper rules",
			input: [{ role: "user", content: "Question" }],
			enableWebSearch: true,
			enableParallelAgents: true,
		}),
		error => error.kind === "protocol" && error.code === "codex-tool-blocked",
	);
	assert.ok(connection.requests.some(call => call.method === "turn/interrupt"));
});

test("selected model, effort, and speed reach both the Codex turn and its research agents", async () => {
	for (const serviceTier of ["default", "priority"]) {
		const connection = new FakeConnection({
			onTurnStart(fake) {
				fake.emit("turn/completed", {
					threadId: "thread-1",
					turn: { id: "turn-1", status: "completed", items: [{ type: "agentMessage", text: "Answer" }] },
				});
			},
		});
		const client = new codex._test.CodexClient({ connection });
		await client.streamResponse({
			model: "gpt-5.6-luna", reasoningEffort: "low", serviceTier,
			instructions: "Paper rules", input: [{ role: "user", content: "Question" }],
		});
		const thread = connection.requests.find(call => call.method === "thread/start").params;
		const turn = connection.requests.find(call => call.method === "turn/start").params;
		assert.equal(thread.model, "gpt-5.6-luna");
		assert.equal(thread.serviceTier, serviceTier);
		assert.equal(turn.serviceTier, serviceTier);
		assert.equal(turn.effort, "low");
		assert.equal(thread.config.features.fast_mode, serviceTier === "priority");
		assert.equal(thread.config.model_reasoning_effort, "low");
		assert.equal(thread.config.agents.default_subagent_model, "gpt-5.6-luna");
		assert.equal(thread.config.agents.default_subagent_reasoning_effort, "low");
		assert.match(thread.developerInstructions, /inherit the active Codex configuration/);
		assert.equal(thread.ephemeral, true);
		assert.equal(thread.approvalPolicy, "never");
	}
});

test("model discovery follows pagination without creating a conversation", async () => {
	const requests = [];
	const client = new codex._test.CodexClient({
		connection: {
			async request(method, params) {
				requests.push({ method, params });
				return params.cursor
					? { data: [{ model: "second-model" }], nextCursor: null }
					: { data: [{ model: "first-model" }], nextCursor: "page-2" };
			},
		},
	});
	assert.deepEqual(await client.getModels(), [{ model: "first-model" }, { model: "second-model" }]);
	assert.equal(requests.length, 2);
	assert.ok(requests.every(call => call.method === "model/list" && call.params.includeHidden === false));
	assert.equal(requests[1].params.cursor, "page-2");
});

test("default model display reads effective Codex config without exposing unrelated settings", async () => {
	const requests = [];
	const client = new codex._test.CodexClient({
		connection: {
			workdir: "/tmp/aitero-test-empty",
			async request(method, params) {
				requests.push({ method, params });
				return { config: { model: "configured-model", model_reasoning_effort: "high", service_tier: "priority", other: "unrelated" } };
			},
		},
	});
	assert.deepEqual(await client.getModelDefaults(), { model: "configured-model", effort: "high", serviceTier: "priority" });
	assert.deepEqual(requests, [{ method: "config/read", params: { cwd: "/tmp/aitero-test-empty", includeLayers: false } }]);
});

test("AbortSignal interrupts the active Codex turn", async () => {
	const connection = new FakeConnection();
	const client = new codex._test.CodexClient({ connection });
	const controller = new AbortController();
	const promise = client.streamResponse({
		instructions: "Paper rules",
		input: [{ role: "user", content: "Question" }],
		signal: controller.signal,
	});
	setTimeout(() => controller.abort(), 10);
	await assert.rejects(promise, error => error.kind === "cancelled");
	assert.ok(connection.requests.some(call => call.method === "turn/interrupt"));
});
