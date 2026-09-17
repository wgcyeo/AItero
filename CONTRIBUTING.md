# Contributing to AItero

Contributions should preserve the plugin's narrow read-only scope, Zotero 10-or-later compatibility, and local credential model.

## Development environment

Required:

- macOS for Zotero integration testing;
- Zotero 10.0.x from the Homebrew cask;
- Node.js 18 or newer; and
- npm with the committed lockfile.

Set up a checkout:

```sh
gh repo clone wgcyeo/AItero
cd AItero
npm ci
npm run verify
```

## Branches and commits

- Create a short-lived branch from `main`.
- Keep commits focused and reviewable.
- Use imperative commit subjects.
- Do not combine unrelated refactoring with a behavior change.
- Never commit a credential, `.env` file, Zotero profile, Zotero database, downloaded private PDF, or generated XPI.

Example:

```sh
git switch -c fix/citation-navigation
git add src tests
git commit -m "Handle citation navigation failures"
```

## English-only repository

All tracked user-facing text, comments, fixtures, tests, and documentation must be English.

Run:

```sh
npm run check:english
```

The check scans tracked-style text in the working tree and fails if it finds Hangul characters. Binary assets, dependencies, Git metadata, and build output are excluded.

The model may still answer in the language used by the user's question; this is an output behavior, not a localized repository string.

## Tests

Run the complete suite:

```sh
npm test
```

Tests must remain deterministic and network-free. The suite covers:

- PDF page-boundary validation, including blank pages;
- page-local overlapping chunks;
- BM25 and broad-query retrieval caps;
- citation-ID allowlisting;
- exactly-once history commit;
- cancellation and failure history invariants;
- Codex JSONL framing, browser-login delegation, and ephemeral turn policy;
- always-available, model-invoked web search and parallel agents with blocked-tool fail-closed behavior;
- UI scrolling and safe Markdown structure;
- local untrusted KaTeX rendering; and
- model selection, saved settings, and ChatGPT-only authentication.

Live smoke tests belong in an isolated Zotero profile and must use a public document.

## Code boundaries

Keep responsibilities separated:

- `src/content/pdf.js` — pure PDF page, chunk, retrieval, cache, and citation logic;
- `src/content/session.js` — typed errors and in-memory conversation transactions;
- `src/content/codex.js` — Codex App Server lifecycle, authentication delegation, JSONL protocol, and agent-tool policy;
- `src/content/compat.js` — validated internal PDF and Reader adapters;
- `src/content/assistant.js` — Zotero UI, lifecycle, sign-in status, and orchestration;
- `src/content/model-picker.js` — model catalogs, supported settings, and the sequential selection UI;
- `src/content/style.css` — pane layout and rendering styles; and
- `src/locale/en-US/aitero.ftl` — UI strings.

Do not spread version-specific Zotero internals outside `compat.js` unless no practical isolation is possible.

## Read-only guarantee

Changes must not write to Zotero library content. Do not add calls that save or modify:

- items;
- fields;
- notes;
- tags;
- collections;
- attachments;
- annotations; or
- sync state.

Persistent plugin-owned values are non-secret model, effort, and speed selections. Uninstall clears the entire plugin preference branch, including legacy preferences.

## UI changes

UI changes must preserve:

- the native custom item-pane registration;
- a full-height layout when the assistant section opens;
- a fixed composer;
- an independently scrolling conversation;
- no paper-title metadata row for a valid active PDF;
- explicit cancellation;
- safe text/Markdown rendering without arbitrary HTML; and
- keyboard submission with `Cmd/Ctrl+Enter`.

Add or update source-level UI tests for structural invariants that cannot be exercised in Node DOM tests.

## Codex changes

Never serialize or log credentials, paper excerpts, or complete request bodies.

Preserve unless a reviewed change explicitly requires otherwise:

- ChatGPT-only authentication before starting a turn;
- authentication through App Server rather than direct token-file or keychain access;
- an ephemeral thread per AItero request;
- an empty temporary working directory;
- read-only sandboxing with no approvals;
- command-line and per-thread shell, MCP, hook, history, and memory restrictions;
- no automatic retry;
- a three-child maximum for parallel agents; and
- immediate interruption and no history commit if a blocked active tool appears.

## Packaging

Build the XPI twice before requesting review:

```sh
npm run package
cp dist/aitero-assistant-1.0.0.xpi /tmp/aitero-first.xpi
npm run package
cmp /tmp/aitero-first.xpi dist/aitero-assistant-1.0.0.xpi
```

The packaging script must continue to produce byte-identical output from identical source.

## Pull-request checklist

- [ ] The change is within the read-only one-PDF scope.
- [ ] `npm ci` succeeds from a clean checkout.
- [ ] `npm run check:english` passes.
- [ ] `npm test` passes.
- [ ] Two package builds are byte-identical.
- [ ] The XPI checksum sidecar validates.
- [ ] No credentials or private document content appear in the diff.
- [ ] Relevant documentation is updated.
- [ ] Zotero 10.0.x integration was tested in an isolated profile when UI or compatibility code changed.
