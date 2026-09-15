"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
	DEFAULT_INACTIVITY_TIMEOUT_MS,
	DEFAULT_MAX_OUTPUT_TOKENS,
	DEFAULT_MODEL,
	OpenAICancelledError,
	OpenAIHTTPError,
	OpenAINetworkError,
	OpenAIProtocolError,
	OpenAIResponseFailedError,
	OpenAIResponseIncompleteError,
	OpenAIStreamError,
	OpenAITimeoutError,
	OpenAITransport,
	SSEParser,
	SessionState,
	createResponseRequestBody,
	extractCompletedOutput,
	parseSSEData,
	streamResponse,
} = require("../src/content/openai.js");

const encoder = new TextEncoder();

function headers(values = {}) {
	const normalized = new Map(
		Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
	);
	return {
		get(name) {
			return normalized.get(name.toLowerCase()) ?? null;
		},
	};
}

function byteStream(chunks) {
	let index = 0;
	let cancelled = false;
	return {
		get cancelled() {
			return cancelled;
		},
		getReader() {
			return {
				async read() {
					if (cancelled || index >= chunks.length) {
						return { done: true, value: undefined };
					}
					return { done: false, value: chunks[index++] };
				},
				async cancel() {
					cancelled = true;
				},
				releaseLock() {},
			};
		},
	};
}

function responseFromText(text, {
	status = 200,
	requestId = "req_test",
	chunkBytes,
} = {}) {
	const bytes = encoder.encode(text);
	const chunks = chunkBytes || [bytes];
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: headers({
			"content-type": "text/event-stream; charset=utf-8",
			"x-request-id": requestId,
		}),
		body: byteStream(chunks),
		async text() {
			return text;
		},
	};
}

function apiEvent(event, newline = "\n") {
	return `data: ${JSON.stringify(event)}${newline}${newline}`;
}

function completedResponse(text = "Complete") {
	return {
		id: "resp_test",
		status: "completed",
		output: [
			{
				type: "reasoning",
				id: "rs_test",
				encrypted_content: "opaque-reasoning-state",
				summary: [],
			},
			{
				type: "message",
				id: "msg_test",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text, annotations: [] }],
			},
		],
		usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
	};
}

function transportForText(text, capture = {}) {
	return new OpenAITransport({
		fetchImpl: async (url, options) => {
			capture.url = url;
			capture.options = options;
			return responseFromText(text);
		},
		AbortControllerImpl: AbortController,
		uuidFactory: () => "client-request-test",
	});
}

test("SSEParser preserves split non-ASCII/emoji UTF-8 and handles CRLF, LF, comments, and multiline data", () => {
	const messages = [];
	const source = [
		": keepalive\r\n",
		"event: response\r\n",
		"data: {\"type\":\"response.output_text.delta\",\r\n",
		"data: \"delta\":\"Español😀\"}\r\n",
		"\r\n",
		": another comment\n",
		"data: [DONE]\n",
		"\n",
	].join("");
	const parser = new SSEParser(message => messages.push(message));

	// One-byte chunks split both UTF-8 code points and CRLF delimiters.
	for (const byte of encoder.encode(source)) {
		parser.feed(Uint8Array.of(byte));
	}
	parser.end();

	assert.equal(messages.length, 2);
	assert.equal(messages[0].event, "response");
	assert.deepEqual(parseSSEData(messages[0].data), {
		done: false,
		event: {
			type: "response.output_text.delta",
			delta: "Español😀",
		},
	});
	assert.deepEqual(parseSSEData(messages[1].data), { done: true, event: null });
});

test("request body has the required stateless GPT-6 Astra xhigh/fast defaults", () => {
	const body = createResponseRequestBody({
		input: [{ role: "user", content: "Question" }],
		safetyIdentifier: "profile-123",
	});

	assert.equal(body.model, DEFAULT_MODEL);
	assert.equal(body.model, "gpt-6-astra");
	assert.deepEqual(body.reasoning, { effort: "xhigh", context: "all_turns" });
	assert.equal(body.service_tier, "fast");
	assert.equal(body.max_output_tokens, DEFAULT_MAX_OUTPUT_TOKENS);
	assert.equal(body.store, false);
	assert.equal(body.stream, true);
	assert.equal(body.safety_identifier, "profile-123");
	assert.equal(Object.hasOwn(body, "background"), false);
	assert.equal(Object.hasOwn(body, "previous_response_id"), false);
	for (const unsupported of ["temperature", "top_p", "top_logprobs"]) {
		assert.equal(Object.hasOwn(body, unsupported), false);
	}
	assert.equal(DEFAULT_INACTIVITY_TIMEOUT_MS, 180000);
});

test("explicit non-Astra model overrides retain the previous reasoning and tier behavior", () => {
	const body = createResponseRequestBody({
		model: "gpt-5.6-luna",
		input: [{ role: "user", content: "Question" }],
		safetyIdentifier: "profile-override",
	});
	assert.equal(body.model, "gpt-5.6-luna");
	assert.equal(body.reasoning.effort, "medium");
	assert.equal(Object.hasOwn(body, "service_tier"), false);
});

test("streamResponse sends caller-supplied credentials/model just in time and emits deltas", async () => {
	const capture = {};
	const response = completedResponse("Answer");
	const stream = [
		apiEvent({
			type: "response.output_text.delta",
			item_id: "msg_test",
			output_index: 0,
			content_index: 0,
			delta: "Ans",
			sequence_number: 1,
		}),
		apiEvent({
			type: "response.output_text.done",
			item_id: "msg_test",
			output_index: 0,
			content_index: 0,
			text: "Answer",
			sequence_number: 2,
		}),
		apiEvent({ type: "response.completed", response, sequence_number: 3 }),
		"data: [DONE]\n\n",
	].join("");
	const deltas = [];

	const result = await streamResponse({
		fetchImpl: async (url, options) => {
			capture.url = url;
			capture.options = options;
			return responseFromText(stream);
		},
		AbortControllerImpl: AbortController,
		uuidFactory: () => "client-stream-test",
		apiKey: "sk-local-only",
		model: "gpt-test-model",
		safetyIdentifier: "profile-stream",
		instructions: "Be concise.",
		input: [{ role: "user", content: "Question" }],
		onDelta: delta => deltas.push(delta),
	});

	assert.equal(capture.options.credentials, "omit");
	assert.equal(capture.options.cache, "no-store");
	assert.equal(capture.options.redirect, "error");
	assert.equal(capture.options.headers.Authorization, "Bearer sk-local-only");
	assert.equal(capture.options.headers.Accept, "text/event-stream");
	const requestBody = JSON.parse(capture.options.body);
	assert.equal(requestBody.model, "gpt-test-model");
	assert.equal(requestBody.store, false);
	assert.equal(requestBody.stream, true);
	assert.equal(Object.hasOwn(requestBody, "background"), false);
	assert.equal(Object.hasOwn(requestBody, "previous_response_id"), false);
	assert.deepEqual(deltas, ["Ans"]);
	assert.equal(result.text, "Answer");
	assert.equal(result.refusal, "");
	assert.deepEqual(result.response, response);
});

test("SessionState transaction and transport integration commit entire output exactly once", async () => {
	const session = new SessionState();
	const response = completedResponse("First answer");
	const completed = apiEvent({ type: "response.completed", response, sequence_number: 2 });
	const transport = transportForText([
		apiEvent({
			type: "response.output_text.delta",
			item_id: "msg_test",
			output_index: 0,
			content_index: 0,
			delta: "First answer",
			sequence_number: 1,
		}),
		completed,
		completed,
	].join(""));

	await transport.startSessionTurn({
		session,
		userContent: "First question",
		apiKey: "sk-never-in-session",
		safetyIdentifier: "profile-session",
	}).promise;

	assert.deepEqual(session.history, [
		{ role: "user", content: "First question" },
		...response.output,
	]);
	assert.equal(JSON.stringify(session).includes("sk-never-in-session"), false);

	const standalone = new SessionState();
	const transaction = standalone.begin("Second question");
	assert.deepEqual(transaction.input, [{ role: "user", content: "Second question" }]);
	assert.equal(transaction.commit(response), true);
	assert.equal(transaction.commit(response), false);
	assert.deepEqual(standalone.history, [
		{ role: "user", content: "Second question" },
		...response.output,
	]);
});

test("refusal deltas are exposed separately and a completed refusal succeeds", async () => {
	const response = {
		id: "resp_refusal",
		status: "completed",
		output: [{
			type: "message",
			id: "msg_refusal",
			role: "assistant",
			status: "completed",
			content: [{ type: "refusal", refusal: "I cannot help with that request." }],
		}],
	};
	const stream = [
		apiEvent({
			type: "response.refusal.delta",
			item_id: "msg_refusal",
			output_index: 0,
			content_index: 0,
			delta: "I cannot ",
			sequence_number: 1,
		}),
		apiEvent({
			type: "response.refusal.done",
			item_id: "msg_refusal",
			output_index: 0,
			content_index: 0,
			refusal: "I cannot help with that request.",
			sequence_number: 2,
		}),
		apiEvent({ type: "response.completed", response, sequence_number: 3 }),
	].join("");
	const deltas = [];

	const result = await streamResponse({
		fetchImpl: async () => responseFromText(stream),
		AbortControllerImpl: AbortController,
		apiKey: "sk-refusal",
		safetyIdentifier: "profile-refusal",
		input: [{ role: "user", content: "Request" }],
		onRefusalDelta: delta => deltas.push(delta),
	});

	assert.deepEqual(deltas, ["I cannot "]);
	assert.equal(result.text, "");
	assert.equal(result.refusal, "I cannot help with that request.");
});

test("abort, failed, incomplete, stream error, and EOF never change committed history", async t => {
	await t.test("abort", async () => {
		const session = new SessionState();
		const transport = new OpenAITransport({
			fetchImpl: async (_url, options) => ({
				ok: true,
				status: 200,
				headers: headers({ "content-type": "text/event-stream" }),
				body: {
					getReader() {
						return {
							read() {
								return new Promise((_resolve, reject) => {
									const rejectAbort = () => {
										const error = new Error("aborted");
										error.name = "AbortError";
										reject(error);
									};
									if (options.signal.aborted) {
										rejectAbort();
									}
									else {
										options.signal.addEventListener("abort", rejectAbort, { once: true });
									}
								});
							},
							releaseLock() {},
						};
					},
				},
			}),
			AbortControllerImpl: AbortController,
		});
		const operation = transport.startSessionTurn({
			session,
			userContent: "Question to cancel",
			apiKey: "sk-abort",
			safetyIdentifier: "profile-abort",
		});
		assert.equal(operation.cancel(), true);
		await assert.rejects(operation.promise, OpenAICancelledError);
		assert.deepEqual(session.history, []);
		assert.equal(session.hasActiveTurn, false);
	});

	const cases = [
		{
			name: "response.failed",
			stream: apiEvent({
				type: "response.failed",
				response: { id: "resp_failed", error: { code: "server_error", message: "failed" } },
				sequence_number: 1,
			}),
			ErrorClass: OpenAIResponseFailedError,
		},
		{
			name: "response.incomplete",
			stream: apiEvent({
				type: "response.incomplete",
				response: {
					id: "resp_incomplete",
					incomplete_details: { reason: "max_output_tokens" },
				},
				sequence_number: 1,
			}),
			ErrorClass: OpenAIResponseIncompleteError,
		},
		{
			name: "stream error",
			stream: apiEvent({
				type: "error",
				code: "stream_error",
				message: "stream failed",
				param: null,
				sequence_number: 1,
			}),
			ErrorClass: OpenAIStreamError,
		},
		{
			name: "EOF without terminal event",
			stream: apiEvent({
				type: "response.output_text.delta",
				item_id: "msg_partial",
				output_index: 0,
				content_index: 0,
				delta: "Partial answer",
				sequence_number: 1,
			}),
			ErrorClass: OpenAIProtocolError,
		},
	];

	for (const item of cases) {
		await t.test(item.name, async () => {
			const session = new SessionState();
			const operation = transportForText(item.stream).startSessionTurn({
				session,
				userContent: "Must not commit",
				apiKey: "sk-failure",
				safetyIdentifier: "profile-failure",
			});
			await assert.rejects(operation.promise, item.ErrorClass);
			assert.deepEqual(session.history, []);
			assert.equal(session.hasActiveTurn, false);
		});
	}
});

test("HTTP/network errors are typed and serialized errors never expose the API key", async () => {
	const secret = "sk-super-secret-value";
	const httpTransport = new OpenAITransport({
		fetchImpl: async () => ({
			ok: false,
			status: 401,
			headers: headers({
				"content-type": "application/json",
				"x-request-id": "req_401",
				"retry-after": "3",
			}),
			async text() {
				return JSON.stringify({
					error: {
						message: `bad credential ${secret}`,
						type: "invalid_request_error",
						code: "invalid_api_key",
						param: null,
					},
				});
			},
		}),
		AbortControllerImpl: AbortController,
	});
	const httpOperation = httpTransport.start({
		apiKey: secret,
		input: "hello",
		safetyIdentifier: "profile-errors",
	});
	const httpError = await httpOperation.promise.catch(error => error);
	assert.ok(httpError instanceof OpenAIHTTPError);
	assert.equal(httpError.status, 401);
	assert.equal(httpError.requestId, "req_401");
	assert.equal(httpError.retryAfter, "3");
	assert.equal(JSON.stringify(httpError).includes(secret), false);

	const networkTransport = new OpenAITransport({
		fetchImpl: async () => {
			throw new Error(`socket failure ${secret}`);
		},
		AbortControllerImpl: AbortController,
	});
	const networkOperation = networkTransport.start({
		apiKey: secret,
		input: "hello",
		safetyIdentifier: "profile-errors",
	});
	const networkError = await networkOperation.promise.catch(error => error);
	assert.ok(networkError instanceof OpenAINetworkError);
	assert.equal(JSON.stringify(networkError).includes(secret), false);
	assert.equal(JSON.stringify(networkTransport).includes(secret), false);
});

test("completed output is canonical and serialized errors omit partial paper text", () => {
	const completed = extractCompletedOutput({
		output: [{
			type: "message",
			content: [
				{ type: "output_text", text: "grounded answer" },
				{ type: "refusal", refusal: "limited refusal" },
			],
		}],
	});
	assert.deepEqual(completed, {
		text: "grounded answer",
		refusal: "limited refusal",
		visibleText: "grounded answer\nlimited refusal",
	});
	const error = new OpenAIProtocolError("failed", {
		partialText: "PRIVATE PAPER EXCERPT",
	});
	const serialized = JSON.stringify(error);
	assert.doesNotMatch(serialized, /PRIVATE PAPER EXCERPT/);
	assert.match(serialized, /partialTextLength/);
});

test("the 180 second inactivity timer aborts with OpenAITimeoutError", async () => {
	let timerCallback;
	let timerDelay;
	const transport = new OpenAITransport({
		fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
			options.signal.addEventListener("abort", () => {
				const error = new Error("aborted");
				error.name = "AbortError";
				reject(error);
			}, { once: true });
		}),
		AbortControllerImpl: AbortController,
		setTimeoutImpl(callback, delay) {
			timerCallback = callback;
			timerDelay = delay;
			return 1;
		},
		clearTimeoutImpl() {},
	});
	const operation = transport.start({
		apiKey: "sk-timeout",
		input: "hello",
		safetyIdentifier: "profile-timeout",
	});
	assert.equal(timerDelay, 180000);
	timerCallback();
	await assert.rejects(operation.promise, OpenAITimeoutError);
});
