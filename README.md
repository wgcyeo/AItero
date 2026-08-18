# AItero Assistant

AItero Assistant is a local Zotero 10 plugin that adds a full-height AI chat section to the library item pane and the PDF Reader sidebar. It answers questions about the currently selected PDF, streams the response, renders safe Markdown and LaTeX, and turns validated citations into buttons that open the corresponding PDF page.

The plugin does not modify Zotero items, notes, tags, collections, attachments, or the Zotero database. It does not require a Zotero fork, an OpenAI SDK, or a local web server.

## At a glance

- Plugin ID: `aitero-assistant@local`
- Version: `0.3.0`
- License: Apache-2.0
- Supported Zotero versions: `10.0` through `10.0.*`
- Validated platform: macOS with the Homebrew `zotero` cask
- API-key default: `gpt-5.6-luna`, medium reasoning
- Codex default: `gpt-5.6-sol`, xhigh reasoning, fast service tier
- Maximum output: 8,192 tokens
- Providers: OpenAI API key or local Codex CLI with ChatGPT sign-in
- API-key transport: `POST https://api.openai.com/v1/responses`, with `store: false`
- Codex transport: local `codex app-server` over stdio, using ephemeral threads
- UI language: English

## Features

- Native Zotero item-pane section and sidebar icon.
- One-paper chat with follow-up questions while the panel remains open.
- Full-height layout with a fixed composer and independently scrolling conversation.
- Streaming output with explicit cancellation and no automatic retries.
- Safe Markdown rendering for headings, ordered and unordered lists, tables, and code.
- Local KaTeX rendering for inline and block mathematics; no CDN is used.
- Full extracted-paper context by default, with retrieval only for oversized PDFs.
- Cross-language questions work without requiring lexical overlap with the PDF.
- Validated `[[cite:<chunk-id>]]` markers rendered as clickable `[PDF N]` buttons.
- Selectable message text and user-initiated Markdown chat export with readable PDF page citations.
- In-memory LRU cache for at most three PDFs; no plugin-owned disk index.
- Automatic key discovery from the process environment, `~/.zshrc`, or `~/.bashrc`.
- Codex-first provider that delegates authentication to the installed Codex CLI; AItero never reads or stores its tokens.
- Model-invoked live web search and up to three parallel research agents, available automatically when useful in Codex mode.
- Read-only Codex sandbox with shell, file changes, MCP, connectors, and approval requests blocked.
- Codex fast mode for roughly 1.5× model speed; GPT-5.6 fast consumes 2.5× Standard ChatGPT credits.

## Quick start

For complete installation, privacy, development, and troubleshooting instructions, read [SETUP.md](SETUP.md).

1. Download both assets from the private GitHub Release:

   - `aitero-assistant-0.3.0.xpi`
   - `aitero-assistant-0.3.0.xpi.sha256`

2. Configure the preferred Codex provider or the API-key fallback:

   - Install Codex and run `codex login`; or
   - put a literal API-key assignment in `~/.zshrc` as a fallback:

   ```sh
   export OPENAI_API_KEY='your-api-key'
   ```

   AItero reads this file as text. It never sources or executes shell configuration. Command substitutions, variable references, backticks, and other dynamic expressions are rejected.

3. For the API-key path, confirm that the key can be detected without printing it:

   ```sh
   npm run check:config
   ```

4. In Zotero, open **Tools → Plugins**, select **Install Plugin From File…**, and choose the XPI.

5. Fully quit and reopen Zotero. A normal Dock or Finder launch works with either an installed Codex CLI or a supported literal API key.

6. Select one item with a local PDF, click the **AI Assistant** sidebar icon, and ask a question.

## Providers and credentials

Provider selection is automatic. AItero uses an authenticated local Codex CLI first and uses the OpenAI API key only when Codex is unavailable or signed out. The status line always names the active provider. AItero asks App Server for account status and exposes its browser login flow when needed; it does not parse `~/.codex/auth.json`, copy access tokens, or put Codex credentials in Zotero preferences.

Codex must be discoverable as `codex`, `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`, or the absolute path in `CODEX_PATH`.

For the API-key provider, AItero resolves configuration in this order for every request:

1. `OPENAI_API_KEY` and `OPENAI_MODEL` in the Zotero process environment.
2. A literal assignment in `~/.zshrc`.
3. A literal assignment in `~/.bashrc`.

Supported examples:

```sh
export OPENAI_API_KEY='your-api-key'
OPENAI_MODEL="gpt-5.6-luna"
```

The key is never written to the XPI, Zotero preferences, the DOM, Zotero logs, or the Zotero database. Shell startup files are plaintext files, so protect their permissions and do not use this approach on a shared account. The included terminal launcher remains available for users who prefer an environment-only key.

## What is sent to OpenAI

When the user explicitly submits a question, both providers send:

- the question;
- all extracted text from the current PDF when the serialized page chunks total at most 750,000 characters;
- selected fallback excerpts only when that full context exceeds the cap;
- successful prior turns from the same in-memory panel session; and
- a random per-profile `safety_identifier` for API-key requests only.

API-key requests use `stream: true`, `store: false`, `credentials: "omit"`, and do not use background mode or `previous_response_id`. Codex requests use an ephemeral App Server thread, disable local history and memories for the request, and unsubscribe after completion.

In Codex mode, web search and up to three parallel research agents are available to the model and used only when the request benefits from them. Codex can send generated search queries to OpenAI's web-search service. The instruction forbids verbatim PDF excerpts, chunk IDs, local paths, and personal identifiers in queries, but model-level controls cannot guarantee that confidential details will never be included. Do not send sensitive papers if this exposure is unacceptable. Parallel research agents stay within the same OpenAI run and inherit the parent's read-only sandbox.

These request settings are not equivalent to organization-level Zero Data Retention or Modified Abuse Monitoring. Review the data controls applicable to the selected account before sending confidential documents.

## Session and data lifetime

- Conversation history exists only in memory.
- A chat is written to disk only when you choose **Export** and confirm a Markdown file location.
- Closing the section, changing the item or Reader tab, starting a new chat, closing the window, quitting Zotero, or disabling the plugin cancels active work and clears the session.
- Failed, cancelled, incomplete, and prematurely closed streams are never committed to follow-up history.
- The plugin stores one non-secret random `safety_identifier` in Zotero preferences.
- Uninstalling the plugin removes that preference and any legacy provider/tool preferences. Codex credentials remain owned by Codex.

## PDF retrieval and citations

1. The Zotero PDF worker result is trusted only when page counts, extracted page counts, and form-feed boundaries agree.
2. If validation fails, AItero uses a Reader page-text adapter and then a Zotero 10 page-specific worker fallback.
3. Chunks never cross PDF page boundaries. The default target is approximately 1,200 characters with a 200-character overlap.
4. AItero sends every extractable page chunk when the serialized context is at most 750,000 characters, including the 200-character overlaps.
5. The full-paper message is rebuilt as a stable request prefix and is not duplicated into in-memory conversation history.
6. Oversized PDFs use the existing BM25 and distributed-page fallback: up to 12 chunks and 30,000 characters for focused questions, or 18 chunks and 50,000 characters for broad questions.
7. A lexical no-match still selects distributed pages, so a cross-language question never produces an empty paper context.
8. Only citations to chunks included in the request can become buttons. Invented IDs remain plain text.

`[PDF N]` refers to the one-based PDF file page number, not a printed page label. AItero navigates using Zotero's zero-based `pageIndex`. Paragraph-level highlighting is outside the v0.3.0 scope.

Image-only PDFs are not sent to OpenAI. AItero displays an OCR-required message instead. Partially extractable PDFs use only pages with text and display a coverage warning.

## Limitations

Version 0.3.0 intentionally does not provide:

- multi-paper comparison;
- whole-library retrieval;
- OCR execution;
- persistent chat history;
- Zotero note creation;
- printed-page-label mapping;
- paragraph highlighting; or
- automatic updates from the private repository.

The Zotero 10 PDF compatibility adapter uses version-specific internal APIs. The manifest therefore caps compatibility at `10.0.*`.

## Development

```sh
npm ci
npm run check:english
npm test
npm run package
```

The packaging script sorts source paths and fixes ZIP timestamps, permissions, UTF-8 flags, and compression behavior. Identical source produces a byte-identical XPI and a matching SHA-256 sidecar.

Generated files:

```text
dist/aitero-assistant-0.3.0.xpi
dist/aitero-assistant-0.3.0.xpi.sha256
```

## Documentation

- [SETUP.md](SETUP.md) — installation, configuration, isolated testing, and troubleshooting
- [SECURITY.md](SECURITY.md) — credential handling, data flow, and vulnerability reporting
- [CONTRIBUTING.md](CONTRIBUTING.md) — development rules and pull-request checks
- [RELEASING.md](RELEASING.md) — versioning, tagging, CI, and GitHub Release procedure
- [CHANGELOG.md](CHANGELOG.md) — release history
- [LICENSE](LICENSE) — Apache License 2.0 terms

## Upstream documentation

- [Zotero custom item pane sections](https://www.zotero.org/support/dev/zotero_7_for_developers#custom_item_pane_sections)
- [Zotero plugin installation](https://www.zotero.org/support/plugins)
- [OpenAI Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key)
- [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- [KaTeX security](https://katex.org/docs/security)

AItero is licensed under the Apache License 2.0. KaTeX remains included under the MIT License, with its complete license text packaged at `vendor/katex/LICENSE` inside the XPI.
