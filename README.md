# orca-sbx

Orca plugin that gives every worktree its own [Docker Sandbox](https://docs.docker.com/ai/sandboxes/).

- **Worktree created** → `sbx create --name orca-<worktree>-<hash> claude <worktree> <main-repo>/.git`
- **Worktree removed** → `sbx rm --force orca-<worktree>-<hash>`
- **Notifications** when a sandbox is being created, is ready (with how long it took), is removed, or fails.
- **Command "Docker Sandbox: Run agent in this worktree"** (Cmd+J) → types `sbx run …` into the worktree's terminal, creating the sandbox first if it's missing.

The main repo's `.git` is mounted too because a linked worktree's `.git` file points into it. That mount is writable, so sandboxes share the repo's git database.

## Install

Current version: **v0.1.1**

1. Install Docker Sandboxes and sign in to Docker (a one-time step that `sbx` requires, even though sandboxes run locally):
   ```sh
   brew install --cask sbx
   sbx login
   ```
2. In Orca, open Settings → Plugins → **Install plugin**, choose the **Git URL** tab and enter:
   ```
   https://github.com/MatsCornegoor/orca-sbx.git#v0.1.1
   ```
   The `#v0.1.1` pins the install to this release.
3. Review the permissions and enable the plugin.
4. Create a worktree. A "Docker Sandbox ready" notification appears when its sandbox is up. The first one takes a minute or two while the agent image downloads. Check with `sbx ls`.

### Develop locally

Orca → Settings → Plugins → Development → add your clone of this repo. If a code change doesn't take effect, turn the plugin off and on.

Change the agent with `AGENT` at the top of `main.mjs`.

### Releasing

Bump `version` in `orca-plugin.json`, update the version above, commit, then tag and push:

```sh
git tag -a v0.1.2 -m v0.1.2 && git push origin v0.1.2
```

## Caveat

Orca's plugin API (v0) has no process permission yet. This plugin spawns `sbx` with Node's `child_process`, which works only because the worker is plain Node. A future Orca release may block that. When Orca adds a `process:exec` capability, declare it in `orca-plugin.json`.
