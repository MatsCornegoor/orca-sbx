# orca-sbx

An [Orca](https://www.onorca.dev/) plugin that gives every worktree its own [Docker Sandbox](https://docs.docker.com/ai/sandboxes/): a local microVM where your shell and Claude can run without access to the rest of your Mac.

- **Automatic:** creating a worktree in Orca creates its sandbox; removing the worktree removes it.
- **Isolated:** the sandbox sees only that worktree and the git data it needs. Not your home folder, not other projects.
- **Git keeps working:** commit, branch, stash, fetch and push from inside the sandbox; the results show up in Orca as usual.
- **Three ways in:** Quick Commands, keyboard shortcuts, or an optional zsh hook that opens every terminal in the sandbox.

Current version: **v0.2.0** · macOS · Orca 1.4 or newer

## Requirements

- [Orca](https://www.onorca.dev/) 1.4.0 or newer
- Docker Sandboxes (`sbx`), signed in to a Docker account. Sandboxes run locally, but `sbx` requires the sign-in.

```sh
brew install --cask sbx
sbx login
```

## Install

1. In Orca, open **Settings → Plugins → Install plugin**, choose the **Git URL** tab and enter:
   ```
   https://github.com/MatsCornegoor/orca-sbx.git#v0.2.0
   ```
2. Review the permissions and enable the plugin.
3. Create a worktree. You get a "Creating Docker Sandbox…" notification, then "Docker Sandbox ready". The first sandbox takes a minute or two while the agent image downloads; later ones take about 10 seconds.

Check it with `sbx ls`: the new sandbox is called `orca-<worktree>-<hash>`.

When the plugin updates and adds new commands or permissions, Orca asks you to approve it again. Until you do, the plugin doesn't run.

## Use it

New terminals still open on your Mac. Pick one or more of these ways into the sandbox.

### Quick Commands (recommended)

Orca's Quick Commands (the ▶ button next to **+** in the tab bar) open a new tab and run a command in it. Add these two once, in **Settings → Quick Commands**, scoped globally. Paste each as one line.

**Sandbox shell**

```
d=$(git rev-parse --show-toplevel) && c=$(git rev-parse --path-format=absolute --git-common-dir) && g=$(git rev-parse --absolute-git-dir) && { case "$c" in "$d"/*) set -- "$d" ;; *) mkdir -p "$c/logs"; set -- "$d" "${c}:ro" "$c/objects" "$c/refs" "$c/logs" "$g" ;; esac; } && n="orca-$(printf %s "$(basename "$d")" | tr -c 'A-Za-z0-9.-' '-')-$(printf %s "$d" | shasum | cut -c1-6)" && { sbx ls -q | grep -qx -- "$n" || sbx create --name "$n" claude "$@"; } && sbx exec -it -w "$PWD" "$n" bash -l
```

**Claude in sandbox**

```
d=$(git rev-parse --show-toplevel) && c=$(git rev-parse --path-format=absolute --git-common-dir) && g=$(git rev-parse --absolute-git-dir) && { case "$c" in "$d"/*) set -- "$d" ;; *) mkdir -p "$c/logs"; set -- "$d" "${c}:ro" "$c/objects" "$c/refs" "$c/logs" "$g" ;; esac; } && n="orca-$(printf %s "$(basename "$d")" | tr -c 'A-Za-z0-9.-' '-')-$(printf %s "$d" | shasum | cut -c1-6)" && { sbx ls -q | grep -qx -- "$n" || sbx create --name "$n" claude "$@"; } && sbx run "$n"
```

Then, in a worktree: ▶ → **Sandbox shell** or **Claude in sandbox**. The sandbox is created first if it doesn't exist yet.

### Keyboard shortcuts

Open a terminal in the worktree, then:

| Shortcut | Cmd+J command | Does |
|---|---|---|
| ⌘⌥B | Docker Sandbox: Open shell in sandbox | Opens a shell inside the sandbox |
| ⌘⌥L | Docker Sandbox: Start Claude in sandbox | Starts Claude inside the sandbox |

The plugin types the command into the worktree's **first** terminal; plugins can't tell which terminal is in front. With several terminals open, use Quick Commands instead.

### zsh hook: every terminal in the sandbox (optional)

For fully automatic setup: in a worktree that has a sandbox, every new Orca terminal opens inside it, and `claude` (including agents Orca launches) runs inside it.

**Install from Orca:** Cmd+J → **Docker Sandbox: Install zsh hook**. It copies the hook to `~/.local/share/orca-sbx/`, backs up `~/.zshrc` to `~/.zshrc.orca-sbx.bak`, and adds one `source` line. The plugin keeps the copy up to date.

**Or by hand:**

```sh
mkdir -p ~/.local/share/orca-sbx
curl -fsSL https://raw.githubusercontent.com/MatsCornegoor/orca-sbx/v0.2.0/shell/orca-sbx.zsh \
  -o ~/.local/share/orca-sbx/orca-sbx.zsh
echo 'source ~/.local/share/orca-sbx/orca-sbx.zsh' >> ~/.zshrc
```

Good to know:

- It only acts in Orca terminals of linked worktrees that have a sandbox. Main checkouts and terminals outside Orca are untouched.
- New terminals in those worktrees wait for `sbx ls`: about 2 seconds, longer when `sbx` is waking up, never more than 15.
- zsh only (the macOS default).
- Turn it off with `export ORCA_SBX=off` in `~/.zshenv`. Remove it with Cmd+J → **Docker Sandbox: Remove zsh hook**.

### Inside the sandbox

- `exit` takes you back to your Mac.
- `hostname` shows the sandbox name and `uname -a` says Linux, so you can tell where you are.
- The worktree is at the same path as on your Mac, and changes are shared both ways.
- `git gc` doesn't work inside the sandbox; run it on your Mac.
- Claude's sessions are stored inside the sandbox, not on your Mac.

## How it works

| Orca event | Plugin runs |
|---|---|
| Worktree created | `sbx create --name orca-<worktree>-<hash> claude <worktree> <git mounts>` |
| Worktree removed | `sbx rm --force orca-<worktree>-<hash>` |

The sandbox name is derived from the worktree path, so the plugin, Quick Commands, shortcuts and zsh hook all find the same sandbox without storing anything.

### Git protection

A linked worktree's `.git` is a pointer into the main repo's `.git`, so the sandbox needs that folder. To stop the sandbox from planting git hooks or config that would run on your Mac, the main repo's `.git` is mounted **read-only**, with only what git needs to write on top:

- `.git/objects`, `.git/refs`, `.git/logs`: commits, branches, stash, fetch
- `.git/worktrees/<name>`: this worktree's `HEAD` and index

This blocks writing to `.git/hooks`, `.git/config` and `git config`, while commit, branch, stash, fetch, pull and push keep working. Details and test results are in [testing.md](testing.md#git-protection).

## Security

The sandbox keeps your files out of reach, but treat it as a strong fence, not a vault:

- The worktree and `.git/worktrees/<name>` must stay writable, and both contain the pointer files git follows. Something in the sandbox could redirect those to a git folder it controls, which would then apply when git runs in that worktree on your Mac.
- Sandboxes for **main checkouts** (made via Quick Commands or a shortcut) get no git protection, because their `.git` holds `HEAD` and the index.
- Sandboxes created before v0.2.0 have a fully writable `.git`. Remove them with `sbx rm <name>` and recreate them with a Quick Command or shortcut.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Plugin installation failed" | Check the URL ends in `#v0.2.0`. Make sure `git` works in a terminal. |
| No sandbox after creating a worktree | Approve the plugin again in Settings → Plugins. Check `sbx ls` and that `sbx login` is done. |
| "Not authenticated to Docker" | Run `sbx login`. |
| Shortcut typed into the wrong terminal | Close the extra terminals, or use Quick Commands. |
| New terminals are slow (zsh hook) | Expected: about 2 seconds per new terminal in a sandboxed worktree. Turn it off with `export ORCA_SBX=off` in `~/.zshenv`. |
| Need Claude on your Mac instead (zsh hook) | Run `command claude`. |
| A sandbox is left over | `sbx ls`, then `sbx rm <name>`. |

## Uninstall

1. If you installed the zsh hook: Cmd+J → **Docker Sandbox: Remove zsh hook**.
2. Settings → Plugins → remove **Docker Sandboxes**.
3. Remove leftover sandboxes: `sbx ls`, then `sbx rm <name>` for each `orca-…` sandbox.

## Limitations

- **Unofficial workarounds:** Orca's plugin API has no permission to run programs yet. The plugin runs `sbx` and edits `~/.zshrc` (only when you ask) using plain Node, which works today but a future Orca release could block it.
- **Agent status:** Orca may not show working/done status for Claude running in a sandbox. Not checked yet.
- **Agent:** sandboxes are created for Claude. Change `AGENT` at the top of `main.mjs` for another agent (codex, gemini, opencode, …).

## Development

- **Load your clone:** Settings → Plugins → Development → add the folder. If a change doesn't take effect, turn the plugin off and on.
- **Test notes:** everything we tried, what's tested where, and the options we rejected are in [testing.md](testing.md).
- **Release:** bump `version` in `orca-plugin.json`, update the version in this README, commit, then:
  ```sh
  git tag -a v0.2.1 -m v0.2.1 && git push origin main v0.2.1
  ```
