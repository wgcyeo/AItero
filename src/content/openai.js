var AIteroOpenAI = (() => {
	"use strict";

	const RESPONSES_URL = "https://api.openai.com/v1/responses";
	const DEFAULT_MODEL = "gpt-6-astra";
	const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
	const DEFAULT_INACTIVITY_TIMEOUT_MS = 180000;

	const SERIALIZABLE_ERROR_FIELDS = [
		"kind",
		"status",
		"code",
		"type",
		"param",
		"requestId",
		"clientRequestId",
		"retryAfter",
		"reason",
	];

	class OpenAIError extends Error {
		constructor(message, properties = {}) {
			super(message);
			this.name = this.constructor.name;
			for (const [key, value] of Object.entries(properties)) {
				if (value !== undefined) {
					this[key] = value;
				}
			}
		}

		toJSON() {
			const json = {
				name: this.name,
				message: this.message,
			};
			for (const field of SERIALIZABLE_ERROR_FIELDS) {
				if (this[field] !== undefined) {
					json[field] = this[field];
				}
			}
			if (typeof this.partialText === "string") {
				json.partialTextLength = this.partialText.length;
			}
			return json;
		}
	}

	class OpenAIConfigurationError extends OpenAIError {
		constructor(message) {
			super(message, { kind: "configuration" });
		}
	}

	class OpenAIHTTPError extends OpenAIError {
		constructor(message, properties = {}) {
			super(message, { ...properties, kind: "http" });
		}
	}

	class OpenAINetworkError extends OpenAIError {
		constructor(message = "The OpenAI request failed at the network layer.", properties = {}) {
			super(message, { ...properties, kind: "network" });
		}
	}

	class OpenAITimeoutError extends OpenAIError {
		constructor(properties = {}) {
			super("The OpenAI stream was inactive for too long.", {
				...properties,
				kind: "timeout",
			});
		}
	}

	class OpenAICancelledError extends OpenAIError {
		constructor(properties = {}) {
			super("The OpenAI request was cancelled.", {
				...properties,
				kind: "cancelled",
			});
		}
	}

	class OpenAIStreamError extends OpenAIError {
		constructor(message = "The OpenAI stream reported an error.", properties = {}) {
			super(message, { ...properties, kind: "stream" });
		}
	}

	class OpenAIResponseFailedError extends OpenAIError {
		constructor(message = "The OpenAI response failed.", properties = {}) {
			super(message, { ...properties, kind: "response_failed" });
		}
	}

	class OpenAIResponseIncompleteError extends OpenAIError {
		constructor(message = "The OpenAI response was incomplete.", properties = {}) {
			super(message, { ...properties, kind: "response_incomplete" });
		}
	}

	class OpenAIProtocolError extends OpenAIError {
		constructor(message = "The OpenAI stream did not follow the expected protocol.", properties = {}) {
			super(message, { ...properties, kind: "protocol" });
		}
	}

	function redact(value, secrets = []) {
		let text = typeof value === "string" ? value : String(value ?? "");
		for (const secret of secrets) {
			if (typeof secret === "string" && secret) {
				text = text.split(secret).join("[REDACTED]");
			}
		}
		return text;
	}

	function truncate(value, limit = 2000) {
		if (value.length <= limit) {
			return value;
		}
		return `${value.slice(0, limit)}...`;
	}

	function assertSafetyIdentifier(value) {
		if (typeof value !== "string" || !value.trim()) {
			throw new OpenAIConfigurationError("A safety_identifier is required.");
		}
		if (value.length > 64) {
			throw new OpenAIConfigurationError("safety_identifier must be at most 64 characters.");
		}
		return value;
	}

	function createResponseRequestBody({
		model = DEFAULT_MODEL,
		instructions,
		input,
		safetyIdentifier,
		maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
	} = {}) {
		if (typeof model !== "string" || !model.trim()) {
			throw new OpenAIConfigurationError("A model is required.");
		}
		if (input === undefined) {
			throw new OpenAIConfigurationError("Response input is required.");
		}
		if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
			throw new OpenAIConfigurationError("max_output_tokens must be a positive integer.");
		}

		const isAstra = /^gpt-6-astra(?:-|$)/.test(model);
		const body = {
			model,
			input,
			reasoning: {
				effort: isAstra ? "xhigh" : "medium",
				context: "all_turns",
			},
			max_output_tokens: maxOutputTokens,
			store: false,
			stream: true,
			safety_identifier: assertSafetyIdentifier(safetyIdentifier),
		};
		if (isAstra) body.service_tier = "fast";
		if (instructions !== undefined && instructions !== null && instructions !== "") {
			body.instructions = instructions;
		}
		return body;
	}

	class SSEParser {
		constructor(onMessage, { TextDecoderImpl } = {}) {
			if (typeof onMessage !== "function") {
				throw new TypeError("SSEParser requires an onMessage callback.");
			}
			const Decoder = TextDecoderImpl
				|| (typeof TextDecoder !== "undefined" ? TextDecoder : null);
			if (!Decoder) {
				throw new OpenAIConfigurationError("TextDecoder is unavailable.");
			}
			this._onMessage = onMessage;
			this._decoder = new Decoder("utf-8");
			this._buffer = "";
			this._dataLines = [];
			this._eventName = "";
			this._ended = false;
		}

		feed(chunk) {
			if (this._ended) {
				throw new OpenAIProtocolError("Cannot feed an ended SSE parser.");
			}
			if (typeof chunk === "string") {
				this._buffer += chunk;
			}
			else if (chunk !== undefined && chunk !== null) {
				this._buffer += this._decoder.decode(chunk, { stream: true });
			}
			this._processLines(false);
		}

		end() {
			if (this._ended) {
				return;
			}
			this._ended = true;
			this._buffer += this._decoder.decode();
			this._processLines(true);
			this._dispatch();
		}

		_processLines(final) {
			let lineStart = 0;
			let index = 0;
			while (index < this._buffer.length) {
				const character = this._buffer[index];
				if (character === "\n") {
					this._processLine(this._buffer.slice(lineStart, index));
					index += 1;
					lineStart = index;
					continue;
				}
				if (character === "\r") {
					if (!final && index + 1 === this._buffer.length) {
						break;
					}
					this._processLine(this._buffer.slice(lineStart, index));
					index += this._buffer[index + 1] === "\n" ? 2 : 1;
					lineStart = index;
					continue;
				}
				index += 1;
			}

			this._buffer = this._buffer.slice(lineStart);
			if (final && this._buffer) {
				this._processLine(this._buffer);
				this._buffer = "";
			}
		}

		_processLine(line) {
			if (line === "") {
				this._dispatch();
				return;
			}
			if (line[0] === ":") {
				return;
			}

			const colon = line.indexOf(":");
			const field = colon === -1 ? line : line.slice(0, colon);
			let value = colon === -1 ? "" : line.slice(colon + 1);
			if (value[0] === " ") {
				value = value.slice(1);
			}

			if (field === "data") {
				this._dataLines.push(value);
			}
			else if (field === "event") {
				this._eventName = value;
			}
		}

		_dispatch() {
			if (!this._dataLines.length) {
				this._eventName = "";
				return;
			}
			const message = {
				event: this._eventName || "message",
				data: this._dataLines.join("\n"),
			};
			this._dataLines = [];
			this._eventName = "";
			this._onMessage(message);
		}
	}

	function parseSSEData(data) {
		if (typeof data !== "string") {
			throw new OpenAIProtocolError("An SSE data field was not text.");
		}
		if (data.trim() === "[DONE]") {
			return { done: true, event: null };
		}
		let event;
		try {
			event = JSON.parse(data);
		}
		catch (_error) {
			throw new OpenAIProtocolError("An SSE event contained invalid JSON.");
		}
		if (!event || typeof event !== "object" || typeof event.type !== "string") {
			throw new OpenAIProtocolError("An SSE event did not include a type.");
		}
		return { done: false, event };
	}

	class OutputAccumulator {
		constructor() {
			this._parts = new Map();
		}

		apply(event) {
			let kind;
			let value;
			let replace = false;
			if (event.type === "response.output_text.delta") {
				kind = "text";
				value = event.delta;
			}
			else if (event.type === "response.output_text.done") {
				kind = "text";
				value = event.text;
				replace = true;
			}
			else if (event.type === "response.refusal.delta") {
				kind = "refusal";
				value = event.delta;
			}
			else if (event.type === "response.refusal.done") {
				kind = "refusal";
				value = event.refusal;
				replace = true;
			}
			else {
				return;
			}
			if (typeof value !== "string") {
				return;
			}

			const outputIndex = Number.isInteger(event.output_index) ? event.output_index : 0;
			const contentIndex = Number.isInteger(event.content_index) ? event.content_index : 0;
			const key = `${kind}:${outputIndex}:${contentIndex}`;
			const existing = this._parts.get(key);
			this._parts.set(key, {
				kind,
				outputIndex,
				contentIndex,
				value: replace ? value : `${existing ? existing.value : ""}${value}`,
			});
		}

		get(kind) {
			return [...this._parts.values()]
				.filter(part => part.kind === kind)
				.sort((left, right) => left.outputIndex - right.outputIndex
					|| left.contentIndex - right.contentIndex)
				.map(part => part.value)
				.join("");
		}

		get text() {
			return this.get("text");
		}

		get refusal() {
			return this.get("refusal");
		}

		get visibleText() {
			return [this.text, this.refusal].filter(Boolean).join("\n");
		}
	}

	function extractCompletedOutput(response) {
		let textParts = [];
		let refusalParts = [];
		let visibleParts = [];
		for (let item of response?.output ?? []) {
			if (!Array.isArray(item?.content)) continue;
			for (let part of item.content) {
				if (part?.type === "output_text" && typeof part.text === "string") {
					textParts.push(part.text);
					visibleParts.push(part.text);
				}
				else if (part?.type === "refusal" && typeof part.refusal === "string") {
					refusalParts.push(part.refusal);
					visibleParts.push(part.refusal);
				}
			}
		}
		return {
			text: textParts.join(""),
			refusal: refusalParts.join(""),
			visibleText: visibleParts.join("\n"),
		};
	}

	function createUserMessage(content) {
		if (content && typeof content === "object" && !Array.isArray(content)) {
			if (content.role !== "user") {
				throw new OpenAIConfigurationError("A pending message must have the user role.");
			}
			return { ...content };
		}
		return { role: "user", content };
	}

	class SessionState {
		constructor(initialHistory = []) {
			if (!Array.isArray(initialHistory)) {
				throw new TypeError("Session history must be an array.");
			}
			this._history = initialHistory.slice();
			this._active = null;
			this._nextTurnId = 1;
			this._committedTurnIds = new Set();
		}

		beginTurn(content) {
			if (this._active) {
				throw new OpenAIConfigurationError("Only one request may be active per session.");
			}
			const userMessage = createUserMessage(content);
			const turn = Object.freeze({
				id: this._nextTurnId++,
				userMessage,
				input: [...this._history, userMessage],
			});
			this._active = {
				id: turn.id,
				userMessage,
			};
			return turn;
		}

		begin(content) {
			const turn = this.beginTurn(content);
			return Object.freeze({
				id: turn.id,
				input: turn.input,
				userMessage: turn.userMessage,
				commit: response => this.applyEvent(turn, {
					type: "response.completed",
					response: response && response.type === "response.completed"
						? response.response
						: response,
				}),
				abort: () => this.abandonTurn(turn),
			});
		}

		applyEvent(turn, event) {
			if (!turn || !event || typeof event.type !== "string") {
				return false;
			}
			if (event.type === "response.completed") {
				if (this._committedTurnIds.has(turn.id)) {
					return false;
				}
				if (!this._active || this._active.id !== turn.id) {
					return false;
				}
				if (!event.response || !Array.isArray(event.response.output)) {
					this.abandonTurn(turn);
					throw new OpenAIProtocolError("A completed response did not contain an output array.");
				}
				this._history = [
					...this._history,
					this._active.userMessage,
					...event.response.output,
				];
				this._committedTurnIds.add(turn.id);
				this._active = null;
				return true;
			}

			if (SessionState.isTerminalFailure(event.type)) {
				this.abandonTurn(turn);
			}
			return false;
		}

		abandonTurn(turn) {
			if (this._active && turn && this._active.id === turn.id) {
				this._active = null;
				return true;
			}
			return false;
		}

		clear() {
			this._history = [];
			this._active = null;
			this._committedTurnIds.clear();
		}

		getHistory() {
			return this._history.slice();
		}

		get history() {
			return this.getHistory();
		}

		get hasActiveTurn() {
			return Boolean(this._active);
		}

		toJSON() {
			return {
				historyLength: this._history.length,
				hasActiveTurn: this.hasActiveTurn,
			};
		}

		static isTerminalFailure(type) {
			return [
				"response.failed",
				"response.incomplete",
				"error",
				"transport.cancelled",
				"transport.timeout",
				"transport.http_error",
				"transport.network_error",
				"transport.protocol_error",
			].includes(type);
		}
	}

	function getHeader(response, name) {
		if (!response || !response.headers || typeof response.headers.get !== "function") {
			return null;
		}
		return response.headers.get(name);
	}

	function defaultUUID() {
		const cryptoObject = typeof crypto !== "undefined" ? crypto : null;
		if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
			return cryptoObject.randomUUID();
		}
		const random = Math.random().toString(16).slice(2);
		return `aitero-${Date.now().toString(16)}-${random}`;
	}

	async function createHTTPError(response, {
		apiKey,
		clientRequestId,
		requestId,
	} = {}) {
		let text = "";
		try {
			text = await response.text();
		}
		catch (_error) {
			// The status and request ID are still useful if the body cannot be read.
		}

		let payload;
		try {
			payload = text ? JSON.parse(text) : null;
		}
		catch (_error) {
			payload = null;
		}
		const apiError = payload && payload.error && typeof payload.error === "object"
			? payload.error
			: {};
		const fallback = `OpenAI returned HTTP ${response.status}.`;
		const message = truncate(redact(apiError.message || fallback, [apiKey]));
		const safeRequestId = requestId ? redact(requestId, [apiKey]) : requestId;
		const safeClientRequestId = clientRequestId
			? redact(clientRequestId, [apiKey])
			: clientRequestId;
		return new OpenAIHTTPError(message, {
			status: response.status,
			code: typeof apiError.code === "string" ? redact(apiError.code, [apiKey]) : apiError.code,
			type: typeof apiError.type === "string" ? redact(apiError.type, [apiKey]) : apiError.type,
			param: typeof apiError.param === "string" ? redact(apiError.param, [apiKey]) : apiError.param,
			requestId: safeRequestId,
			clientRequestId: safeClientRequestId,
			retryAfter: getHeader(response, "retry-after") || undefined,
		});
	}

	class OpenAITransport {
		constructor({
			fetchImpl,
			AbortControllerImpl,
			TextDecoderImpl,
			setTimeoutImpl,
			clearTimeoutImpl,
			uuidFactory = defaultUUID,
			endpoint = RESPONSES_URL,
			inactivityTimeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS,
		} = {}) {
			this._fetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
			this._AbortController = AbortControllerImpl
				|| (typeof AbortController !== "undefined" ? AbortController : null);
			this._TextDecoder = TextDecoderImpl
				|| (typeof TextDecoder !== "undefined" ? TextDecoder : null);
			this._setTimeout = setTimeoutImpl || setTimeout;
			this._clearTimeout = clearTimeoutImpl || clearTimeout;
			this._uuidFactory = uuidFactory;
			this._endpoint = endpoint;
			this.inactivityTimeoutMs = inactivityTimeoutMs;
		}

		start({
			apiKey,
			model = DEFAULT_MODEL,
			instructions,
			input,
			safetyIdentifier,
			maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
			clientRequestId,
			onEvent,
		} = {}) {
			if (!this._fetch) {
				throw new OpenAIConfigurationError("fetch is unavailable.");
			}
			if (!this._AbortController) {
				throw new OpenAIConfigurationError("AbortController must be injected.");
			}
			if (typeof apiKey !== "string" || !apiKey.trim()) {
				throw new OpenAIConfigurationError("An OpenAI API key is required.");
			}

			const key = apiKey.trim();
			const requestBody = createResponseRequestBody({
				model,
				instructions,
				input,
				safetyIdentifier,
				maxOutputTokens,
			});
			const resolvedClientRequestId = clientRequestId || this._uuidFactory();
			const controller = new this._AbortController();
			let abortKind = null;
			let inactivityTimer = null;
			let settled = false;

			const emit = event => {
				if (typeof onEvent === "function") {
					onEvent(event);
				}
			};
			const clearInactivityTimer = () => {
				if (inactivityTimer !== null) {
					this._clearTimeout(inactivityTimer);
					inactivityTimer = null;
				}
			};
			const resetInactivityTimer = () => {
				clearInactivityTimer();
				if (this.inactivityTimeoutMs > 0) {
					inactivityTimer = this._setTimeout(() => {
						if (!settled && !abortKind) {
							abortKind = "timeout";
							controller.abort();
						}
					}, this.inactivityTimeoutMs);
				}
			};

			const promise = this._run({
				key,
				requestBody,
				clientRequestId: resolvedClientRequestId,
				controller,
				emit,
				resetInactivityTimer,
				getAbortKind: () => abortKind,
			})
				.catch(error => {
					const normalized = this._normalizeError(error, {
						abortKind,
						clientRequestId: resolvedClientRequestId,
					});
					const lifecycleType = {
						cancelled: "transport.cancelled",
						timeout: "transport.timeout",
						http: "transport.http_error",
						network: "transport.network_error",
						protocol: "transport.protocol_error",
					}[normalized.kind];
					if (lifecycleType) {
						emit({ type: lifecycleType, error: normalized });
					}
					throw normalized;
				})
				.finally(() => {
					settled = true;
					clearInactivityTimer();
				});

			return {
				promise,
				signal: controller.signal,
				cancel() {
					if (settled || abortKind || controller.signal.aborted) {
						return false;
					}
					abortKind = "cancelled";
					controller.abort();
					return true;
				},
			};
		}

		startSessionTurn({ session, userContent, onEvent, ...request } = {}) {
			if (!(session instanceof SessionState)) {
				throw new TypeError("startSessionTurn requires a SessionState.");
			}
			const turn = session.beginTurn(userContent);
			let operation;
			try {
				operation = this.start({
					...request,
					input: turn.input,
					onEvent: event => {
						session.applyEvent(turn, event);
						if (typeof onEvent === "function") {
							onEvent(event);
						}
					},
				});
			}
			catch (error) {
				session.abandonTurn(turn);
				throw error;
			}
			const promise = operation.promise.catch(error => {
				session.abandonTurn(turn);
				throw error;
			});
			return { ...operation, promise, turn };
		}

		async _run({
			key,
			requestBody,
			clientRequestId,
			controller,
			emit,
			resetInactivityTimer,
			getAbortKind,
		}) {
			resetInactivityTimer();
			emit({ type: "transport.started", clientRequestId });

			let response;
			try {
				response = await this._fetch(this._endpoint, {
					method: "POST",
					credentials: "omit",
					cache: "no-store",
					redirect: "error",
					headers: {
						Authorization: `Bearer ${key}`,
						"Content-Type": "application/json",
						Accept: "text/event-stream",
						"X-Client-Request-Id": clientRequestId,
					},
					body: JSON.stringify(requestBody),
					signal: controller.signal,
				});
			}
			catch (error) {
				throw this._normalizeError(error, { abortKind: getAbortKind(), clientRequestId });
			}

			resetInactivityTimer();
			const requestId = getHeader(response, "x-request-id") || undefined;
			if (!response.ok) {
				throw await createHTTPError(response, {
					apiKey: key,
					clientRequestId,
					requestId,
				});
			}

			const contentType = getHeader(response, "content-type");
			if (contentType && !contentType.toLowerCase().includes("text/event-stream")) {
				throw new OpenAIProtocolError("OpenAI returned a non-SSE response.", {
					requestId,
					clientRequestId,
				});
			}
			if (!response.body || typeof response.body.getReader !== "function") {
				throw new OpenAIProtocolError("The OpenAI response body is not a readable stream.", {
					requestId,
					clientRequestId,
				});
			}

			const reader = response.body.getReader();
			const accumulator = new OutputAccumulator();
			let completedResponse = null;
			let terminalType = null;
			let sawDone = false;

			const partialProperties = () => ({
				requestId: requestId ? redact(requestId, [key]) : requestId,
				clientRequestId: clientRequestId ? redact(clientRequestId, [key]) : clientRequestId,
				partialText: truncate(redact(accumulator.visibleText, [key])),
			});

			const parser = new SSEParser(({ data }) => {
				const parsed = parseSSEData(data);
				if (parsed.done) {
					sawDone = true;
					return;
				}
				const event = parsed.event;
				if (completedResponse) {
					return;
				}
				accumulator.apply(event);

				if (event.type === "response.completed") {
					if (terminalType === "response.completed") {
						return;
					}
					if (terminalType) {
						throw new OpenAIProtocolError("The stream contained conflicting terminal events.", partialProperties());
					}
					if (!event.response || !Array.isArray(event.response.output)) {
						throw new OpenAIProtocolError("A completed response did not contain an output array.", partialProperties());
					}
					terminalType = event.type;
					completedResponse = event.response;
					emit(event);
					return;
				}

				if (event.type === "response.failed") {
					terminalType = event.type;
					emit(event);
					const responseError = event.response && event.response.error;
					throw new OpenAIResponseFailedError(
						truncate(redact(responseError && responseError.message || "The OpenAI response failed.", [key])),
						{
							...partialProperties(),
							code: responseError && typeof responseError.code === "string"
								? redact(responseError.code, [key])
								: responseError && responseError.code,
						},
					);
				}

				if (event.type === "response.incomplete") {
					terminalType = event.type;
					emit(event);
					const reason = event.response
						&& event.response.incomplete_details
						&& event.response.incomplete_details.reason;
					throw new OpenAIResponseIncompleteError(
						reason ? `The OpenAI response was incomplete: ${redact(reason, [key])}.`
							: "The OpenAI response was incomplete.",
						{
							...partialProperties(),
							reason: typeof reason === "string" ? redact(reason, [key]) : reason,
						},
					);
				}

				if (event.type === "error") {
					terminalType = event.type;
					emit(event);
					throw new OpenAIStreamError(
						truncate(redact(event.message || "The OpenAI stream reported an error.", [key])),
						{
							...partialProperties(),
							code: typeof event.code === "string" ? redact(event.code, [key]) : event.code,
							param: typeof event.param === "string" ? redact(event.param, [key]) : event.param,
						},
					);
				}

				emit(event);
			}, { TextDecoderImpl: this._TextDecoder });

			try {
				while (!completedResponse) {
					let result;
					try {
						result = await reader.read();
					}
					catch (error) {
						throw this._normalizeError(error, {
							abortKind: getAbortKind(),
							requestId,
							clientRequestId,
						});
					}
					if (result.done) {
						parser.end();
						break;
					}
					resetInactivityTimer();
					parser.feed(result.value);
					if (sawDone && !completedResponse) {
						throw new OpenAIProtocolError("The SSE stream ended without response.completed.", partialProperties());
					}
				}
			}
			finally {
				if (completedResponse && typeof reader.cancel === "function") {
					try {
						await reader.cancel();
					}
					catch (_error) {
						// response.completed is authoritative; cleanup failure does not undo it.
					}
				}
				if (typeof reader.releaseLock === "function") {
					try {
						reader.releaseLock();
					}
					catch (_error) {
						// The reader may already have released its lock after cancellation.
					}
				}
			}

			if (!completedResponse) {
				throw new OpenAIProtocolError("The SSE stream reached EOF without response.completed.", partialProperties());
			}

			const canonical = extractCompletedOutput(completedResponse);
			const text = canonical.text || accumulator.text;
			const refusal = canonical.refusal || accumulator.refusal;
			return {
				response: completedResponse,
				output: completedResponse.output,
				text,
				refusal,
				visibleText: canonical.visibleText
					|| [text, refusal].filter(Boolean).join("\n"),
				usage: completedResponse.usage,
				requestId,
				clientRequestId,
			};
		}

		_normalizeError(error, properties = {}) {
			if (error instanceof OpenAIError) {
				return error;
			}
			if (properties.abortKind === "timeout") {
				return new OpenAITimeoutError(properties);
			}
			if (properties.abortKind === "cancelled" || (error && error.name === "AbortError")) {
				return new OpenAICancelledError(properties);
			}
			return new OpenAINetworkError(undefined, properties);
		}
	}

	async function streamResponse({
		fetchImpl,
		AbortControllerImpl,
		TextDecoderImpl,
		setTimeoutImpl,
		clearTimeoutImpl,
		uuidFactory,
		endpoint,
		inactivityTimeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS,
		apiKey,
		model = DEFAULT_MODEL,
		safetyIdentifier,
		instructions,
		input,
		maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
		clientRequestId,
		onDelta,
		onRefusalDelta,
		onEvent,
		signal,
	} = {}) {
		if (signal && signal.aborted) {
			throw new OpenAICancelledError({ clientRequestId });
		}
		const transport = new OpenAITransport({
			fetchImpl,
			AbortControllerImpl,
			TextDecoderImpl,
			setTimeoutImpl,
			clearTimeoutImpl,
			uuidFactory,
			endpoint,
			inactivityTimeoutMs,
		});
		const operation = transport.start({
			apiKey,
			model,
			safetyIdentifier,
			instructions,
			input,
			maxOutputTokens,
			clientRequestId,
			onEvent: event => {
				if (event.type === "response.output_text.delta" && typeof onDelta === "function") {
					onDelta(event.delta, event);
				}
				if (event.type === "response.refusal.delta" && typeof onRefusalDelta === "function") {
					onRefusalDelta(event.delta, event);
				}
				if (typeof onEvent === "function") {
					onEvent(event);
				}
			},
		});

		const cancel = () => operation.cancel();
		if (signal && typeof signal.addEventListener === "function") {
			signal.addEventListener("abort", cancel, { once: true });
		}
		try {
			const result = await operation.promise;
			return {
				response: result.response,
				text: result.text,
				refusal: result.refusal,
				visibleText: result.visibleText,
			};
		}
		finally {
			if (signal && typeof signal.removeEventListener === "function") {
				signal.removeEventListener("abort", cancel);
			}
		}
	}

	return {
		RESPONSES_URL,
		DEFAULT_MODEL,
		DEFAULT_MAX_OUTPUT_TOKENS,
		DEFAULT_INACTIVITY_TIMEOUT_MS,
		OpenAIError,
		OpenAIConfigurationError,
		OpenAIHTTPError,
		OpenAINetworkError,
		OpenAITimeoutError,
		OpenAICancelledError,
		OpenAIStreamError,
		OpenAIResponseFailedError,
		OpenAIResponseIncompleteError,
		OpenAIProtocolError,
		SSEParser,
		OutputAccumulator,
		extractCompletedOutput,
		SessionState,
		OpenAITransport,
		streamResponse,
		createResponseRequestBody,
		parseSSEData,
		redact,
	};
})();

if (typeof module !== "undefined") {
	module.exports = AIteroOpenAI;
}
