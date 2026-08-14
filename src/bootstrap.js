var AIteroAssistant;

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
	Services.scriptloader.loadSubScript(`${rootURI}content/assistant.js`);

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

function shutdown() {
	if (!AIteroAssistant) return;
	AIteroAssistant.shutdown();
	AIteroAssistant = undefined;
	log("stopped");
}

function uninstall() {
	try {
		Services.prefs.clearUserPref("extensions.aitero-assistant.safetyIdentifier");
	}
	catch (_error) {
		// The preference does not exist.
	}
	log("uninstalled");
}
