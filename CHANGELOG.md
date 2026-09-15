# Changelog

All notable changes to AItero Assistant are documented here.

The project follows semantic versioning for Release tags.

## Unreleased

## 0.3.1 - 2026-09-15

### Changed

- Allow installation and the macOS launcher on Zotero 10 and later, removing the 10.0.x upper bound.
- Default Codex parent and research agents to `gpt-6-astra` with xhigh reasoning and fast service tier.
- Default the API-key provider to `gpt-6-astra` with xhigh reasoning and fast service tier; preserve explicit model overrides.
- Keep page-count validation for private PDF worker fallbacks so unsupported results fail without producing unverified citations.

### Fixed

- Wait for PDF Reader initialization before citation navigation and avoid a duplicate navigation when opening a PDF.

### Compatibility

- Validated runtime: Zotero 10.0.2 on macOS. Later versions are allowed by the manifest but still require integration testing as internal APIs evolve.

## 0.3.0 - 2026-08-18

### Changed

- Updated the manifest, launcher, documentation, and packaging metadata for Zotero 10.0.x.
- Revalidated the page-safe PDF extraction and citation navigation adapters against Zotero 10.0.

### Removed

- Zotero 9 support. AItero 0.2.x remains the final Zotero 9-compatible line.

## 0.2.1 - 2026-08-15

### Added

- Partial text selection within user and assistant messages.
- User-initiated Markdown export for the visible chat transcript.

### Fixed

- Reload plugin styles with a per-startup cache key so same-version XPI updates take effect immediately.

## 0.2.0 - 2026-08-14

### Added

- Codex App Server integration with delegated ChatGPT browser sign-in and no direct token access.
- Model-invoked live web search and up to three parallel research agents in Codex mode.
- Ephemeral Codex turns with streaming, explicit cancellation, and HTTPS web-source links.
- Apache License 2.0 project licensing, included in both the repository and packaged XPI.

### Changed

- Codex is now selected automatically when authenticated, with the OpenAI API key used only as a fallback.
- Codex parent and subagent defaults are now `gpt-5.6-sol` with xhigh reasoning and the fast service tier.
- Provider and research-tool selectors were removed; the status line now reports the active provider and Codex configuration.

### Security

- Codex runs use an empty temporary working directory and disable shell execution, file changes, MCP, hooks, memories, and approvals.
- Unexpected active tools fail closed and cancel the turn without committing its output to chat history.

## 0.1.0 - 2026-08-14

### Added

- Native Zotero 9 item-pane and Reader-sidebar assistant section.
- Full-height chat layout with fixed composer and independent conversation scrolling.
- Explicit cancellation, retry, and new-chat controls.
- Streaming OpenAI Responses integration using `gpt-5.6-luna` by default.
- Request construction with `store: false`, `credentials: "omit"`, and no background mode.
- In-memory session transactions committed only after `response.completed`.
- Strict SSE parsing for split UTF-8, CRLF/LF, multiline data, and terminal events.
- Page-validated PDF extraction with Reader and Zotero 9 worker fallbacks.
- Full extracted-paper context for ordinary PDFs, independent of the question language.
- A stable full-paper request prefix that is not duplicated into chat history.
- Oversized-PDF retrieval using BM25, distributed page sampling, and a nonempty cross-language fallback.
- Opaque citation-ID validation and clickable PDF page navigation.
- Safe Markdown and local untrusted KaTeX rendering.
- Automatic configuration discovery from the process environment, `~/.zshrc`, or `~/.bashrc` without executing shell files.
- Deterministic XPI packaging with a SHA-256 sidecar.
- English-only repository enforcement.
- CI with `actions/checkout@v7` and `actions/setup-node@v7`, Dependabot, and automated private GitHub Release workflows.

### Security

- API keys are excluded from the XPI, preferences, DOM, logs, and serialized errors.
- Shell configuration accepts only static literal assignments and rejects dynamic shell syntax.
- Model-produced HTML is never injected into the Zotero UI.
- Citation buttons are restricted to chunks supplied in the active request.
- Requests use `store: false`, no background mode, and no `previous_response_id`.

### Known limitations

- Zotero support is limited to `9.0.*`.
- Automatic updates are unavailable for private Release assets.
- OCR, multi-paper comparison, persistent chat, note writing, printed page labels, and paragraph highlighting are outside this release.
