# orca-sbx

A small command that gives each [Orca](https://www.onorca.dev/) project its own [Docker Sandbox](https://docs.docker.com/ai/sandboxes/): a local microVM where your terminals, agents and git run without access to the rest of your Mac.

Orca connects to the sandbox over SSH, like any remote host. Every worktree you create on it, and every agent Orca starts in it, runs inside the sandbox. No plugin, no shell hooks.

- **One sandbox per project**, shared by the main checkout and all its worktrees.
- **Your code stays on your Mac.** The sandbox sees the project folder and its worktree folder, nothing else; changes go both ways.
- **Logins stay on your Mac.** Your Claude subscription and GitHub login are stored with `sbx secret` and added to requests on the way out. The tokens never enter the sandbox.
- **No keys, no ports.** `sbx` handles SSH itself; there's no sshd to run and nothing listening on your network.

macOS · Orca 1.4 or newer · `sbx` 0.47 or newer

## Install

```sh
brew install --cask docker/tap/sbx
curl -fsSL https://raw.githubusercontent.com/MatsCornegoor/orca-sbx/main/install.sh | sh
orca-sbx setup
```

The installer puts `orca-sbx` in `~/.local/bin`. If Homebrew refuses the Docker tap, run `brew trust docker/tap` first.

`orca-sbx setup` is a one-time step. It:

1. signs you in to Docker (`sbx` requires an account, even though sandboxes run locally),
2. turns on `sbx`'s SSH access, which is experimental and off by default, and restarts the `sbx` daemon,
3. runs `sbx setup ssh`, which adds one `Include` block to `~/.ssh/config` for `*.sbx` hosts,
4. stores your GitHub login as `gh auth token`, so it follows `gh` on your Mac,
5. tells you whether your Claude login is stored. If not: run `/login` once in a sandboxed Claude, or `sbx secret set anthropic`.

Running it again is safe.

## Per project

In the project's folder (the main checkout or any of its worktrees):

```sh
orca-sbx
```

It creates a sandbox named after the repo (`My App` → `my-app`) and prints what to add in Orca:

**Settings → SSH → Add Target**

| Field | Value |
|---|---|
| Host | `my-app.sbx` |
| Username | `agent` |
| Identity file | leave empty |

Then add the project on that target and create worktrees there. Running `orca-sbx` again only prints the target.

### As an Orca Quick Command

Add a Quick Command in **Settings → Quick Commands**, scoped globally:

```
orca-sbx
```

Then ▶ → that command in any project sets it up.

## Commands

| Command | Does |
|---|---|
| `orca-sbx` / `orca-sbx up` | Create this project's sandbox and print the SSH target |
| `orca-sbx shell` | Open a shell in the sandbox, in the current folder |
| `orca-sbx ls` | List the sandboxes made for Orca projects |
| `orca-sbx stop [name]` | Stop this project's sandbox, or the named one |
| `orca-sbx rm [name]` | Remove this project's sandbox, or the named one (asks first) |
| `orca-sbx setup` | One-time setup, see above |

You can also connect yourself with `ssh agent@my-app.sbx`. A stopped sandbox starts again when something connects.

Settings, as environment variables:

| Variable | Default | |
|---|---|---|
| `ORCA_SBX_AGENT` | `claude` | Agent the sandbox is made for: `codex`, `gemini`, `opencode`, `shell`, … |
| `ORCA_WORKSPACES` | `~/orca/workspaces` | Where Orca puts worktrees |

## How it works

```sh
sbx create --name my-app claude ~/orca/projects/my-app ~/orca/workspaces/my-app
```

Orca keeps a project's main checkout in one folder and its worktrees in `~/orca/workspaces/<repo>/`. The sandbox mounts both, at the same paths as on your Mac, so worktrees created later are inside it too, and git finds everything where it expects.

`sbx setup ssh` routes `*.sbx` hosts through a `ProxyCommand` that the `sbx` daemon answers. Orca sees the `ProxyCommand` and uses your system OpenSSH for those targets.

GitHub's token is only added to HTTPS requests, so `orca-sbx` sets git inside a new sandbox to use HTTPS for `git@github.com:` remotes. Your repo's config and your Mac don't change.

## Security

The sandbox keeps the rest of your Mac out of reach. Within a project, it's not a vault:

- **The project's `.git` is writable from the sandbox**, including `.git/hooks` and `.git/config`. Something in the sandbox could plant a hook that runs the next time git runs in that project on your Mac, including Orca's own background git calls. If you only use the project through the SSH target, git runs in the sandbox, not on your Mac.
- **All worktrees of a project share one sandbox**, so they share one blast radius.
- **`sbx` shares an agent-skills store across all sandboxes** by default. A skill written in one sandbox is visible in the others. See `sbx skills --help`.
- **Credentials you add inside the sandbox yourself**, like running `gh auth login` there, are stored in the sandbox, not proxied.

## Troubleshooting

| Problem | Fix |
|---|---|
| `the sandboxd SSH endpoint is disabled` | Run `orca-sbx setup`, or `sbx settings set feature.ssh true && sbx daemon restart && sbx setup ssh` |
| `not signed in to Docker` | `sbx login` |
| `user "…" not found` when connecting | Use `agent` as the username |
| `orca-sbx: command not found` | Add `~/.local/bin` to your `PATH` |
| `git push` asks for a password in the sandbox | Run `orca-sbx setup` to store the GitHub secret |
| A worktree doesn't show up on your Mac | Check Orca put it under `~/orca/workspaces/<repo>`; anything else exists only inside the sandbox |

## Uninstall

```sh
orca-sbx ls                      # then orca-sbx rm <name> for each
sbx setup ssh remove             # removes the block from ~/.ssh/config
rm ~/.local/bin/orca-sbx
```

Remove the SSH targets in Orca's settings as well.

## Development

Clone the repo and run `./install.sh`: it links `~/.local/bin/orca-sbx` to your clone, so edits apply straight away. Install a specific version with `ORCA_SBX_REF=v0.3.0` in front of the `sh` in the install command.
