const test = require("node:test");
const assert = require("node:assert/strict");
const { SessionState, ConfigurationError, ProtocolError, ResponseFailedError } = require("../src/content/session.js");

const response = { output: [{ role: "assistant", content: "Complete answer." }] };

test("completed turns commit exactly once and supply history to the next question", () => {
	const session = new SessionState();
	const first = session.begin("First question.");
	assert.deepEqual(session.history, []);
	assert.equal(first.commit(response), true);
	assert.equal(first.commit(response), false);
	assert.equal(first.abort(), false);
	const second = session.begin("Follow-up.");
	assert.deepEqual(second.input, [
		{ role: "user", content: "First question." }, ...response.output,
		{ role: "user", content: "Follow-up." },
	]);
	assert.throws(() => session.begin("Overlapping question"), ConfigurationError);
	second.abort();
	assert.equal(session.history.length, 2);
});

test("aborted, stale, or malformed turns never change committed history", () => {
	const session = new SessionState();
	session.begin("Committed question").commit(response);
	const baseline = session.history;
	const cancelled = session.begin("Cancelled question");
	assert.equal(cancelled.abort(), true);
	assert.equal(cancelled.commit(response), false);
	assert.deepEqual(session.history, baseline);
	const malformed = session.begin("Malformed completion");
	assert.throws(() => malformed.commit({}), ProtocolError);
	assert.equal(session.hasActiveTurn, false);
	assert.deepEqual(session.history, baseline);
	const stale = session.begin("Old document question");
	session.clear();
	const current = session.begin("New document question");
	assert.equal(stale.commit(response), false);
	assert.equal(stale.abort(), false);
	assert.equal(current.commit(response), true);
	assert.equal(session.history[0].content, "New document question");
});

test("session and error serialization do not include paper text", () => {
	const session = new SessionState();
	session.begin("Private paper passage").commit(response);
	assert.deepEqual(JSON.parse(JSON.stringify(session)), { historyLength: 2, hasActiveTurn: false });
	const error = new ResponseFailedError("Turn failed", { code: "failed", partialText: "Private paper passage" });
	assert.doesNotMatch(JSON.stringify(error), /Private paper passage/);
});
