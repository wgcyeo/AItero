var AIteroSession = (() => {
	"use strict";

	class AssistantError extends Error {
		constructor(message, properties = {}) {
			super(message);
			this.name = this.constructor.name;
			Object.assign(this, properties);
		}

		toJSON() {
			return { name: this.name, message: this.message, kind: this.kind, code: this.code };
		}
	}

	class ConfigurationError extends AssistantError {
		constructor(message, properties = {}) {
			super(message, { ...properties, kind: "configuration" });
		}
	}

	class NetworkError extends AssistantError {
		constructor(message = "The Codex connection failed.", properties = {}) {
			super(message, { ...properties, kind: "network" });
		}
	}

	class TimeoutError extends AssistantError {
		constructor(properties = {}) {
			super("Codex did not respond in time.", { ...properties, kind: "timeout" });
		}
	}

	class CancelledError extends AssistantError {
		constructor(properties = {}) {
			super("The request was cancelled.", { ...properties, kind: "cancelled" });
		}
	}

	class ResponseFailedError extends AssistantError {
		constructor(message = "The Codex turn failed.", properties = {}) {
			super(message, { ...properties, kind: "response_failed" });
		}
	}

	class ProtocolError extends AssistantError {
		constructor(message, properties = {}) {
			super(message, { ...properties, kind: "protocol" });
		}
	}

	class UsageLimitError extends AssistantError {
		constructor(message = "Codex usage limit reached.", properties = {}) {
			super(message, { ...properties, kind: "usage_limit" });
		}
	}

	class SessionState {
		constructor() {
			this._history = [];
			this._active = null;
		}

		begin(content) {
			if (this._active) throw new ConfigurationError("Only one request may be active per session.");
			let userMessage = typeof content === "string" ? { role: "user", content } : { ...content };
			if (userMessage.role !== "user") throw new ConfigurationError("A pending message must have the user role.");
			let turn = {};
			this._active = turn;
			return Object.freeze({
				input: [...this._history, userMessage],
				commit: response => {
					if (this._active !== turn) return false;
					this._active = null;
					if (!Array.isArray(response?.output)) {
						throw new ProtocolError("A completed turn did not contain an output array.");
					}
					this._history = [...this._history, userMessage, ...response.output];
					return true;
				},
				abort: () => {
					if (this._active !== turn) return false;
					this._active = null;
					return true;
				},
			});
		}

		clear() {
			this._history = [];
			this._active = null;
		}

		get history() {
			return this._history.slice();
		}

		get hasActiveTurn() {
			return Boolean(this._active);
		}

		toJSON() {
			return { historyLength: this._history.length, hasActiveTurn: this.hasActiveTurn };
		}
	}

	return {
		AssistantError, ConfigurationError, NetworkError, TimeoutError, CancelledError,
		ResponseFailedError, ProtocolError, UsageLimitError, SessionState,
	};
})();

if (typeof module !== "undefined") module.exports = AIteroSession;
