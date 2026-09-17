var AIteroModels = (() => {
	"use strict";

	const HTML_NS = "http://www.w3.org/1999/xhtml";
	const EFFORT_NAMES = {
		none: "None", minimal: "Minimal", low: "Low", medium: "Medium",
		high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra",
	};
	let nextPickerID = 0;

	function effortOption(id) {
		return { id, name: EFFORT_NAMES[id] || id };
	}

	function fromCodexModels(entries) {
		let models = new Map();
		for (let entry of Array.isArray(entries) ? entries : []) {
			if (entry?.hidden || typeof entry?.model !== "string" || !entry.model.trim()) continue;
			if (Array.isArray(entry.inputModalities) && !entry.inputModalities.includes("text")) continue;
			let efforts = (entry.supportedReasoningEfforts || [])
				.filter(option => typeof option?.reasoningEffort === "string" && option.reasoningEffort)
				.map(option => effortOption(option.reasoningEffort));
			if (!efforts.length) continue;
			let fast = entry.serviceTiers?.find(tier => (
				tier.id === "fast" || tier.id === "priority" || tier.name?.toLowerCase() === "fast"
			));
			models.set(entry.model, {
				id: entry.model,
				name: entry.displayName || entry.model,
				isDefault: Boolean(entry.isDefault),
				efforts,
				defaultEffort: entry.defaultReasoningEffort,
				defaultServiceTier: entry.defaultServiceTier,
				fastTier: fast?.id || (entry.additionalSpeedTiers?.includes("fast") ? "fast" : null),
			});
		}
		return Array.from(models.values());
	}

	function normalizeSelection(value, models) {
		let model = models.find(model => model.id === value?.model);
		// A missing or unavailable saved model returns to Codex's own configuration.
		if (!model) return null;
		let effort = model.efforts.some(option => option.id === value?.effort)
			? value.effort
			: (model.efforts.find(option => option.id === model.defaultEffort) || model.efforts[0]).id;
		return { model: model.id, effort, speed: value?.speed === "fast" && model.fastTier ? "fast" : "standard" };
	}

	function requestOptions(value, models) {
		let selection = normalizeSelection(value, models);
		if (!selection) return {};
		let model = models.find(model => model.id === selection.model);
		return {
			model: selection.model,
			reasoningEffort: selection.effort,
			serviceTier: selection.speed === "fast" ? model.fastTier : "default",
		};
	}

	class ModelPicker {
		constructor({ doc, onChange }) {
			this.doc = doc;
			this.onChange = onChange;
			this.models = [];
			this.defaults = {};
			this.value = null;
			this.element = this._element("div", "aitero-model-picker");
			this.trigger = this._button("", () => this.panel.hidden ? this.open() : this.close());
			this.trigger.classList.add("aitero-model-trigger");
			this.trigger.setAttribute("aria-haspopup", "dialog");
			this.panel = this._element("div", "aitero-model-panel");
			this.panel.id = `aitero-model-panel-${++nextPickerID}`;
			this.panel.setAttribute("role", "dialog");
			this.panel.setAttribute("aria-label", "Choose model, reasoning effort, and speed");
			this.trigger.setAttribute("aria-controls", this.panel.id);
			this.element.append(this.trigger, this.panel);
			this.close();
			this._updateTrigger();
			this.onPointerDown = event => {
				if (!event.composedPath().includes(this.element)) this.close();
			};
			this.doc.addEventListener("pointerdown", this.onPointerDown);
			this.element.addEventListener("focusout", event => {
				if (event.relatedTarget && !this.element.contains(event.relatedTarget)) this.close();
			});
			this.element.addEventListener("keydown", event => this._onKeyDown(event));
		}

		_element(tag, className, text) {
			let node = this.doc.createElementNS(HTML_NS, tag);
			if (className) node.className = className;
			if (text) node.textContent = text;
			return node;
		}

		_button(text, listener) {
			let button = this._element("button", "aitero-button", text);
			button.type = "button";
			// macOS/XUL can move focus outside HTML buttons on mouse-down, dismissing
			// the menu before click fires. Keep focus until the selection is handled.
			button.addEventListener("mousedown", event => event.preventDefault());
			button.addEventListener("click", event => {
				event.stopPropagation();
				listener(event);
			});
			return button;
		}

		setOptions(models, value = null, defaults = {}) {
			this.close();
			this.models = models;
			this.defaults = defaults;
			this.value = normalizeSelection(value, models);
			this._updateTrigger();
		}

		set disabled(value) {
			this.trigger.disabled = value;
			if (value) this.close();
		}

		_updateTrigger() {
			let modelID = this.value?.model || this.defaults.model;
			let model = this.models.find(model => model.id === modelID)
				|| (!modelID && this.models.find(model => model.isDefault));
			let modelName = model?.name || modelID || "Model";
			let name = this._element("span", "aitero-model-name", modelName);
			let summary = this.value
				? `${EFFORT_NAMES[this.value.effort] || this.value.effort} · ${this.value.speed === "fast" ? "Fast" : "Standard"}`
				: "";
			this.trigger.replaceChildren(name, this._element("span", "aitero-model-summary", summary), this._element("span", "aitero-model-chevron", "⌄"));
			this.trigger.title = summary ? `${modelName} · ${summary}` : modelName;
			this.trigger.setAttribute("aria-label", `Model settings: ${this.trigger.title}`);
		}

		open() {
			if (this.trigger.disabled) return;
			let modelID = this.defaults.model || this.models.find(model => model.isDefault)?.id;
			let model = this.models.find(model => model.id === modelID);
			let tier = this.defaults.serviceTier || model?.defaultServiceTier;
			this.draft = { ...(this.value || normalizeSelection({
				model: modelID,
				effort: this.defaults.effort,
				speed: tier === "fast" || tier === "priority" ? "fast" : "standard",
			}, this.models)) };
			this.step = 0;
			this.panel.hidden = false;
			this.trigger.setAttribute("aria-expanded", "true");
			this._renderStep();
		}

		close(restoreFocus = false) {
			this.panel.hidden = true;
			this.trigger.setAttribute("aria-expanded", "false");
			this.draft = null;
			if (restoreFocus) this.trigger.focus();
		}

		_renderStep() {
			this.panel.replaceChildren();
			let steps = ["Model", "Effort", "Speed"];
			let header = this._element("div", "aitero-model-steps");
			steps.forEach((label, index) => {
				if (index) header.append(this._element("span", "aitero-model-separator", "›"));
				let button = this._button(`${index + 1} ${label}`, () => {
					this.step = index;
					this._renderStep();
				});
				button.disabled = index > this.step;
				if (index === this.step) button.setAttribute("aria-current", "step");
				header.append(button);
			});
			let model = this.models.find(model => model.id === this.draft.model);
			let title = ["Choose a model", "Reasoning effort", "Response speed"][this.step];
			let list = this._element("div", "aitero-model-options");
			list.setAttribute("role", "group");
			list.setAttribute("aria-label", title);
			let options = this.step === 0 ? this.models : this.step === 1 ? model.efforts : [
				{ id: "standard", name: "Standard" },
				{ id: "fast", name: "Fast", disabled: !model.fastTier },
			];
			let key = ["model", "effort", "speed"][this.step];
			for (let option of options) {
				let button = this._button("", () => {
					this.draft = normalizeSelection({ ...this.draft, [key]: option.id }, this.models);
					if (this.step < 2) {
						this.step++;
						this._renderStep();
					}
					else {
						this.value = { ...this.draft };
						this._updateTrigger();
						this.close(true);
						this.onChange?.({ ...this.value });
					}
				});
				button.classList.add("aitero-model-option");
				button.disabled = Boolean(option.disabled);
				let selected = option.id === (this.draft[key] ?? null);
				button.setAttribute("aria-pressed", String(selected));
				button.title = option.disabled ? "Fast is not available for this model" : option.name;
				let text = this._element("span", "aitero-model-option-name", option.name);
				let indicator = this._element("span", "aitero-model-indicator", selected ? "✓" : this.step < 2 && option.id ? "›" : "");
				indicator.setAttribute("aria-hidden", "true");
				button.append(text, indicator);
				list.append(button);
			}
			this.panel.append(header, this._element("div", "aitero-model-heading", title), list);
			if (!this.models.length) {
				this.panel.append(this._element("div", "aitero-model-empty", "Models unavailable. Codex defaults still apply."));
			}
			(list.querySelector('[aria-pressed="true"]:not(:disabled)') || list.querySelector("button:not(:disabled)"))?.focus();
		}

		_onKeyDown(event) {
			if (event.key === "Escape" && !this.panel.hidden) {
				event.preventDefault();
				event.stopPropagation();
				this.close(true);
				return;
			}
			if (event.target === this.trigger && ["ArrowDown", "ArrowUp"].includes(event.key)) {
				event.preventDefault();
				this.open();
				return;
			}
			if (this.panel.hidden || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
			let buttons = Array.from(this.panel.querySelectorAll(".aitero-model-option:not(:disabled)"));
			let index = buttons.indexOf(event.target);
			if (index < 0) return;
			event.preventDefault();
			let next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
				: (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
			buttons[next]?.focus();
		}

		getRequestOptions() {
			return requestOptions(this.value, this.models);
		}

		destroy() {
			this.doc.removeEventListener("pointerdown", this.onPointerDown);
			this.element.remove();
		}
	}

	return { ModelPicker, fromCodexModels, normalizeSelection, requestOptions };
})();

if (typeof module !== "undefined") module.exports = AIteroModels;
