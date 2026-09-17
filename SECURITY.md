# Security Policy

## Supported versions

| Version | Zotero | Security updates |
| --- | --- | --- |
| 0.4.0+ | 10.0 and later (validated on 10.0.2) | Supported |
| 0.3.x | 10.0 and later | Superseded |
| 0.2.x | 9.0.x | Not supported |

The Zotero compatibility boundary is enforced by `strict_min_version` and `strict_max_version` in `src/manifest.json`.

## Reporting a vulnerability

Do not place credentials, private PDFs, Zotero databases, profile archives, request payloads, or sensitive logs in an issue.

Use a private GitHub Security Advisory:

```text
https://github.com/wgcyeo/AItero/security/advisories/new
```

Include:

- the AItero version;
- the Zotero version and macOS version;
- the affected component;
- minimal reproduction steps using synthetic data;
- the expected and actual behavior; and
- the security impact.

If a log excerpt is required, redact authorization headers, credentials, document text, file paths containing personal information, and request identifiers that should remain private.

## Trust model

A Zotero plugin runs with access to the Zotero application context. Installing an XPI grants it substantially more access than an ordinary website. Install AItero only from a verified private Release or a trusted source build.

AItero is designed as a read-only Zotero tool. It does not call APIs that save, modify, move, or delete Zotero items, notes, tags, collections, attachments, annotations, or sync state.

The plugin still reads:

- metadata required to identify the active PDF;
- local PDF text required for retrieval;
- saved non-secret model, reasoning effort, and speed preferences.

## Codex authentication

The Codex provider launches the installed `codex app-server` executable directly, without starting a shell. AItero accepts only ChatGPT account sessions. Authentication status and browser login use App Server's `account/read` and `account/login/start` methods.

AItero does not read, parse, copy, serialize, or log Codex access or refresh tokens. It does not inspect `~/.codex/auth.json` or the operating-system keychain. Codex remains the credential owner, and uninstalling AItero does not log the user out of Codex.

`CODEX_PATH` may select an absolute executable path. Because a Zotero plugin is privileged and the selected executable runs as the current macOS user, set it only to a trusted Codex installation. AItero also recognizes the standard Homebrew paths and inherited `PATH`.

## Secret scanning before release

Before committing or releasing:

```sh
npm run check:english
npm test
npm run package
```

Also inspect staged changes and the XPI file list:

```sh
git diff --cached
unzip -l dist/aitero-assistant-0.4.0.xpi
```

Never print or log credentials. If a credential appears in Git history or a Release asset, revoke it immediately and treat the old credential as compromised.

## OpenAI data flow

AItero sends data only after the user presses **Send** or the submit shortcut. The request may include:

- the user's question;
- the full extracted text of the active PDF when it fits the local context cap;
- selected excerpts from oversized PDFs;
- successful previous turns in the same panel session.

Codex requests use ephemeral App Server threads, request no local transcript history or memory generation, and unsubscribe when the turn ends. These settings are not equivalent to organization-level Zero Data Retention or Modified Abuse Monitoring. The selected OpenAI account controls the applicable policy.

When useful, Codex may send model-generated web-search queries. The developer instruction prohibits verbatim PDF excerpts, chunk IDs, local paths, personal identifiers, and confidential paper details in those queries, but this is a model-level mitigation rather than a deterministic data-loss-prevention filter. Do not send sensitive papers if this exposure is unacceptable.

Parallel research agents receive only prompts delegated by the parent model. They remain inside the same Codex session tree and inherit the parent's read-only sandbox. Their use can increase token consumption.

Initial model settings inherit the local Codex configuration without model, effort, or speed overrides. Explicit choices made in the model picker are saved in Zotero preferences and applied to subsequent turns, including research-agent model and effort defaults. Fast mode and parallel delegation can increase usage.

Do not test with confidential PDFs unless the account policy, document owner, and intended processing all permit the transfer.

## Prompt-injection boundary

PDF text is untrusted source material. The system instruction explicitly tells the model not to follow commands embedded in a paper. Only opaque chunk IDs selected locally may be converted into citation buttons.

This boundary reduces, but cannot eliminate, model-level prompt-injection risk. AItero does not allow model output to execute code, inject arbitrary HTML, or select unprovided citation IDs. Markdown links are accepted only for `https:` URLs and open only after a user click.

## Codex tool boundary

Every Codex process receives command-line overrides that disable apps, browser/computer control, image tools, plugins, shell tools, unified execution, login-shell behavior, MCP servers, hooks, persisted history, memories, and editor file openers. Every turn also uses:

- a fresh empty temporary working directory;
- an ephemeral thread;
- `approvalPolicy: "never"`;
- the read-only sandbox; and
- sandbox network access disabled for local execution.

These controls are supplied by the plugin at runtime on every installation; they do not rely on the developer machine's Codex preferences.

Web search and subagent collaboration are the only active agent tools AItero permits. They are available by default and the model is instructed to invoke them only when useful. Subagents are capped at three concurrent children and inherit the parent sandbox. If App Server reports a command, file change, MCP call, dynamic tool, or image tool despite the configuration, AItero interrupts the turn and refuses to commit its output.

## Rendering security

- Model HTML is never inserted with `innerHTML`.
- Text is rendered through text nodes and an allowlisted Markdown structure.
- KaTeX is bundled locally.
- KaTeX uses `trust: false`, `strict: "error"`, bounded expansion, and bounded size.
- Citation buttons are created only for exact IDs in the request evidence set.
- External Markdown links are restricted to HTTPS and require an explicit click.

## Network behavior

AItero does not use an OpenAI SDK, analytics service, CDN, or local listening port. The Codex provider starts a local stdio App Server subprocess, which communicates with OpenAI under Codex's own account and data controls. App Server analytics are disabled by default unless the user's Codex configuration explicitly enables them.

## Dependency and release security

- `package-lock.json` is committed.
- CI uses `npm ci`.
- KaTeX is pinned to an exact version.
- GitHub Actions use current major versions and minimal token permissions.
- Release artifacts are built from the tagged commit.
- The Release workflow builds twice and requires byte-identical XPI output.
- Every XPI has a SHA-256 sidecar.
- The repository remains private unless the owner explicitly changes visibility.
