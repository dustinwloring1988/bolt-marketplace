# Bolt Marketplace

This repository contains public Bolt plugin packages and their catalog metadata. The Bolt app owns installation state, configuration, permission enforcement, and runtime behavior.

## Add a release

1. Add a versioned `manifest.json`, `package.zip`, and `CHANGELOG.md` below `plugins/<publisher>/<slug>/<version>/`.
2. Put the same manifest JSON in the ZIP root. Version 1 packages contain declarative metadata/assets only; they do not contain executable code or install scripts.
3. Add both SHA-256 digests and relative paths to `catalog/index.json`.
4. Run `node scripts/validate-marketplace.mjs` and submit a reviewed pull request.

The initial host API supports reviewed `text-utils` adapters only. An app must treat other adapter types or capabilities as incompatible. Publisher labels in metadata are descriptive; repository review controls the source.
