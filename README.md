# AItero Assistant

AItero Assistant is a local plugin for Zotero 10 and later that adds a full-height AI chat section to the library item pane and the PDF Reader sidebar. It answers questions about the currently selected PDF, streams the response, renders safe Markdown and LaTeX, and turns validated citations into buttons that open the corresponding PDF page.

The plugin does not modify Zotero items, notes, tags, collections, attachments, or the Zotero database. It does not require a Zotero fork, an OpenAI SDK, or a local web server.

## At a glance

- Plugin ID: `aitero-assistant@local`
- Version: `4.0.0`
- License: Apache-2.0
- Supported Zotero versions: `10.0` and later
- Validated platform: macOS with the Homebrew `zotero` cask
- Initial model, effort, and speed: inherited from the local Codex configuration
- Authentication: local Codex CLI with ChatGPT sign-in
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
- ChatGPT sign-in that delegates authentication to the installed Codex CLI; AItero never reads or stores its tokens.
- Model-invoked live web search and up to three parallel research agents, available automatically when useful in Codex mode.
- Read-only Codex sandbox with shell, file changes, MCP, connectors, and approval requests blocked.
- A step-by-step **Model → Effort → Standard / Fast** picker above the question field.
- Optional saved model, reasoning, and speed choices; new installations follow Codex defaults.

## Quick start

For complete installation, privacy, development, and troubleshooting instructions, read [SETUP.md](SETUP.md).

1. Download both assets from the private GitHub Release:

   - `aitero-assistant-4.0.0.xpi`
   - `aitero-assistant-4.0.0.xpi.sha256`

2. Install the Codex CLI and sign in with ChatGPT using `codex login`, or complete **Sign in to Codex** from the AItero panel.

3. In Zotero, open **Tools → Plugins**, select **Install Plugin From File…**, and choose the XPI.

4. Fully quit and reopen Zotero. A normal Dock or Finder launch works with the installed Codex CLI.

5. Select one item with a local PDF, click the **AI Assistant** sidebar icon, and ask a question.

## Codex sign-in and model settings

AItero uses Codex with ChatGPT sign-in exclusively. It asks App Server for account status and exposes its browser login flow when needed. It does not parse `~/.codex/auth.json`, copy access tokens, or store credentials in Zotero preferences. If Codex is unavailable or signed out, the panel explains how to install it or sign in before sending a question.

Codex must be discoverable as `codex`, `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`, or the absolute path in `CODEX_PATH`.

Click the model name above the question field, choose a model, choose its reasoning effort, then choose **Standard** or **Fast**. Each click advances to the next step; the final speed choice applies and saves the selection. Use the step labels to go back, or press Escape to discard an unfinished selection. Changes apply to the next question without clearing the conversation.

New installations send no model, reasoning-effort, or speed override, so Codex resolves its own configuration. The picker contains only models returned by Codex; it has no separate default option. An explicit selection is saved only after the final speed choice.

Codex supplies its available models, supported efforts, and Fast tier through App Server. Model rows show names only. If discovery is unavailable, Codex defaults remain usable without a hardcoded fallback catalog. Fast can consume more usage; a model without a Fast tier offers Standard only.

## What is sent to OpenAI

When the user explicitly submits a question, Codex sends:

- the question;
- all extracted text from the current PDF when the serialized page chunks total at most 750,000 characters;
- selected fallback excerpts only when that full context exceeds the cap;
- successful prior turns from the same in-memory panel session.

Codex requests use an ephemeral App Server thread, disable local history and memories for the request, and unsubscribe after completion.

Web search and up to three parallel research agents are available to the model and used only when the request benefits from them. Codex can send generated search queries to OpenAI's web-search service. The instruction forbids verbatim PDF excerpts, chunk IDs, local paths, and personal identifiers in queries, but model-level controls cannot guarantee that confidential details will never be included. Do not send sensitive papers if this exposure is unacceptable. Parallel research agents stay within the same OpenAI run and inherit the parent's read-only sandbox.

These request settings are not equivalent to organization-level Zero Data Retention or Modified Abuse Monitoring. Review the data controls applicable to the selected account before sending confidential documents.

## Session and data lifetime

- Conversation history exists only in memory.
- A chat is written to disk only when you choose **Export** and confirm a Markdown file location.
- Closing the section, changing the item or Reader tab, starting a new chat, closing the window, quitting Zotero, or disabling the plugin cancels active work and clears the session.
- Failed, cancelled, incomplete, and prematurely closed streams are never committed to follow-up history.
- The plugin stores non-secret model, effort, and speed choices in Zotero preferences.
- Uninstalling the plugin removes all plugin-owned preferences. Codex credentials remain owned by Codex.

## PDF retrieval and citations

1. The Zotero PDF worker result is trusted only when page counts, extracted page counts, and form-feed boundaries agree.
2. If validation fails, AItero uses a Reader page-text adapter and then a validated page-specific worker fallback.
3. Chunks never cross PDF page boundaries. The default target is approximately 1,200 characters with a 200-character overlap.
4. AItero sends every extractable page chunk when the serialized context is at most 750,000 characters, including the 200-character overlaps.
5. The full-paper message is rebuilt as a stable request prefix and is not duplicated into in-memory conversation history.
6. Oversized PDFs use the existing BM25 and distributed-page fallback: up to 12 chunks and 30,000 characters for focused questions, or 18 chunks and 50,000 characters for broad questions.
7. A lexical no-match still selects distributed pages, so a cross-language question never produces an empty paper context.
8. Only citations to chunks included in the request can become buttons. Invented IDs remain plain text.

`[PDF N]` refers to the one-based PDF file page number, not a printed page label. AItero navigates using Zotero's zero-based `pageIndex`. Paragraph-level highlighting is outside the v4.0.0 scope.

Image-only PDFs are not sent to OpenAI. AItero displays an OCR-required message instead. Partially extractable PDFs use only pages with text and display a coverage warning.

## Limitations

Version 4.0.0 intentionally does not provide:

- multi-paper comparison;
- whole-library retrieval;
- OCR execution;
- persistent chat history;
- Zotero note creation;
- printed-page-label mapping;
- paragraph highlighting; or
- automatic updates from the private repository.

The manifest permits Zotero 10 and later without an upper version cap. The PDF compatibility adapter checks the returned page counts and rejects results that cannot be mapped to exact pages. Zotero 10.0.2 is the validated runtime; later versions are permitted but require integration testing when their internal APIs change. Zotero recommends [validating each major release](https://www.zotero.org/support/dev/zotero_10_for_developers#updating_plugin_compatibility), so an open-ended manifest is not a guarantee of future compatibility.

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
dist/aitero-assistant-4.0.0.xpi
dist/aitero-assistant-4.0.0.xpi.sha256
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
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- [KaTeX security](https://katex.org/docs/security)

AItero is licensed under the Apache License 2.0. KaTeX remains included under the MIT License, with its complete license text packaged at `vendor/katex/LICENSE` inside the XPI.
