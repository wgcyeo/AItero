# AItero Assistant Setup Guide

This guide covers installation from a private GitHub Release, building from source, secure API-key configuration, normal Dock/Finder launching, isolated-profile testing, upgrades, rollback, and troubleshooting.

## 1. Supported configuration

AItero 0.1.0 is intentionally narrow and version-pinned.

| Component | Supported value |
| --- | --- |
| Operating system | macOS |
| Zotero distribution | Homebrew cask `zotero` |
| Zotero version | `9.0` through `9.0.*` |
| CPU | Apple Silicon or Intel |
| Node.js for builds | 18 or newer; CI uses Node.js 22 |
| OpenAI API | Responses API with streaming |
| Default model | `gpt-5.6-luna` |
| Plugin UI | English |

Do not install this release on Zotero 10 or later. The public item-pane integration is stable, but the page-text compatibility adapter is explicitly tied to Zotero 9 internals.

## 2. Choose an installation path

There are two supported paths.

### Release installation

Use this path when you only want to run AItero.

1. Open the private repository's **Releases** page while signed in to GitHub.
2. Open release `v0.1.0`.
3. Download:

   - `aitero-assistant-0.1.0.xpi`
   - `aitero-assistant-0.1.0.xpi.sha256`

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

The final command must print a `9.0.x` version. If Zotero is not installed and this Mac is intended to use the Homebrew distribution, install it with:

```sh
brew install --cask zotero
```

Do not keep two Zotero application bundles. The included launcher only uses:

```text
/Applications/Zotero.app/Contents/MacOS/zotero
```

The launcher verifies that this application is managed by the Homebrew cask before starting it.

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

## 6. Configure the OpenAI API key

### Recommended configuration for normal app launching

Add one literal assignment to `~/.zshrc`:

```sh
export OPENAI_API_KEY='your-api-key'
```

Optional model override:

```sh
export OPENAI_MODEL='gpt-5.6-luna'
```

Then restrict the shell file to the current user:

```sh
chmod 600 ~/.zshrc
```

AItero can now find the key even when Zotero is opened from the Dock, Finder, Spotlight, or a document association.

### Bash alternative

If the key is not present in `~/.zshrc`, AItero checks `~/.bashrc`:

```sh
export OPENAI_API_KEY='your-api-key'
```

Use:

```sh
chmod 600 ~/.bashrc
```

### Resolution order

Every request resolves configuration in this order:

1. `OPENAI_API_KEY` or `OPENAI_MODEL` inherited by the Zotero process.
2. A supported literal assignment in `~/.zshrc`.
3. A supported literal assignment in `~/.bashrc`.
4. The built-in model default, only for `OPENAI_MODEL`.

An inherited environment variable therefore overrides an rc-file assignment.

### Accepted syntax

The parser accepts only static values:

```sh
export OPENAI_API_KEY='sk-example'
OPENAI_API_KEY="sk-example"
OPENAI_API_KEY=sk-example
export OPENAI_MODEL='gpt-5.6-luna'
```

The last valid assignment within a file wins. The first file that contains a valid value wins.

### Rejected syntax

AItero deliberately rejects dynamic shell syntax:

```sh
export OPENAI_API_KEY="$OTHER_SECRET"
export OPENAI_API_KEY="$(security find-generic-password -w)"
export OPENAI_API_KEY=`some-command`
source ~/.private-api-keys
```

The plugin reads the rc file as UTF-8 text. It never starts a shell, sources the file, expands variables, executes command substitutions, or logs the file contents. Files larger than 1 MB are ignored.

### Confirm detection without exposing the key

From a source checkout, run:

```sh
npm run check:config
```

The command prints only where a supported key was found. It never prints the key, its prefix, or its length.

### Security trade-off

An rc file is a plaintext file. The key can be read by processes running as the same macOS user and by other privileged Zotero plugins. This approach is intended for a trusted personal Mac account.

Never:

- commit the key;
- put it in `.env` and force-add that file;
- paste it into an issue, pull request, Release note, screenshot, or debug log;
- share one personal key across multiple users; or
- install untrusted Zotero plugins alongside AItero.

Use a dedicated project API key, configure an appropriate budget, monitor usage, and rotate the key if exposure is suspected.

## 7. Environment-only launch option

Users who do not want a key in a shell startup file can continue to use the included launcher.

First fully quit Zotero. Then, in a terminal whose environment contains the key:

```sh
export OPENAI_API_KEY='your-api-key'
./scripts/launch-zotero-with-openai.sh
```

The launcher:

- requires a non-empty key;
- requires the Homebrew `zotero` cask;
- requires Zotero `9.0.x`;
- refuses to terminate an already-running Zotero process; and
- executes the Homebrew application binary directly without printing the key.

If Zotero is already running, quit it normally and rerun the command. A second process cannot replace the environment of the existing process.

## 8. Verify the XPI checksum

From a source build:

```sh
npm run package
cd dist
shasum -a 256 aitero-assistant-0.1.0.xpi
cat aitero-assistant-0.1.0.xpi.sha256
```

The two digests must match exactly.

For a downloaded Release asset, place the XPI and sidecar in the same directory and run:

```sh
cd /path/to/downloads
shasum -a 256 aitero-assistant-0.1.0.xpi
cat aitero-assistant-0.1.0.xpi.sha256
```

Do not install an XPI whose digest differs from the published sidecar.

## 9. Install the plugin in Zotero

The XPI is locally built and unsigned. Install it only when it came from the private Release or a trusted source checkout.

1. Fully close active PDF Reader tabs if they contain unsaved annotation edits.
2. Open Zotero.
3. Choose **Tools → Plugins**.
4. Open the tools menu in the Plugins Manager.
5. Choose **Install Plugin From File…**.
6. Select `aitero-assistant-0.1.0.xpi`.
7. Confirm that **AItero Assistant 0.1.0** appears and is enabled.
8. Fully quit Zotero.
9. Reopen Zotero normally.

The plugin is restartless, but a full restart is still required for a clean validation of startup, environment resolution, and window lifecycle hooks.

## 10. First-run validation

Use a public or otherwise non-confidential PDF for the first request.

1. Select exactly one Zotero item with a local PDF attachment, or open one PDF in the Reader.
2. Click the **AI Assistant** icon in the right sidebar.
3. Confirm that the panel starts directly with the chat welcome screen. No paper-title metadata row should appear.
4. Confirm that the bottom-left status changes from **Checking API key…** to **Ready**.
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

## 11. Isolated-profile smoke testing

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

## 12. Normal usage

- Reader mode uses the PDF currently open in the selected Reader tab.
- Library mode uses a selected PDF attachment, or the best available local PDF attached to one selected bibliographic item.
- Zero selections, multiple selections, non-item rows, missing local files, and items without PDFs do not send requests.
- Press `Cmd+Enter` or `Ctrl+Enter` to submit.
- **Cancel** aborts extraction or network streaming.
- **Retry** is always explicit; AItero never retries automatically.
- **New chat** clears the in-memory conversation.

The plugin reads Zotero data but does not write items, notes, tags, attachments, annotations, collections, or sync state.

## 13. Data sent to OpenAI

Submitting a question sends:

- the user question;
- all extracted PDF text when the serialized page chunks total at most 750,000 characters;
- selected excerpts only for an oversized-document fallback;
- successful previous turns in the same panel session; and
- a random `safety_identifier`.

It does not send the entire library, Zotero account credentials, collection names, tags, notes, or unrelated PDFs. The full-paper prefix is resent for each request but is not duplicated inside the in-memory conversation history.

The request uses:

```json
{
  "model": "gpt-5.6-luna",
  "reasoning": {
    "effort": "medium",
    "context": "all_turns"
  },
  "max_output_tokens": 8192,
  "stream": true,
  "store": false
}
```

The actual request also contains the input, instructions, and a random safety identifier. The plugin sends the API key only in the HTTPS `Authorization` header.

`store: false` prevents the Responses object from being stored for later API retrieval. It does not itself grant Zero Data Retention or disable every abuse-monitoring log. Those controls depend on the OpenAI organization and project.

## 14. Upgrade procedure

Private GitHub Release assets cannot be fetched automatically by Zotero without authentication. AItero 0.1.0 therefore uses manual updates.

1. Download the new XPI and checksum sidecar from the private Release.
2. Verify the checksum.
3. Fully quit and reopen Zotero if it was launched with a temporary environment-only key.
4. Open **Tools → Plugins**.
5. Install the new XPI over the existing version.
6. Restart Zotero.
7. Confirm the version and run the first-run validation steps.

The manifest contains an inert `.invalid` update URL because Zotero 9 requires the field. No secret or GitHub token is embedded in the XPI.

## 15. Uninstall and rollback

Normal removal:

1. Open **Tools → Plugins**.
2. Open **AItero Assistant**.
3. Choose **Remove**.
4. Fully restart Zotero.

Uninstalling clears the plugin's random `safety_identifier` preference. The API key remains in the environment or shell startup file because AItero never owns or writes it.

If normal Zotero UI startup fails:

1. Fully quit Zotero.
2. Hold the Option key while launching Zotero to enter Troubleshooting Mode.
3. Open **Tools → Plugins**.
4. Remove only **AItero Assistant**.
5. Restart Zotero normally.

AItero does not modify the Zotero database, so there is no database migration or data rollback step.

## 16. Troubleshooting

### The status remains “OPENAI_API_KEY is missing”

- Run `npm run check:config` from the source checkout.
- Confirm the assignment is in `~/.zshrc` or `~/.bashrc`, not only `.zprofile`, `.bash_profile`, `.env`, or another sourced file.
- Confirm the value is a direct literal, not `$VARIABLE`, `$(command)`, or a backtick expression.
- Confirm the file is UTF-8 and smaller than 1 MB.
- Confirm the line is not commented out.
- If multiple assignments exist, remember that the last valid assignment in the first matching file wins.
- Fully restart Zotero after changing the plugin version. The key itself is reread on each request.

### The AI Assistant icon is missing

- Confirm Zotero is `9.0.x`.
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
- Confirm Zotero is `9.0.x`.
- Reopen the PDF and retry the citation.
- A citation uses PDF file page order, not the printed page label.

### HTTP 401

The key was rejected. Verify that the detected key is current, belongs to the intended project, and has permission to call the selected model. Rotate the key if it may have been exposed.

### HTTP 429

The project reached a rate, quota, or budget limit. AItero does not retry automatically. Check the OpenAI project limits before using **Retry**.

### HTTP 5xx or network failure

Check network access and OpenAI service status. Use **Retry** only after deciding to send the question again; a disconnected request might already have consumed tokens.

### Stream inactivity timeout

AItero cancels a stream after 180 seconds without data. The partial output remains visible but is not committed to follow-up history.

### UI scrolling is incorrect

The composer should remain fixed at the bottom while only the conversation scrolls. If streaming begins while the user is near the bottom, AItero follows the output. Once the user scrolls upward, automatic following stops. **Latest ↓** restores bottom pinning.

## 17. Developer verification checklist

Before sharing an XPI:

```sh
npm ci
npm run check:english
npm run check:config
npm test
npm run package
npm run package
```

Then verify:

- all tests pass;
- no Hangul remains in tracked text;
- the two consecutive XPI builds are byte-identical;
- the SHA-256 sidecar validates;
- the XPI contains no `.env` file, API key, Git metadata, or test PDF;
- both English Fluent attributes load;
- installation succeeds in an isolated profile;
- normal Dock/Finder launch reaches **Ready** using the safe rc-file parser; and
- no request is made with a private user-library PDF during release validation.

Release maintainers should continue with [RELEASING.md](RELEASING.md).
