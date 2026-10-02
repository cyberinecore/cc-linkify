# Security policy

Cyberine Linkify rewrites how Claude's replies are drawn and checks whether paths in them exist, so a way to make it change what a link opens from what the reply named, read a file's contents, or alter what is stored or sent to Claude is a security bug.

## Reporting

Report privately through GitHub's "Report a vulnerability" button on https://github.com/cyberinecore/cc-linkify/security, or by email to xinchao@nghia-pham.com. Please include the plugin version, the Claude Code version, the reply text that triggers it (a minimal reproduction), what happened and what you expected. Do not open a public issue for an unfixed vulnerability.

## Scope

In scope: reply text that makes a link point at a different file than the path it labels; a link whose target is not a `file://` URL built from a path that exists; a rewrite of anything outside the drawn reply text (the stored conversation, the prompt, tool calls); any read of file contents; and any network request.

Out of scope: what your terminal does when you open a `file://` link, paths that Claude itself wrote into a reply, and Anthropic turning installed mods off remotely.
