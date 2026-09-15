var AIteroCodex = (() => {
	"use strict";

	const OpenAI = typeof AIteroOpenAI !== "undefined"
		? AIteroOpenAI
		: (typeof module !== "undefined" ? require("./openai.js") : null);
	const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
	const DEFAULT_INACTIVITY_TIMEOUT_MS = 180000;
	const LOGIN_TIMEOUT_MS = 300000;
	const MAX_PROTOCOL_LINE_LENGTH = 16 * 1024 * 1024;
	const DEFAULT_CODEX_MODEL = "gpt-6-astra";
	const DEFAULT_CODEX_REASONING_EFFORT = "xhigh";
	const DEFAULT_CODEX_SERVICE_TIER = "fast";
	const APP_SERVER_ARGUMENTS = [
		"app-server",
		"-c", "features.apps=false",
		"-c", "features.browser_use=false",
		"-c", "features.browser_use_external=false",
		"-c", "features.browser_use_full_cdp_access=false",
		"-c", "features.computer_use=false",
		"-c", "features.image_generation=false",
		"-c", "features.in_app_browser=false",
		"-c", "features.plugins=false",
		"-c", "features.shell_tool=false",
		"-c", "features.unified_exec=false",
		"-c", "features.skill_mcp_dependency_install=false",
		"-c", "features.view_image=false",
		"-c", "allow_login_shell=false",
		"-c", "mcp_servers={}",
		"-c", "hooks={}",
		"-c", 'history.persistence="none"',
		"-c", "memories.use_memories=false",
		"-c", "memories.generate_memories=false",
		"-c", 'file_opener="none"',
	];
	const ALLOWED_PASSIVE_ITEMS = new Set([
		"agentMessage",
		"reasoning",
		"plan",
		"userMessage",
	]);
	function configurationError(message, code) {
		let error = new OpenAI.OpenAIConfigurationError(message);
		error.code = code;
		return error;
	}

	function protocolError(message, properties = {}) {
		return new OpenAI.OpenAIProtocolError(message, properties);
	}

	function makeResponse(text) {
		return {
			output: [{
				type: "message",
				role: "assistant",
				status: "completed",
				content: [{
					type: "output_text",
					text,
					annotations: [],
				}],
			}],
		};
	}

	function contentText(content) {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content.map(part => {
			if (typeof part === "string") return part;
			if (!part || typeof part !== "object") return "";
			return typeof part.text === "string"
				? part.text
				: (typeof part.refusal === "string" ? part.refusal : "");
		}).filter(Boolean).join("\n");
	}

	function formatInput(input) {
		let sections = [];
		for (let item of Array.isArray(input) ? input : []) {
			if (!item || typeof item !== "object") continue;
			let text = contentText(item.content);
			if (!text) continue;
			let role = item.role === "assistant" ? "ASSISTANT" : "USER";
			sections.push(`${role}\n${text}`);
		}
		return sections.join("\n\n");
	}

	function toolPolicyInstructions({ enableWebSearch, enableParallelAgents }) {
		let web = enableWebSearch
			? `Web search is available. Use it only when current or outside information materially improves the answer. Never put verbatim PDF excerpts, chunk IDs, local paths, personal identifiers, or confidential paper details into a search query. Clearly distinguish web-sourced claims from paper-grounded claims and provide normal Markdown links to web sources.`
			: "Web search is disabled. Do not attempt to search the web.";
		let agents = enableParallelAgents
			? `Parallel research agents are available, with at most three children at once. Delegate only genuinely separable research or analysis lanes, wait for all useful children, and synthesize their results. Spawn children without model or reasoning-effort overrides so they inherit the configured ${DEFAULT_CODEX_MODEL} ${DEFAULT_CODEX_REASONING_EFFORT} defaults. Children share the same read-only and tool restrictions as this turn.`
			: "Parallel research agents are disabled. Do not attempt to spawn or message subagents.";
		return `${web}\n${agents}\nShell commands, local file reads, local file writes, code execution, MCP tools, connectors, image tools, and approval requests are forbidden. Do not attempt to use them.`;
	}

	function threadConfig({ enableWebSearch, enableParallelAgents }) {
		return {
			agents: {
				enabled: Boolean(enableParallelAgents),
				max_concurrent_threads_per_session: 3,
				default_subagent_model: DEFAULT_CODEX_MODEL,
				default_subagent_reasoning_effort: DEFAULT_CODEX_REASONING_EFFORT,
			},
			features: {
				apps: false,
				browser_use: false,
				browser_use_external: false,
				browser_use_full_cdp_access: false,
				computer_use: false,
				image_generation: false,
				in_app_browser: false,
				plugins: false,
				shell_tool: false,
				unified_exec: false,
				skill_mcp_dependency_install: false,
				view_image: false,
				fast_mode: true,
			},
			web_search: enableWebSearch ? "live" : "disabled",
			mcp_servers: {},
			hooks: {},
			history: { persistence: "none" },
			memories: {
				use_memories: false,
				generate_memories: false,
			},
			file_opener: "none",
		};
	}

	function itemAllowed(type, { enableWebSearch, enableParallelAgents }) {
		if (ALLOWED_PASSIVE_ITEMS.has(type)) return true;
		if (type === "webSearch") return Boolean(enableWebSearch);
		if (type === "collabAgentToolCall" || type === "subAgentActivity") {
			return Boolean(enableParallelAgents);
		}
		return false;
	}

	function finalAgentText(turn, fallback = "") {
		let messages = (turn?.items ?? []).filter(item => (
			item?.type === "agentMessage" && typeof item.text === "string"
		));
		return messages.at(-1)?.text ?? fallback;
	}

	function turnFailure(turn) {
		let status = turn?.status;
		let info = turn?.error?.codexErrorInfo;
		let code = typeof info === "string" ? info : "";
		let message = String(turn?.error?.message || turn?.error?.additionalDetails || "").trim();
		if (status === "interrupted") return new OpenAI.OpenAICancelledError();
		if (code === "unauthorized") {
			return configurationError("Codex sign-in is required.", "codex-auth-required");
		}
		if (code === "usageLimitExceeded") {
			return new OpenAI.OpenAIHTTPError(message || "Codex usage limit reached.", {
				status: 429,
				code,
			});
		}
		return new OpenAI.OpenAIResponseFailedError(
			message || "The Codex turn failed.",
			{ code: code || "codex-turn-failed" },
		);
	}

	class JsonLineParser {
		constructor({ maxLineLength = MAX_PROTOCOL_LINE_LENGTH } = {}) {
			this.buffer = "";
			this.maxLineLength = maxLineLength;
		}

		feed(chunk) {
			this.buffer += String(chunk ?? "");
			if (this.buffer.length > this.maxLineLength && !this.buffer.includes("\n")) {
				throw protocolError("A Codex protocol message exceeded the size limit.");
			}
			let messages = [];
			while (true) {
				let newline = this.buffer.indexOf("\n");
				if (newline < 0) break;
				let line = this.buffer.slice(0, newline).trim();
				this.buffer = this.buffer.slice(newline + 1);
				if (!line) continue;
				if (line.length > this.maxLineLength) {
					throw protocolError("A Codex protocol message exceeded the size limit.");
				}
				try {
					messages.push(JSON.parse(line));
				}
				catch (_error) {
					throw protocolError("Codex emitted malformed JSON.");
				}
			}
			return messages;
		}

		finish() {
			let remaining = this.buffer.trim();
			this.buffer = "";
			if (!remaining) return [];
			try {
				return [JSON.parse(remaining)];
			}
			catch (_error) {
				throw protocolError("Codex closed with an incomplete JSON message.");
			}
		}
	}

	async function resolveCodexExecutable(SubprocessImpl) {
		let configured = "";
		try {
			configured = Services.env.exists("CODEX_PATH")
				? Services.env.get("CODEX_PATH").trim()
				: "";
		}
		catch (_error) {
			// Fall through to known package-manager paths.
		}
		let candidates = [
			configured,
			"/opt/homebrew/bin/codex",
			"/usr/local/bin/codex",
		].filter(Boolean);
		for (let candidate of candidates) {
			try {
				if (candidate.startsWith("/") && await IOUtils.exists(candidate)) return candidate;
			}
			catch (_error) {
				// Try the next candidate.
			}
		}
		try {
			return await SubprocessImpl.pathSearch("codex");
		}
		catch (_error) {
			throw configurationError(
				"The Codex CLI could not be found. Install it or set CODEX_PATH.",
				"codex-unavailable",
			);
		}
	}

	async function defaultSpawnProcess() {
		let imported;
		try {
			imported = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
		}
		catch (_error) {
			throw configurationError(
				"This Zotero build cannot launch the Codex App Server.",
				"codex-unavailable",
			);
		}
		let command = await resolveCodexExecutable(imported.Subprocess);
		let leaf = `aitero-codex-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
		let workdir = PathUtils.join(PathUtils.tempDir, leaf);
		await IOUtils.makeDirectory(workdir, { permissions: 0o700 });
		try {
			let process = await imported.Subprocess.call({
				command,
				arguments: APP_SERVER_ARGUMENTS,
				environmentAppend: true,
				stderr: "pipe",
				workdir,
			});
			return { process, workdir };
		}
		catch (error) {
			await IOUtils.remove(workdir, { recursive: true, ignoreAbsent: true });
			throw configurationError(
				`The Codex App Server could not start: ${error?.message || "unknown error"}`,
				"codex-unavailable",
			);
		}
	}

	class AppServerConnection {
		constructor({
			spawnProcess = defaultSpawnProcess,
			clientInfo = { name: "aitero", title: "AItero Assistant", version: "0.0.0" },
			requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
			setTimeoutImpl = setTimeout,
			clearTimeoutImpl = clearTimeout,
		} = {}) {
			this.spawnProcess = spawnProcess;
			this.clientInfo = clientInfo;
			this.requestTimeoutMs = requestTimeoutMs;
			this.setTimeoutImpl = setTimeoutImpl;
			this.clearTimeoutImpl = clearTimeoutImpl;
			this.parser = new JsonLineParser();
			this.pending = new Map();
			this.notificationListeners = new Set();
			this.closeListeners = new Set();
			this.nextId = 1;
			this.process = null;
			this.workdir = null;
			this.connectPromise = null;
			this.closed = false;
		}

		async connect() {
			if (this.closed) throw new OpenAI.OpenAINetworkError("The Codex App Server is closed.");
			if (this.process) return;
			if (!this.connectPromise) this.connectPromise = this._connect();
			try {
				await this.connectPromise;
			}
			catch (error) {
				this.connectPromise = null;
				throw error;
			}
		}

		async _connect() {
			try {
				let spawned = await this.spawnProcess();
				this.process = spawned.process ?? spawned;
				this.workdir = spawned.workdir ?? null;
				void this._readLoop();
				void this._drainStderr();
				await this._rawRequest("initialize", {
					clientInfo: this.clientInfo,
					capabilities: { experimentalApi: false },
				});
				await this._write({ method: "initialized", params: {} });
			}
			catch (error) {
				await this.close();
				throw error;
			}
		}

		async request(method, params = null, { timeoutMs = this.requestTimeoutMs } = {}) {
			await this.connect();
			return this._rawRequest(method, params, { timeoutMs });
		}

		async notify(method, params = null) {
			await this.connect();
			await this._write({ method, params });
		}

		async _rawRequest(method, params, { timeoutMs = this.requestTimeoutMs } = {}) {
			let id = this.nextId++;
			let responsePromise = new Promise((resolve, reject) => {
				let timer = this.setTimeoutImpl(() => {
					this.pending.delete(id);
					reject(new OpenAI.OpenAITimeoutError({ code: "codex-request-timeout" }));
				}, timeoutMs);
				this.pending.set(id, { resolve, reject, timer });
			});
			try {
				await this._write({ id, method, params });
			}
			catch (error) {
				let pending = this.pending.get(id);
				if (pending) {
					this.clearTimeoutImpl(pending.timer);
					this.pending.delete(id);
					pending.reject(error);
				}
			}
			return responsePromise;
		}

		async _write(message) {
			if (!this.process?.stdin || this.closed) {
				throw new OpenAI.OpenAINetworkError("The Codex App Server is not connected.");
			}
			try {
				await this.process.stdin.write(`${JSON.stringify(message)}\n`);
			}
			catch (_error) {
				throw new OpenAI.OpenAINetworkError("Could not write to the Codex App Server.");
			}
		}

		async _readLoop() {
			try {
				while (!this.closed) {
					let chunk = await this.process.stdout.readString();
					if (!chunk) break;
					for (let message of this.parser.feed(chunk)) this._handleMessage(message);
				}
				for (let message of this.parser.finish()) this._handleMessage(message);
				if (!this.closed) this._handleClose(new OpenAI.OpenAINetworkError(
					"The Codex App Server exited unexpectedly.",
				));
			}
			catch (error) {
				if (!this.closed) this._handleClose(
					error?.kind ? error : new OpenAI.OpenAINetworkError(
						"The Codex App Server connection failed.",
					),
				);
			}
		}

		async _drainStderr() {
			try {
				while (!this.closed && this.process?.stderr) {
					let chunk = await this.process.stderr.readString();
					if (!chunk) break;
				}
			}
			catch (_error) {
				// Stderr is intentionally discarded and never includes document text in logs.
			}
		}

		_handleMessage(message) {
			if (!message || typeof message !== "object") return;
			if (Object.hasOwn(message, "id") && !message.method) {
				let pending = this.pending.get(message.id);
				if (!pending) return;
				this.pending.delete(message.id);
				this.clearTimeoutImpl(pending.timer);
				if (message.error) {
					pending.reject(protocolError(
						String(message.error.message || "Codex App Server request failed."),
						{ code: message.error.code },
					));
				}
				else pending.resolve(message.result);
				return;
			}
			if (message.method && Object.hasOwn(message, "id")) {
				void this._rejectServerRequest(message).catch(() => {});
				return;
			}
			if (message.method) {
				for (let listener of Array.from(this.notificationListeners)) {
					try {
						listener(message.method, message.params);
					}
					catch (_error) {
						// One consumer cannot break protocol dispatch for the others.
					}
				}
			}
		}

		async _rejectServerRequest(message) {
			let method = String(message.method || "");
			if (method.includes("requestApproval")) {
				await this._write({ id: message.id, result: { decision: "decline" } });
				return;
			}
			if (method.includes("elicitation")) {
				await this._write({ id: message.id, result: { action: "decline" } });
				return;
			}
			await this._write({
				id: message.id,
				error: { code: -32601, message: "AItero does not expose client tools." },
			});
		}

		onNotification(listener) {
			this.notificationListeners.add(listener);
			return () => this.notificationListeners.delete(listener);
		}

		onClose(listener) {
			this.closeListeners.add(listener);
			return () => this.closeListeners.delete(listener);
		}

		_handleClose(error) {
			if (this.closed) return;
			this.closed = true;
			for (let pending of this.pending.values()) {
				this.clearTimeoutImpl(pending.timer);
				pending.reject(error);
			}
			this.pending.clear();
			for (let listener of Array.from(this.closeListeners)) {
				try {
					listener(error);
				}
				catch (_error) {
					// One consumer cannot prevent the others from observing closure.
				}
			}
		}

		async close() {
			if (!this.closed) this._handleClose(new OpenAI.OpenAICancelledError());
			try {
				await this.process?.kill?.();
			}
			catch (_error) {
				// The process may already have exited.
			}
			if (this.workdir && typeof IOUtils !== "undefined") {
				try {
					await IOUtils.remove(this.workdir, { recursive: true, ignoreAbsent: true });
				}
				catch (_error) {
					// The OS can clean up a leftover empty temp directory.
				}
			}
			this.process = null;
		}
	}

	class CodexClient {
		constructor({
			connection,
			connectionFactory,
			version = "0.0.0",
			setTimeoutImpl = setTimeout,
			clearTimeoutImpl = clearTimeout,
		} = {}) {
			this.connection = connection ?? null;
			this.connectionFactory = connectionFactory ?? (() => new AppServerConnection({
				clientInfo: { name: "aitero", title: "AItero Assistant", version },
			}));
			this.setTimeoutImpl = setTimeoutImpl;
			this.clearTimeoutImpl = clearTimeoutImpl;
		}

		_getConnection() {
			if (!this.connection || this.connection.closed) {
				this.connection = this.connectionFactory();
			}
			return this.connection;
		}

		async getStatus() {
			let connection = this._getConnection();
			let result = await connection.request("account/read", { refreshToken: false });
			return {
				available: true,
				authenticated: Boolean(result?.account),
			};
		}

		async login(openURL) {
			let connection = this._getConnection();
			let start = await connection.request("account/login/start", {
				type: "chatgpt",
				appBrand: "chatgpt",
				useHostedLoginSuccessPage: true,
			});
			if (start?.type !== "chatgpt" || !start.authUrl || !start.loginId) {
				throw protocolError("Codex did not return a browser sign-in URL.");
			}
			let completion = this._waitForNotification(
				connection,
				"account/login/completed",
				params => !params?.loginId || params.loginId === start.loginId,
				LOGIN_TIMEOUT_MS,
			);
			try {
				await openURL(start.authUrl);
			}
			catch (error) {
				void connection.request("account/login/cancel", { loginId: start.loginId });
				throw error;
			}
			let result = await completion;
			if (!result?.success) {
				throw configurationError(
					result?.error || "Codex sign-in did not complete.",
					"codex-auth-required",
				);
			}
			return this.getStatus();
		}

		_waitForNotification(connection, method, predicate, timeoutMs) {
			return new Promise((resolve, reject) => {
				let cleanup = () => {};
				let timer = this.setTimeoutImpl(() => {
					cleanup();
					reject(new OpenAI.OpenAITimeoutError({ code: "codex-login-timeout" }));
				}, timeoutMs);
				let unsubscribe = connection.onNotification((receivedMethod, params) => {
					if (receivedMethod !== method || !predicate(params)) return;
					cleanup();
					resolve(params);
				});
				let removeClose = connection.onClose?.(error => {
					cleanup();
					reject(error);
				}) ?? (() => {});
				cleanup = () => {
					this.clearTimeoutImpl(timer);
					unsubscribe();
					removeClose();
				};
			});
		}

		async streamResponse({
			model = DEFAULT_CODEX_MODEL,
			instructions,
			input,
			signal,
			onDelta,
			onToolActivity,
			enableWebSearch = true,
			enableParallelAgents = true,
			inactivityTimeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS,
		}) {
			if (signal?.aborted) throw new OpenAI.OpenAICancelledError();
			let connection = this._getConnection();
			let status = await this.getStatus();
			if (!status.authenticated) {
				throw configurationError("Codex sign-in is required.", "codex-auth-required");
			}
			let policy = { enableWebSearch, enableParallelAgents };
			let thread = null;
			let turnId = null;
			let streamed = "";
			let authoritative = "";
			let settled = false;
			let inactivityTimer = null;
			let rejectDone;
			let resolveDone;
			let done = new Promise((resolve, reject) => {
				resolveDone = resolve;
				rejectDone = reject;
			});
			let resetInactivity = () => {
				if (inactivityTimer) this.clearTimeoutImpl(inactivityTimer);
				inactivityTimer = this.setTimeoutImpl(() => {
					if (settled) return;
					settled = true;
					void this._interrupt(connection, thread?.id, turnId);
					rejectDone(new OpenAI.OpenAITimeoutError({ code: "codex-inactivity-timeout" }));
				}, inactivityTimeoutMs);
			};
			let fail = error => {
				if (settled) return;
				settled = true;
				void this._interrupt(connection, thread?.id, turnId);
				rejectDone(error);
			};
			let handleItem = item => {
				if (!item?.type) return;
				if (!itemAllowed(item.type, policy)) {
					fail(protocolError(
						`Codex attempted a blocked tool: ${item.type}.`,
						{ code: "codex-tool-blocked" },
					));
					return;
				}
				if (item.type === "agentMessage" && typeof item.text === "string") {
					authoritative = item.text;
				}
				if (
					item.type === "webSearch"
					|| item.type === "collabAgentToolCall"
					|| item.type === "subAgentActivity"
				) onToolActivity?.(item);
			};
			let unsubscribe = connection.onNotification((method, params) => {
				if (!thread?.id || params?.threadId !== thread.id) return;
				resetInactivity();
				if (method === "item/started" || method === "item/completed") {
					handleItem(params.item);
					return;
				}
				if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
					streamed += params.delta;
					onDelta?.(params.delta, params);
					return;
				}
				if (method === "turn/completed" && params.turn?.id === turnId) {
					if (params.turn.status !== "completed") {
						fail(turnFailure(params.turn));
						return;
					}
					for (let item of params.turn.items ?? []) handleItem(item);
					if (settled) return;
					settled = true;
					resolveDone(params.turn);
				}
			});
			let removeClose = connection.onClose?.(fail) ?? (() => {});
			let abort = () => fail(new OpenAI.OpenAICancelledError());
			signal?.addEventListener?.("abort", abort, { once: true });

			try {
				let started = await connection.request("thread/start", {
					model,
					cwd: connection.workdir,
					approvalPolicy: "never",
					sandbox: "read-only",
					ephemeral: true,
					serviceName: "aitero-assistant",
					serviceTier: DEFAULT_CODEX_SERVICE_TIER,
					developerInstructions: `${instructions}\n${toolPolicyInstructions(policy)}`,
					config: threadConfig(policy),
				});
				thread = started?.thread;
				if (!thread?.id || thread.ephemeral !== true) {
					throw protocolError("Codex did not create the required ephemeral thread.");
				}
				if (signal?.aborted) throw new OpenAI.OpenAICancelledError();
				resetInactivity();
				let startedTurn = await connection.request("turn/start", {
					threadId: thread.id,
					input: [{ type: "text", text: formatInput(input) }],
					effort: DEFAULT_CODEX_REASONING_EFFORT,
					serviceTier: DEFAULT_CODEX_SERVICE_TIER,
					sandboxPolicy: { type: "readOnly", networkAccess: false },
				});
				turnId = startedTurn?.turn?.id;
				if (!turnId) throw protocolError("Codex did not start a turn.");
				let completedTurn = await done;
				let text = finalAgentText(completedTurn, authoritative || streamed).trim();
				if (!text) throw protocolError("Codex completed without an assistant message.");
				return {
					response: makeResponse(text),
					text,
					refusal: "",
					visibleText: text,
				};
			}
			finally {
				settled = true;
				if (inactivityTimer) this.clearTimeoutImpl(inactivityTimer);
				unsubscribe();
				removeClose();
				signal?.removeEventListener?.("abort", abort);
				if (thread?.id) {
					try {
						await connection.request("thread/unsubscribe", { threadId: thread.id });
					}
					catch (_error) {
						// Ephemeral state is discarded when the connection closes regardless.
					}
				}
			}
		}

		async _interrupt(connection, threadId, turnId) {
			if (!threadId || !turnId) return;
			try {
				await connection.request("turn/interrupt", { threadId, turnId });
			}
			catch (_error) {
				// Cancellation remains local if the process has already exited.
			}
		}

		async shutdown() {
			let connection = this.connection;
			this.connection = null;
			await connection?.close?.();
		}
	}

	let _version = "0.0.0";
	let _client = null;

	function configure({ version } = {}) {
		if (version) _version = version;
	}

	function client() {
		if (!_client) _client = new CodexClient({ version: _version });
		return _client;
	}

	async function shutdown() {
		let active = _client;
		_client = null;
		await active?.shutdown();
	}

	return {
		DEFAULT_CODEX_MODEL,
		DEFAULT_CODEX_REASONING_EFFORT,
		DEFAULT_CODEX_SERVICE_TIER,
		configure,
		getStatus: (...args) => client().getStatus(...args),
		login: (...args) => client().login(...args),
		streamResponse: (...args) => client().streamResponse(...args),
		shutdown,
		_test: {
			JsonLineParser,
			AppServerConnection,
			CodexClient,
			contentText,
			formatInput,
			threadConfig,
			toolPolicyInstructions,
			itemAllowed,
			finalAgentText,
			makeResponse,
			APP_SERVER_ARGUMENTS,
			DEFAULT_CODEX_MODEL,
			DEFAULT_CODEX_REASONING_EFFORT,
			DEFAULT_CODEX_SERVICE_TIER,
		},
	};
})();

if (typeof module !== "undefined") module.exports = AIteroCodex;
