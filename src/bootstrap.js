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
	Services.scriptloader.loadSubScript(`${rootURI}content/session.js`);
	Services.scriptloader.loadSubScript(`${rootURI}content/codex.js`);
	Services.scriptloader.loadSubScript(`${rootURI}content/model-picker.js`);
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
	Services.prefs.deleteBranch("extensions.aitero-assistant.");
	log("uninstalled");
}
