# Testing notes

What we tried for giving every Orca worktree its own Docker Sandbox, what works, and how to test it. Tested on Orca 1.4.224, `sbx` 0.30.0, macOS.

## What works today

| Feature | How | Status |
|---|---|---|
| Sandbox created when a worktree is created | Plugin, `worktree.created` event → `sbx create` | ✅ Tested in Orca |
| Sandbox removed when a worktree is removed | Plugin, `worktree.removed` event → `sbx rm --force` | ✅ Tested outside Orca |
| Notifications (creating, ready, removed, failed) | Plugin | ✅ Tested outside Orca |
| Git works inside the sandbox | Main repo's `.git` is mounted too | ✅ Commit made in the sandbox shows up on the Mac |
| Isolation | Sandbox sees only the worktree and `.git` | ✅ `uname` says Linux, `~/Documents` not found |
| New tab that opens in the sandbox | Orca Quick Commands (see below) | Not tested in Orca yet |
| Shell or Claude in the sandbox from a shortcut | Plugin commands ⌘⌥B / ⌘⌥L | Same command worked in Orca from the earlier panel; shortcuts themselves not tested |
| Every terminal and Claude in the sandbox automatically | Optional zsh hook (`shell/orca-sbx.zsh`, see README) | ✅ Simulated outside Orca (5 cases below); not tested in a real Orca terminal yet |

## Quick Commands setup

Quick Commands are an official Orca feature: the ▶ button next to **+** in the tab bar opens a new terminal tab and runs a command in it. Add these two in Settings → **Quick Commands**, scoped globally.

**Sandbox shell**

```
d=$(git rev-parse --show-toplevel) && c=$(git rev-parse --path-format=absolute --git-common-dir) && { case "$c" in "$d"/*) c= ;; esac; } && n="orca-$(printf %s "$(basename "$d")" | tr -c 'A-Za-z0-9.-' '-')-$(printf %s "$d" | shasum | cut -c1-6)" && { sbx ls -q | grep -qx -- "$n" || sbx create --name "$n" claude "$d" ${c:+"$c"}; } && sbx exec -it -w "$PWD" "$n" bash -l
```

**Claude in sandbox**

```
d=$(git rev-parse --show-toplevel) && c=$(git rev-parse --path-format=absolute --git-common-dir) && { case "$c" in "$d"/*) c= ;; esac; } && n="orca-$(printf %s "$(basename "$d")" | tr -c 'A-Za-z0-9.-' '-')-$(printf %s "$d" | shasum | cut -c1-6)" && { sbx ls -q | grep -qx -- "$n" || sbx create --name "$n" claude "$d" ${c:+"$c"}; } && sbx run "$n"
```

These are the same commands the plugin's shortcuts type (`sandboxCommand()` in `main.mjs`). They work out the sandbox name from the worktree, create the sandbox if it's missing (this check takes about 1.5 seconds, up to 10 when `sbx` is waking up), then open a shell or Claude in it.

## How to test

1. **Install:** `brew install --cask sbx`, `sbx login`, then install the plugin in Orca (Settings → Plugins → Install plugin → Git URL, or Development → add this folder). Approve the permissions. After any change that adds commands or shortcuts, Orca asks for approval again; until then the plugin doesn't run.
2. **Create:** create a worktree. Expect "Creating Docker Sandbox…" then "Docker Sandbox ready". Check with `sbx ls`: a sandbox named `orca-<worktree>-<hash>` with two workspaces (the worktree and the main repo's `.git`). The first one takes about 90 seconds while the image downloads; later ones about 10 seconds.
3. **Shell:** in that worktree, click ▶ → Sandbox shell (or open a terminal and press ⌘⌥B). The prompt changes. Check:
   ```sh
   hostname        # orca-<worktree>-<hash>
   uname -a        # Linux
   ls ~/Documents  # No such file or directory
   ```
   Run these *inside* the sandbox shell. Run in a normal terminal they show your Mac.
4. **Claude:** click ▶ → Claude in sandbox (or ⌘⌥L). Ask Claude to run `uname -a`; it should say Linux.
5. **Git:** commit something inside the sandbox; the commit appears on the branch in Orca.
6. **Remove:** delete the worktree. Expect "Docker Sandbox removed", and `sbx ls` no longer lists it.

### zsh hook

Install it as described in the README, then:

1. **Plain terminal:** open a new terminal in a sandboxed worktree. After about 2 seconds the prompt becomes the sandbox's; `hostname` prints the sandbox name. `exit` returns to the Mac.
2. **Agent:** launch Claude from Orca in that worktree and ask it to run `uname -a`: Linux.
3. **Main checkout:** open a terminal in the repo's main checkout. It opens on the Mac with no delay.
4. **Outside Orca:** open your normal terminal app. Nothing changes.

Results of the simulated run (zsh started with Orca's environment variables, real `sbx`):

| Case | Result | Time |
|---|---|---|
| Plain terminal in the worktree | Sandbox shell queued for the first prompt | 2 s |
| Agent terminal | `claude` routed to the sandbox, no shell switch | 2 s |
| Main checkout | Skipped | 0 s |
| Outside Orca | Skipped | 0 s |
| `sbx` hangs (fake `sbx` that sleeps 60 s) | Gives up, normal Mac shell, no leftover processes | 15 s |

From a normal terminal you can also check a sandbox with `sbx exec <name> uname -a`.

## Options we looked at

| Option | Result |
|---|---|
| `orca.yaml` setup/archive scripts | Works, but per repo. `defaultTabs` only applies to the tabs opened at creation, needs `orca.yaml` committed in each repo, and an agent launched by Orca overrides the first tab's command. |
| Plugin running `sbx` on worktree events | ✅ Used. Unofficial: Orca's plugin API has no process permission yet; it works because the plugin worker is plain Node. |
| zsh hook in `~/.zshrc` (`shell/orca-sbx.zsh`) | ✅ Shipped as the optional setup. Every new terminal and every Claude Orca launches runs in the sandbox. Downsides: manual install, zsh only, ~2 s wait for new terminals in sandboxed worktrees (15 s timeout). Main checkouts are skipped. |
| Plugin command that installs the zsh hook | Possible (one click for users) but edits `~/.zshrc` from a plugin. Not built. |
| Sidebar panel with buttons | Worked, but panels can only type into an existing terminal and can't tell which one is in front. Removed in favor of Quick Commands. |
| `terminal:send` on new terminals | Not possible: plugins get no "terminal opened" event and can't see what runs in a terminal. |
| Adding an item to the **+** new-tab menu | Not possible from a plugin. Quick Commands (▶) is the closest official feature. |
| Plugin opening new tabs via `orca terminal create` | Possible: the Orca CLI works from the plugin's environment and can create a focused tab with a startup command. Unofficial. Not built. |
| Orca Cloud VM mode (VM recipe) | Most integrated, but experimental and a big build (needs SSH or an Orca server inside each sandbox). Not tried. |

## Known issues and gotchas

- **Plugin ID:** IDs starting with `orca-` are reserved for official Orca plugins; the install fails with a generic error. Ours is `docker-sandboxes`.
- **Docker sign-in:** `sbx` requires `sbx login` even though sandboxes run locally.
- **Agent status:** Orca may not show working/done status for Claude running in the sandbox, and Claude's sessions are stored inside the sandbox. Not checked.
- **Shared `.git`:** sandboxes can write to the main repo's `.git`, including `.git/hooks` and `.git/config`, which run on the Mac the next time git runs there. The sandbox protects your files, but isn't a hard security boundary. Possible fix to test: mount `.git/hooks` and `.git/config` read-only.
- **zsh hook and main checkouts:** the hook skips main checkouts to keep their terminals fast, so a sandbox made for a main checkout (via Quick Commands or a shortcut) isn't entered automatically.
- **Shortcuts pick the first terminal:** with several terminals in a worktree, ⌘⌥B / ⌘⌥L may type into the wrong one. Quick Commands avoid this.

## Ideas for Orca (feature requests)

- A `process:exec` plugin permission, so running `sbx` is official.
- A "terminal opened" event, or a way for plugins to wrap the shell or the agent launch command.
- A way for plugins to add entries to the new-tab menu or to Quick Commands.
- Exposing which terminal is focused to plugins.
