# orca-sbx

Orca plugin that gives every worktree its own [Docker Sandbox](https://docs.docker.com/ai/sandboxes/).

- **Worktree created** → `sbx create --name orca-<worktree>-<hash> claude <worktree> <main-repo>/.git`
- **Worktree removed** → `sbx rm --force orca-<worktree>-<hash>`
- **Notifications** when a sandbox is being created, is ready (with how long it took), is removed, or fails.
- **Command "Docker Sandbox: Run agent in this worktree"** (Cmd+J) → types `sbx run …` into the worktree's terminal, creating the sandbox first if it's missing.

The main repo's `.git` is mounted too because a linked worktree's `.git` file points into it. That mount is writable, so sandboxes share the repo's git database.

## Install

1. `brew install --cask sbx`, then `sbx login`.
2. Orca → Settings → Plugins → Development → add this folder, then approve the permissions.

Change the agent with `AGENT` at the top of `main.mjs`.

## Caveat

Orca's plugin API (v0) has no process permission yet. This plugin spawns `sbx` with Node's `child_process`, which works only because the worker is plain Node. A future Orca release may block that. When Orca adds a `process:exec` capability, declare it in `orca-plugin.json`.
