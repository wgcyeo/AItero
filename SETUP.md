# AItero Assistant Setup Guide

This guide covers installation from a private GitHub Release, building from source, Codex ChatGPT sign-in, normal Dock/Finder launching, isolated-profile testing, upgrades, rollback, and troubleshooting.

## 1. Supported configuration

AItero 4.0.0 requires Zotero 10 or later.

| Component | Supported value |
| --- | --- |
| Operating system | macOS |
| Zotero distribution | Homebrew cask `zotero` |
| Zotero version | `10.0` and later |
| CPU | Apple Silicon or Intel |
| Node.js for builds | 18 or newer; CI uses Node.js 22 |
| Authentication | Codex CLI with ChatGPT sign-in |
| Initial model settings | Inherited from the local Codex configuration |
| Plugin UI | English |

Zotero 9 and earlier are unsupported. Installation is allowed on Zotero 10 and later, with no upper version cap. Zotero 10.0.2 is the validated runtime; future releases still need integration testing because page-text extraction uses internal APIs. Unsupported page data produces an extraction error instead of unverified citations.

## 2. Choose an installation path

There are two supported paths.

### Release installation

Use this path when you only want to run AItero.

1. Open the private repository's **Releases** page while signed in to GitHub.
2. Open release `v4.0.0`.
3. Download:

   - `aitero-assistant-4.0.0.xpi`
   - `aitero-assistant-4.0.0.xpi.sha256`

4. Verify the XPI before installing it.

### Source installation

Use this path when you want to audit, modify, test, or reproduce the package.

```sh
gh auth status
gh repo clone wgcyeo/AItero
cd AItero
npm ci
npm run verify
```

The repository is private. The GitHub account used by `gh` must have access.

## 3. Install or verify Zotero

Check the existing Homebrew installation:

```sh
brew list --cask zotero
brew info --cask zotero
/usr/libexec/PlistBuddy \
  -c 'Print :CFBundleShortVersionString' \
  /Applications/Zotero.app/Contents/Info.plist
```

The final command must print a version of `10.0` or later. If Zotero is not installed and this Mac is intended to use the Homebrew distribution, install it with:

```sh
brew install --cask zotero
```

## 4. Install build prerequisites

Release users do not need Node.js. Source users need Node.js 18 or later and npm.

```sh
node --version
npm --version
```

Install Node.js with the preferred version manager or Homebrew if it is missing. The GitHub workflows use Node.js 22.

Optional synthetic PDF fixtures require `uv`:

```sh
uv --version
npm run fixtures
```

`npm run fixtures` creates deterministic text and image-only PDFs under `tests/fixtures/`. Those files are ignored by Git because they can be regenerated.

## 5. Install locked dependencies

Use `npm ci`, not `npm install`, for a clean reproducible checkout:

```sh
npm ci
```

The only runtime asset dependency is the pinned KaTeX distribution. The build copies its browser bundle, fonts, and MIT license into `src/vendor/katex/`. A packaged XPI does not load scripts, fonts, or stylesheets from a CDN.

## 6. Sign in to Codex with ChatGPT

AItero requires Codex authenticated with ChatGPT. If Codex is unavailable or signed out, the panel shows installation or sign-in instructions before accepting a question.

Install the Codex CLI using the [official Codex setup instructions](https://learn.chatgpt.com/docs/codex-cli), then verify it without exposing account details:

```sh
codex --version
codex login status
```

If needed, run `codex login`, or use **Sign in to Codex** in AItero when it appears. The browser flow and credential cache belong to Codex; AItero never reads `~/.codex/auth.json`, copies tokens, or stores them in Zotero.

The plugin looks for Codex in this order:

1. the absolute executable path in `CODEX_PATH`;
2. `/opt/homebrew/bin/codex`;
3. `/usr/local/bin/codex`; and
4. `codex` on Zotero's inherited `PATH`.

Codex requests run in fresh ephemeral App Server threads rooted at an empty temporary directory. The parent and its subagents use a read-only sandbox with no shell, file changes, MCP, connectors, image tools, or approval requests. These settings, including `approvalPolicy: "never"`, are sent by AItero on every request and do not depend on a particular machine's `~/.codex/config.toml`.

AItero initially leaves model, reasoning effort, and speed unset so Codex uses its own configuration. The picker lists models returned by Codex without a separate default option. Complete the model, effort, and speed choices to save explicit settings for subsequent questions. Codex research agents use the active configuration.

Web search and parallel research agents are always available in Codex mode, and the model is instructed to use them only when useful. Web search can send model-generated queries beyond the supplied PDF context; do not send sensitive papers if that exposure is unacceptable. Parallel research is capped at three child agents, and they inherit the parent sandbox.

## 7. Verify the XPI checksum

From a source build:

```sh
npm run package
cd dist
shasum -a 256 aitero-assistant-4.0.0.xpi
cat aitero-assistant-4.0.0.xpi.sha256
```

The two digests must match exactly.

For a downloaded Release asset, place the XPI and sidecar in the same directory and run:

```sh
cd /path/to/downloads
shasum -a 256 aitero-assistant-4.0.0.xpi
cat aitero-assistant-4.0.0.xpi.sha256
```

Do not install an XPI whose digest differs from the published sidecar.

## 8. Install the plugin in Zotero

The XPI is locally built and unsigned. Install it only when it came from the private Release or a trusted source checkout.

1. Fully close active PDF Reader tabs if they contain unsaved annotation edits.
2. Open Zotero.
3. Choose **Tools → Plugins**.
4. Open the tools menu in the Plugins Manager.
5. Choose **Install Plugin From File…**.
6. Select `aitero-assistant-4.0.0.xpi`.
7. Confirm that **AItero Assistant 4.0.0** appears and is enabled.
8. Fully quit Zotero.
9. Reopen Zotero normally.

The plugin is restartless, but a full restart is still required for a clean validation of startup, Codex discovery, and window lifecycle hooks.

## 9. First-run validation

Use a public or otherwise non-confidential PDF for the first request.

1. Select exactly one Zotero item with a local PDF attachment, or open one PDF in the Reader.
2. Click the **AI Assistant** icon in the right sidebar.
3. Confirm that the panel starts directly with the chat welcome screen. No paper-title metadata row should appear.
4. Confirm that the bottom-left status shows **Ready · Codex**. The model button above the question field shows the model from Codex configuration, or your saved model, effort, and speed. Click it to choose **Model → Effort → Standard / Fast**; the final choice is saved for future questions. If Codex asks for authentication, use **Sign in to Codex** and finish in the browser.
5. Ask a narrowly scoped question such as:

   ```text
   What is the main contribution? Cite the supporting pages.
   ```

6. Confirm that output streams incrementally.
7. Confirm that citations appear as `[PDF N]` buttons.
8. Click a citation and confirm that Zotero opens the expected PDF file page.
9. Ask for an equation or mathematical explanation and confirm that inline and block mathematics render.
10. Scroll upward during a long response and confirm that the panel does not force the scroll position back to the bottom. Use **Latest ↓** to return.
11. Close the AI section and reopen it. The previous conversation must be gone.

Do not use a confidential document until the OpenAI account's data controls and the local plugin trust model have been reviewed.

## 10. Isolated-profile smoke testing

Never point a development smoke test at the production Zotero data directory.

Fully quit Zotero, then create a temporary profile and data directory:

```sh
TEST_ROOT="$(mktemp -d /private/tmp/aitero-zotero.XXXXXX)"
mkdir -p "$TEST_ROOT/profile" "$TEST_ROOT/data"
/Applications/Zotero.app/Contents/MacOS/zotero \
  -profile "$TEST_ROOT/profile" \
  -datadir "$TEST_ROOT/data"
```

In that isolated instance:

1. Do not sign in to Zotero Sync.
2. Install the XPI through **Tools → Plugins**.
3. Restart the same isolated profile.
4. Import only public synthetic or test PDFs.
5. Verify installation, disabling, enabling, removal, and reinstallation.
6. Run at most one real OpenAI smoke request if network validation is required.

After testing, fully quit the isolated Zotero instance. Move the test root to the Trash rather than deleting an ambiguous path:

```sh
mv "$TEST_ROOT" ~/.Trash/
```

Before moving anything, print and verify the exact value of `TEST_ROOT`. Never use a broad path such as the home directory, `/Users`, `/private/tmp`, or the production Zotero data directory as a cleanup target.

## 11. Normal usage

- Reader mode uses the PDF currently open in the selected Reader tab.
- Library mode uses a selected PDF attachment, or the best available local PDF attached to one selected bibliographic item.
- Zero selections, multiple selections, non-item rows, missing local files, and items without PDFs do not send requests.
- Press `Cmd+Enter` or `Ctrl+Enter` to submit.
- **Cancel** aborts extraction or network streaming.
- **Retry** is always explicit; AItero never retries automatically.
- **New chat** clears the in-memory conversation.
- Click the model button to choose a model, its reasoning effort, then **Standard** or **Fast**. The selection applies to the next question and survives new chats and restarts. Escape or clicking outside discards an unfinished selection. The controls are disabled during a request.
- Codex must be signed in with ChatGPT before a question can be sent.

The plugin reads Zotero data but does not write items, notes, tags, attachments, annotations, collections, or sync state.

## 12. Data sent to OpenAI

Submitting a question through Codex sends:

- the user question;
- all extracted PDF text when the serialized page chunks total at most 750,000 characters;
- selected excerpts only for an oversized-document fallback;
- successful previous turns in the same panel session.

It does not send the entire library, Zotero account credentials, collection names, tags, notes, or unrelated PDFs. The full-paper prefix is resent for each request but is not duplicated inside the in-memory conversation history.

AItero sends the paper and conversation input through a local `codex app-server` process. Each request uses an ephemeral thread, disables App Server history and memory for that thread, and unsubscribes at completion. Codex owns its ChatGPT credential cache.

These controls are not equivalent to organization-level Zero Data Retention or Modified Abuse Monitoring. Review the data controls applicable to the ChatGPT account before sending confidential documents.

When the model uses web search, Codex may additionally send generated search queries. AItero instructs it not to put verbatim PDF excerpts, chunk IDs, local paths, personal identifiers, or confidential paper details into queries. This is a model-level instruction, not a hard data-loss-prevention guarantee. Web claims are rendered as HTTPS links and remain separate from locally validated PDF citations.

## 13. Upgrade procedure

Private GitHub Release assets cannot be fetched automatically by Zotero without authentication. AItero 4.0.0 therefore uses manual updates.

1. Download the new XPI and checksum sidecar from the private Release.
2. Verify the checksum.
3. Confirm that Codex is installed and signed in with ChatGPT.
4. Open **Tools → Plugins**.
5. Install the new XPI over the existing version.
6. Restart Zotero.
7. Confirm the version and run the first-run validation steps.

The manifest contains an inert `.invalid` update URL required by the Zotero plugin manifest format. No secret or GitHub token is embedded in the XPI.

## 14. Uninstall and rollback

Normal removal:

1. Open **Tools → Plugins**.
2. Open **AItero Assistant**.
3. Choose **Remove**.
4. Fully restart Zotero.

Uninstalling clears saved model settings and all other plugin-owned preferences. Codex login remains in its own credential store because AItero does not own or write credentials.

If normal Zotero UI startup fails:

1. Fully quit Zotero.
2. Hold the Option key while launching Zotero to enter Troubleshooting Mode.
3. Open **Tools → Plugins**.
4. Remove only **AItero Assistant**.
5. Restart Zotero normally.

AItero does not modify the Zotero database, so there is no database migration or data rollback step.

## 15. Troubleshooting

### Codex CLI was not found

- Run `codex --version` in Terminal.
- On Apple Silicon Homebrew, confirm `/opt/homebrew/bin/codex` exists.
- On Intel Homebrew, confirm `/usr/local/bin/codex` exists.
- For another installation location, start Zotero with `CODEX_PATH` set to the absolute executable path.
- Fully restart Zotero after installing or moving Codex.

### Codex sign-in is required

- Click **Sign in** in the AItero composer and finish the browser flow.
- Alternatively run `codex login`, then reopen the panel.
- Use `codex login status` to check the CLI without printing credentials.
- Workspace policy can restrict ChatGPT login or model access; contact the workspace administrator if authentication succeeds but turns remain unauthorized.

### The AI Assistant icon is missing

- Confirm Zotero is `10.0` or later.
- Confirm the plugin is enabled under **Tools → Plugins**.
- Confirm exactly one standard item or PDF is selected.
- Restart Zotero after installing or updating the XPI.
- If the plugin is absent from the manager, reinstall the XPI and confirm the checksum first.

### A PDF is reported as missing

- Open the attachment directly in Zotero.
- Use Zotero's attachment location tools to download or relink the file.
- If an item has multiple PDFs, confirm at least one local PDF exists.

### OCR is required

The PDF contains no extractable text. Run OCR outside AItero or use Zotero's supported OCR workflow, then reopen the attachment. AItero does not perform OCR.

### Only some pages are available

The plugin detected a partially extractable PDF. It sends only pages containing text and displays an `X/Y` coverage warning. Page mapping remains based on PDF file order.

### Citation buttons do not navigate

- Confirm the attachment still exists locally.
- Confirm Zotero is `10.0` or later.
- Reopen the PDF and retry the citation.
- A citation uses PDF file page order, not the printed page label.

### Codex usage limit reached

Wait for usage to become available, then use **Retry**. AItero does not retry automatically.

### Codex connection failed

Check that Codex is installed, signed in with ChatGPT, and able to connect. Use **Retry** only after deciding to send the question again; an interrupted request might already have consumed usage.

### Stream inactivity timeout

AItero cancels a stream after 180 seconds without data. The partial output remains visible but is not committed to follow-up history.

### UI scrolling is incorrect

The composer should remain fixed at the bottom while only the conversation scrolls. If streaming begins while the user is near the bottom, AItero follows the output. Once the user scrolls upward, automatic following stops. **Latest ↓** restores bottom pinning.

## 16. Developer verification checklist

Before sharing an XPI:

```sh
npm ci
npm run check:english
npm test
npm run package
npm run package
```

Then verify:

- all tests pass;
- no Hangul remains in tracked text;
- the two consecutive XPI builds are byte-identical;
- the SHA-256 sidecar validates;
- the XPI contains no `.env` file, credential, Git metadata, or test PDF;
- both English Fluent attributes load;
- installation succeeds in an isolated profile;
- normal Dock/Finder launch reaches **Ready · Codex** with ChatGPT sign-in;
- one public-document request completes in an ephemeral read-only Codex thread; and
- no request is made with a private user-library PDF during release validation.

Release maintainers should continue with [RELEASING.md](RELEASING.md).
