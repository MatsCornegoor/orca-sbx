# orca-sbx shell hook. Source it from ~/.zshrc.
#
# In an Orca terminal of a linked worktree that has a sandbox:
#   - a plain terminal opens a shell inside the sandbox; `exit` returns to the Mac
#   - `claude`, including the one Orca launches for an agent, runs inside it
#
# Escape hatches: `export ORCA_SBX=off` in ~/.zshenv turns the hook off,
# and `command claude` runs Claude on the Mac.

() {
  [[ -o interactive && -n $ORCA_WORKTREE_ID && $ORCA_SBX != off ]] || return 0
  (( $+commands[sbx] )) || return 0

  # Only linked worktrees get sandboxes; skip main checkouts before paying
  # for `sbx ls`.
  local -a git_dirs
  git_dirs=("${(@f)$(git rev-parse --show-toplevel --path-format=absolute \
    --git-dir --git-common-dir 2>/dev/null)}") || return 0
  (( ${#git_dirs} == 3 )) && [[ ${git_dirs[2]} != ${git_dirs[3]} ]] || return 0
  local top=${git_dirs[1]}

  # Same name as sandboxName() in main.mjs.
  local slug=${${top:t}//[^A-Za-z0-9.-]/-}
  local name="orca-$slug-$(printf %s "$top" | shasum | cut -c1-6)"

  # `sbx ls` takes ~1.5s, ~10s when its daemon wakes up. perl's alarm (macOS
  # has no `timeout`) kills it after 15s so a stuck daemon can't freeze every
  # new terminal.
  local sandboxes
  sandboxes=$(perl -e 'alarm 15; exec @ARGV' sbx ls -q 2>/dev/null)
  [[ ${${(f)sandboxes}[(Ie)$name]} -gt 0 ]] || return 0

  typeset -g ORCA_SBX_NAME=$name
  claude() { sbx run "$ORCA_SBX_NAME" -- "$@" }

  # Orca passes an agent launch in this variable and runs it at the first
  # prompt, where the claude() function above picks it up. Only plain
  # terminals get moved into the sandbox shell.
  if [[ -z ${ORCA_POSIX_SHELL_STARTUP_COMMAND+set} ]]; then
    __orca_sbx_enter() {
      precmd_functions=(${precmd_functions:#__orca_sbx_enter})
      unfunction __orca_sbx_enter
      sbx exec -it -w "$PWD" "$ORCA_SBX_NAME" bash -l
    }
    precmd_functions+=(__orca_sbx_enter)
  fi
}
