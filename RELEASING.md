# Releasing AItero Assistant

This document describes the private GitHub Release process. A tag matching `v*` triggers `.github/workflows/release.yml`, which tests, packages, verifies reproducibility, and creates or updates the GitHub Release.

## 1. Preconditions

Before starting:

- use a clean checkout of `main`;
- confirm GitHub CLI authentication for `wgcyeo`;
- confirm the repository is private;
- confirm Zotero integration in an isolated profile;
- confirm no private PDF or API key exists in the working tree; and
- confirm the intended version follows semantic versioning.

```sh
gh auth status
gh repo view wgcyeo/AItero --json visibility,defaultBranchRef
git status --short --branch
```

## 2. Update the version

For a release after 0.1.0, update:

- `package.json`;
- `package-lock.json`;
- `src/manifest.json`;
- versioned filenames and examples in documentation; and
- the launcher compatibility error text if it includes a version.

Use `npm install --package-lock-only` after changing `package.json` so the lockfile root version stays aligned.

The Release workflow requires the tag to equal `v` plus `package.json.version`.

## 3. Update release notes

Move relevant items under a dated version heading in `CHANGELOG.md`. Describe user-visible behavior, security changes, compatibility changes, and known limitations.

Do not include credentials, private repository URLs containing tokens, user-library titles, private file paths, or request payloads.

## 4. Run local verification

```sh
npm ci
npm run check:english
npm run check:config
npm test
npm run package
cp dist/aitero-assistant-0.1.0.xpi /tmp/aitero-release-first.xpi
npm run package
cmp /tmp/aitero-release-first.xpi dist/aitero-assistant-0.1.0.xpi
cd dist
shasum -a 256 -c aitero-assistant-0.1.0.xpi.sha256
```

Adjust versioned filenames for later releases.

Inspect package contents:

```sh
unzip -l aitero-assistant-0.1.0.xpi
```

The XPI should contain only plugin source, the English Fluent resource, icons, CSS, and vendored KaTeX assets. It must not contain Git metadata, tests, documentation, `.env` files, shell startup files, or credentials.

## 5. Isolated Zotero validation

Follow the isolated-profile procedure in `SETUP.md`.

Minimum checks:

1. install;
2. restart;
3. enable and disable;
4. remove and reinstall;
5. valid PDF selection;
6. no-PDF and multi-selection messages;
7. environment and rc-file key detection;
8. streaming response on one public PDF;
9. citation navigation to the first, middle, and last relevant pages;
10. chat reset on panel close and item/tab change;
11. cancellation during extraction and streaming;
12. long-conversation scrolling;
13. ordered-list numbering; and
14. inline and block mathematics.

Never run a release smoke request on a private user-library document.

## 6. Commit the release

```sh
git add --all
git diff --cached --check
git diff --cached
git commit -m "Release AItero Assistant 0.1.0"
git push origin main
```

Use the actual release version in the commit subject.

## 7. Create and push the tag

Use an annotated tag:

```sh
git tag -a v0.1.0 -m "AItero Assistant v0.1.0"
git push origin v0.1.0
```

Pushing the tag starts the Release workflow.

## 8. Monitor GitHub Actions

```sh
gh run list --repo wgcyeo/AItero --limit 10
gh run watch --repo wgcyeo/AItero
```

The Release workflow:

1. checks out the exact tagged commit;
2. installs locked dependencies;
3. verifies tag and package versions;
4. enforces English-only content;
5. runs unit tests;
6. builds the XPI twice;
7. requires byte-identical output;
8. validates the SHA-256 sidecar; and
9. creates or updates the GitHub Release assets.

## 9. Verify the Release

```sh
gh release view v0.1.0 --repo wgcyeo/AItero
gh release download v0.1.0 \
  --repo wgcyeo/AItero \
  --pattern 'aitero-assistant-0.1.0.xpi*' \
  --dir /tmp/aitero-release-download
cd /tmp/aitero-release-download
shasum -a 256 -c aitero-assistant-0.1.0.xpi.sha256
```

Confirm that the Release is associated with the intended tag and contains exactly the XPI and checksum assets.

## 10. Distribution and updates

The repository and Release are private. Recipients must have GitHub access to download assets. Do not embed a GitHub token in the plugin or an update URL.

Zotero 9 requires `update_url` in the manifest. Version 0.1.0 uses an inert reserved `.invalid` URL and manual XPI updates.

If the project later becomes public and automatic updates are desired:

1. choose a stable HTTPS host for an update manifest;
2. document and test the manifest schema against the supported Zotero version;
3. update `src/manifest.json`;
4. verify that no authentication token is required;
5. test upgrade and rollback in an isolated profile; and
6. review the change as a security-sensitive distribution feature.

## 11. Failed release recovery

If CI fails before a Release is created, fix the source, commit, and create a new version tag. Do not move a published version tag to different source.

If a Release exists with bad assets:

1. remove the affected assets;
2. investigate whether a credential or private file was exposed;
3. revoke any exposed credential immediately;
4. fix the build;
5. increment the version; and
6. publish a new tag and Release.

Avoid deleting and recreating a released tag unless the Release was never distributed and the owner has explicitly approved rewriting it.
