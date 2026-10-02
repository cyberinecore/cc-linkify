# Privacy policy

Cyberine Linkify is a Claude Code plugin that runs only on your computer. This policy covers the plugin as published from https://github.com/cyberinecore/cc-linkify.

## What it collects

Nothing. The plugin has no telemetry, makes no network requests, and sends no data to its author, to Anthropic, or to anyone else.

## What it reads locally

- The text of each block of Claude's replies as Claude Code draws it, to find path-shaped words.
- For each such word, whether the path exists on this machine and whether it is a file or a folder; for a glob, the names of the entries in the folders it walks. It never reads a file's contents.
- The `HOME` environment variable, only to expand a `~/` path, and the session's working directory, only to resolve a relative path or a bare file name.

It never reads your conversation transcript as stored, Claude's memory, chat history or summaries.

## What it writes locally, and for how long

Nothing. Path lookups are held in memory for 30 seconds and are gone when the session ends. The rewritten links exist only on screen; the stored conversation is unchanged.

## Children

Cyberine Linkify is a developer tool and is not directed at children under 18.

## Contact

Questions or concerns: open an issue at https://github.com/cyberinecore/cc-linkify/issues or email xinchao@nghia-pham.com. Security reports: see `SECURITY.md`.

## Changes

Changes to this policy are published in this file in the repository, with the history kept by git.
