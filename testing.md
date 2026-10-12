# Testing notes

What we tried for giving every Orca worktree its own Docker Sandbox, what works, and how to test it. Tested on Orca 1.4.224, `sbx` 0.30.0, macOS.

## What works today

| Feature | How | Status |
|---|---|---|
| Sandbox created when a worktree is created | Plugin, `worktree.created` event → `sbx create` | ✅ Tested in Orca |
| Sandbox removed when a worktree is removed | Plugin, `worktree.removed` event → `sbx rm --force` | ✅ Tested outside Orca |
| Notifications (creating, ready, removed, failed) | Plugin | ✅ Tested outside Orca |
| Git works inside the sandbox | Main repo's `.git` is mounted too | ✅ Commit made in the sandbox shows up on the Mac |
| Git hooks and config can't be changed from the sandbox | Main repo's `.git` mounted read-only; only objects, refs, logs and the worktree's git dir writable | ✅ Tested on a throwaway repo (see below); typed command (Quick Commands/shortcuts) not tested |
| Isolation | Sandbox sees only the worktree and `.git` | ✅ `uname` says Linux, `~/Documents` not found |
| New tab that opens in the sandbox | Orca Quick Commands (see below) | Not tested in Orca yet |
| Shell or Claude in the sandbox from a shortcut | Plugin commands ⌘⌥B / ⌘⌥L | Same command worked in Orca from the earlier panel; shortcuts themselves not tested |
| Every terminal and Claude in the sandbox automatically | Optional zsh hook (`shell/orca-sbx.zsh`, see README) | ✅ Simulated outside Orca (5 cases below); not tested in a real Orca terminal yet |
| Install/remove the zsh hook from Cmd+J | Plugin commands `zsh-hook-install` / `zsh-hook-remove` | ✅ Tested outside Orca against a throwaway home folder; not run from Orca yet |

## Quick Commands setup

Quick Commands are an official Orca feature: the ▶ button next to **+** in the tab bar opens a new terminal tab and runs a command in it. Add these two in Settings → **Quick Commands**, scoped globally.

**Sandbox shell**

```
d=$(git rev-parse --show-toplevel) && c=$(git rev-parse --path-format=absolute --git-common-dir) && g=$(git rev-parse --absolute-git-dir) && { case "$c" in "$d"/*) set -- "$d" ;; *) mkdir -p "$c/logs"; set -- "$d" "${c}:ro" "$c/objects" "$c/refs" "$c/logs" "$g" ;; esac; } && n="orca-$(printf %s "$(basename "$d")" | tr -c 'A-Za-z0-9.-' '-')-$(printf %s "$d" | shasum | cut -c1-6)" && { sbx ls -q | grep -qx -- "$n" || sbx create --name "$n" claude "$@"; } && sbx exec -it -w "$PWD" "$n" bash -l
```

**Claude in sandbox**

```
d=$(git rev-parse --show-toplevel) && c=$(git rev-parse --path-format=absolute --git-common-dir) && g=$(git rev-parse --absolute-git-dir) && { case "$c" in "$d"/*) set -- "$d" ;; *) mkdir -p "$c/logs"; set -- "$d" "${c}:ro" "$c/objects" "$c/refs" "$c/logs" "$g" ;; esac; } && n="orca-$(printf %s "$(basename "$d")" | tr -c 'A-Za-z0-9.-' '-')-$(printf %s "$d" | shasum | cut -c1-6)" && { sbx ls -q | grep -qx -- "$n" || sbx create --name "$n" claude "$@"; } && sbx run "$n"
```

Paste each as one line. These are the same commands the plugin's shortcuts type (`sandboxCommand()` in `main.mjs`). They work out the sandbox name from the worktree, create the sandbox if it's missing (this check takes about 1.5 seconds, up to 10 when `sbx` is waking up), then open a shell or Claude in it.

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

Install it from Cmd+J (**Docker Sandbox: Install zsh hook**) or by hand as described in the README, then:

1. **Plain terminal:** open a new terminal in a sandboxed worktree. After about 2 seconds the prompt becomes the sandbox's; `hostname` prints the sandbox name. `exit` returns to the Mac.
2. **Agent:** launch Claude from Orca in that worktree and ask it to run `uname -a`: Linux.
3. **Main checkout:** open a terminal in the repo's main checkout. It opens on the Mac with no delay.
4. **Outside Orca:** open your normal terminal app. Nothing changes.
5. **Remove:** run **Docker Sandbox: Remove zsh hook** from Cmd+J. The two lines are gone from `~/.zshrc` (backup in `~/.zshrc.orca-sbx.bak`) and new terminals open on the Mac.

Install/remove round trips, run against a throwaway home folder:

| Starting `~/.zshrc` | Install twice, then remove |
|---|---|
| Ends with a newline | Restored byte for byte; hook folder removed |
| Empty / missing | Restored; hook folder removed |
| No newline at the end | Restored except for one added trailing newline (harmless) |

Results of the simulated run (zsh started with Orca's environment variables, real `sbx`):

| Case | Result | Time |
|---|---|---|
| Plain terminal in the worktree | Sandbox shell queued for the first prompt | 2 s |
| Agent terminal | `claude` routed to the sandbox, no shell switch | 2 s |
| Main checkout | Skipped | 0 s |
| Outside Orca | Skipped | 0 s |
| `sbx` hangs (fake `sbx` that sleeps 60 s) | Gives up, normal Mac shell, no leftover processes | 15 s |

From a normal terminal you can also check a sandbox with `sbx exec <name> uname -a`.

## Git protection

A linked worktree's `.git` points into the main repo's `.git`, so the sandbox needs that folder for git to work. Writable, it would let anything in the sandbox plant a git hook or config (`core.hooksPath`, `core.fsmonitor`) that runs on the Mac the next time git runs there, including Orca's own background git calls.

So the main repo's `.git` is mounted **read-only**, with only these folders writable on top:

| Writable | Needed for |
|---|---|
| `.git/objects` | New commits, stash, fetched objects |
| `.git/refs` | Branches, tags, remote-tracking refs |
| `.git/logs` | Reflogs |
| `.git/worktrees/<name>` | This worktree's `HEAD`, index and `FETCH_HEAD` |

`sbx` can only mount folders, not single files, which is why `.git/config` can't be protected on its own. Results on a throwaway repo with these mounts:

| Inside the sandbox | Result |
|---|---|
| `git status`, commit, amend, log, diff | ✅ Works |
| Create and switch branches, stash | ✅ Works |
| `git fetch`, `git pull`, `git push` | ✅ Works |
| `git gc` | ❌ Blocked (needs to write `.git` itself); run it on the Mac |
| Write to `.git/hooks` | ❌ Blocked |
| Write to `.git/config`, `git config`, `git config --worktree` | ❌ Blocked |
| Write to `.git/info` | ❌ Blocked |

On the Mac afterwards: the sandbox's commits and branch were there, and no hook or `core.hooksPath` had been added.

**Limits:**

- This blocks the easy routes, not all of them. The worktree folder and `.git/worktrees/<name>` must stay writable, and both hold the pointer files git follows to find the repo. Something in the sandbox could point them at a git folder it controls, whose config would then apply when git runs in that worktree on the Mac. Not tested; it follows from how git reads those files.
- Main checkouts (sandboxes made there via Quick Commands or a shortcut) get no protection: their `.git` holds `HEAD` and the index, so it has to stay writable.
- Sandboxes created before this change keep the old fully writable mount. Remove and recreate them (`sbx rm <name>`, then use a Quick Command or shortcut) to get the protection.
- Commits from inside the plugin-created sandbox weren't rechecked after the change; the mounts were (`sbx ls --json` lists exactly the ones above).

## Options we looked at

| Option | Result |
|---|---|
| `orca.yaml` setup/archive scripts | Works, but per repo. `defaultTabs` only applies to the tabs opened at creation, needs `orca.yaml` committed in each repo, and an agent launched by Orca overrides the first tab's command. |
| Plugin running `sbx` on worktree events | ✅ Used. Unofficial: Orca's plugin API has no process permission yet; it works because the plugin worker is plain Node. |
| zsh hook in `~/.zshrc` (`shell/orca-sbx.zsh`) | ✅ Shipped as the optional setup. Every new terminal and every Claude Orca launches runs in the sandbox. Downsides: manual install, zsh only, ~2 s wait for new terminals in sandboxed worktrees (15 s timeout). Main checkouts are skipped. |
| Plugin command that installs the zsh hook | ✅ Built: Cmd+J → Install / Remove zsh hook. Unofficial like the rest: the plugin edits `~/.zshrc` directly, only when the user runs the command. |
| Sidebar panel with buttons | Worked, but panels can only type into an existing terminal and can't tell which one is in front. Removed in favor of Quick Commands. |
| `terminal:send` on new terminals | Not possible: plugins get no "terminal opened" event and can't see what runs in a terminal. |
| Adding an item to the **+** new-tab menu | Not possible from a plugin. Quick Commands (▶) is the closest official feature. |
| Plugin opening new tabs via `orca terminal create` | Possible: the Orca CLI works from the plugin's environment and can create a focused tab with a startup command. Unofficial. Not built. |
| Orca Cloud VM mode (VM recipe) | Most integrated, but experimental and a big build (needs SSH or an Orca server inside each sandbox). Not tried. |

## Known issues and gotchas

- **Plugin ID:** IDs starting with `orca-` are reserved for official Orca plugins; the install fails with a generic error. Ours is `docker-sandboxes`.
- **Docker sign-in:** `sbx` requires `sbx login` even though sandboxes run locally.
- **Agent status:** Orca may not show working/done status for Claude running in the sandbox, and Claude's sessions are stored inside the sandbox. Not checked.
- **Shared `.git`:** mostly handled by the read-only mount (see Git protection), but not a hard security boundary.
- **zsh hook and main checkouts:** the hook skips main checkouts to keep their terminals fast, so a sandbox made for a main checkout (via Quick Commands or a shortcut) isn't entered automatically.
- **Shortcuts pick the first terminal:** with several terminals in a worktree, ⌘⌥B / ⌘⌥L may type into the wrong one. Quick Commands avoid this.

## Ideas for Orca (feature requests)

- A `process:exec` plugin permission, so running `sbx` is official.
- A "terminal opened" event, or a way for plugins to wrap the shell or the agent launch command.
- A way for plugins to add entries to the new-tab menu or to Quick Commands.
- Exposing which terminal is focused to plugins.
