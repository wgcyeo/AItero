var AIteroAssistant;
var AIteroCodex;

function log(message) {
	Zotero.debug(`AItero Assistant: ${message}`);
}

function install() {
	log("installed");
}

async function startup({ id, version, rootURI }) {
	await Zotero.initializationPromise;
	Services.scriptloader.loadSubScript(`${rootURI}content/pdf.js`);
	Services.scriptloader.loadSubScript(`${rootURI}content/compat.js`);
	Services.scriptloader.loadSubScript(`${rootURI}content/openai.js`);
	Services.scriptloader.loadSubScript(`${rootURI}content/codex.js`);
	Services.scriptloader.loadSubScript(`${rootURI}content/assistant.js`);

	AIteroCodex.configure({ version });
	await AIteroAssistant.init({ id, version, rootURI });
	AIteroAssistant.addToAllWindows();
	log(`started ${version}`);
}

function onMainWindowLoad({ window }) {
	AIteroAssistant?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	AIteroAssistant?.removeFromWindow(window);
}

async function shutdown() {
	AIteroAssistant?.shutdown();
	await AIteroCodex?.shutdown();
	AIteroAssistant = undefined;
	AIteroCodex = undefined;
	log("stopped");
}

function uninstall() {
	for (let name of [
		"extensions.aitero-assistant.safetyIdentifier",
		"extensions.aitero-assistant.provider",
		"extensions.aitero-assistant.webSearch",
		"extensions.aitero-assistant.parallelAgents",
	]) {
		try {
			Services.prefs.clearUserPref(name);
		}
		catch (_error) {
			// The preference does not exist.
		}
	}
	log("uninstalled");
}
