# Changelog

All notable changes to Cyberine Linkify. Versions follow `version` in `.claude-plugin/plugin.json`.

## [0.1.0] - 2026-10-03

- First release: a `ui.render` hook on `AssistantMessage` that draws file paths in replies as short-label `file://` links, without changing the stored conversation.
- Links absolute, `~/`, cwd-relative (`src/x.ts`, `./x`, `../x`) and bare file names in the working directory; raw `file://` URLs and `<file://...>` autolinks.
- Locations in the label only: `:line`, `:line:col`, `#L10-L20`, `(line,col)`, and grep-style `path:line:content`.
- Globs with `*`, `?`, `[ab]`, `{a,b}` and bounded `**`, expanded into one link per existing match, at most 10 per glob.
- Leaves code blocks (also in lists and blockquotes), indented code, links, reference definitions, HTML and URLs alone; links quoted, emphasized and escaped-space paths whole; escapes `|` in labels for tables; grows clashing labels by parent folders until unique.
