# Security Policy

## Supported versions

| Version | Zotero | Security updates |
| --- | --- | --- |
| 0.1.x | 9.0.x | Supported |

The Zotero compatibility boundary is enforced by `strict_min_version` and `strict_max_version` in `src/manifest.json`.

## Reporting a vulnerability

Do not place API keys, private PDFs, Zotero databases, profile archives, request payloads, or sensitive logs in an issue.

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

If a log excerpt is required, redact authorization headers, API keys, document text, file paths containing personal information, and request identifiers that should remain private.

## Trust model

A Zotero plugin runs with access to the Zotero application context. Installing an XPI grants it substantially more access than an ordinary website. Install AItero only from a verified private Release or a trusted source build.

AItero is designed as a read-only Zotero tool. It does not call APIs that save, modify, move, or delete Zotero items, notes, tags, collections, attachments, annotations, or sync state.

The plugin still reads:

- metadata required to identify the active PDF;
- local PDF text required for retrieval;
- the current shell startup files used for configuration; and
- one non-secret random preference used as `safety_identifier`.

## API-key handling

Configuration is resolved immediately before use:

1. the Zotero process environment;
2. a static literal in `~/.zshrc`; or
3. a static literal in `~/.bashrc`.

The rc-file parser never starts a shell or executes file contents. It accepts only direct single-quoted, double-quoted, or restricted unquoted literals. It rejects:

- `$VARIABLE` references;
- `$(command)` substitutions;
- backticks;
- escape-heavy or multiline strings;
- unrelated variable names; and
- files larger than 1 MB.

The API key is not stored in:

- the XPI;
- Git;
- Zotero preferences;
- the Zotero database;
- DOM attributes or text nodes;
- AItero error serialization; or
- AItero debug output.

The key is sent only as the HTTPS Bearer token for `https://api.openai.com/v1/responses`.

Shell startup files are plaintext. Other processes running as the same macOS user and other privileged Zotero plugins can read them. Use a trusted personal account, restrict file permissions, use a dedicated project key, and configure an appropriate project budget.

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
unzip -l dist/aitero-assistant-0.1.0.xpi
```

Never run commands that print `OPENAI_API_KEY`. If a key appears in Git history or a Release asset, revoke it immediately, create a new key, remove the affected artifact, and treat the old key as compromised.

## OpenAI data flow

AItero sends data only after the user presses **Send** or the submit shortcut. The request may include:

- the user's question;
- the full extracted text of the active PDF when it fits the local context cap;
- selected excerpts from oversized PDFs;
- successful previous turns in the same panel session; and
- a random per-profile safety identifier.

Requests use `store: false`, but this is not equivalent to organization-level Zero Data Retention or Modified Abuse Monitoring. The OpenAI organization and project control the applicable retention policy.

Do not test with confidential PDFs unless the account policy, document owner, and intended processing all permit the transfer.

## Prompt-injection boundary

PDF text is untrusted source material. The system instruction explicitly tells the model not to follow commands embedded in a paper. Only opaque chunk IDs selected locally may be converted into citation buttons.

This boundary reduces, but cannot eliminate, model-level prompt-injection risk. AItero does not allow model output to execute code, inject arbitrary HTML, navigate to arbitrary URLs, or select unprovided citation IDs.

## Rendering security

- Model HTML is never inserted with `innerHTML`.
- Text is rendered through text nodes and an allowlisted Markdown structure.
- KaTeX is bundled locally.
- KaTeX uses `trust: false`, `strict: "error"`, bounded expansion, and bounded size.
- Citation buttons are created only for exact IDs in the request evidence set.

## Network behavior

The plugin communicates directly with the OpenAI Responses endpoint using Zotero's window `fetch` implementation. Requests use:

- `credentials: "omit"`;
- `cache: "no-store"`;
- `redirect: "error"`;
- `stream: true`; and
- `store: false`.

AItero does not use an OpenAI SDK, analytics service, telemetry endpoint, CDN, local listening port, or separate server.

## Dependency and release security

- `package-lock.json` is committed.
- CI uses `npm ci`.
- KaTeX is pinned to an exact version.
- GitHub Actions use current major versions and minimal token permissions.
- Release artifacts are built from the tagged commit.
- The Release workflow builds twice and requires byte-identical XPI output.
- Every XPI has a SHA-256 sidecar.
- The repository remains private unless the owner explicitly changes visibility.
