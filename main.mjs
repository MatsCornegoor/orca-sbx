// Orca plugin: one Docker Sandbox per worktree.
//
// Runs in Orca's plugin worker (plain Node). Orca's v0 capability set has no
// process permission yet, so spawning `sbx` here works because the worker is
// unsandboxed Node, not because Orca grants it. Expect this to move behind a
// `process:exec` capability once Orca ships one.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, relative } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Agent the sandbox is created for: claude, codex, gemini, opencode, shell, ...
const AGENT = 'claude'

// Orca launched from Finder may not have Homebrew on PATH.
const SBX_CANDIDATES = ['/opt/homebrew/bin/sbx', '/usr/local/bin/sbx']
const sbx = SBX_CANDIDATES.find((p) => existsSync(p)) ?? 'sbx'

// Deterministic from the path, so create and remove agree without storage.
// The hash keeps two repos with same-named worktrees apart.
export function sandboxName(worktreePath) {
  const slug = basename(worktreePath).replace(/[^A-Za-z0-9.-]/g, '-')
  const hash = createHash('sha1').update(worktreePath).digest('hex').slice(0, 6)
  return `orca-${slug}-${hash}`
}

// A linked worktree's .git is a pointer into the main repo's .git, so the
// sandbox also needs that directory mounted (writable: commits land there).
async function gitCommonDir(worktreePath) {
  try {
    const { stdout } = await run('git', [
      '-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-common-dir'
    ])
    const dir = stdout.trim()
    const rel = relative(worktreePath, dir)
    const insideWorktree = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    return insideWorktree ? null : dir
  } catch {
    return null
  }
}

async function workspaceArgs(worktreePath) {
  const commonDir = await gitCommonDir(worktreePath)
  return commonDir ? [worktreePath, commonDir] : [worktreePath]
}

export default function activate(orca) {
  const notify = (title, body) =>
    orca.host.call('notifications.show', { title, body }).catch(() => {})

  const seconds = (start) => `${Math.round((Date.now() - start) / 1000)}s`
  const errorText = (err) => (err.stderr || err.message).trim()

  orca.events.on('worktree.created', async ({ path }) => {
    const name = sandboxName(path)
    const start = Date.now()
    notify('Creating Docker Sandbox…', `${basename(path)} → ${name}`)
    try {
      await run(sbx, ['create', '--name', name, AGENT, ...(await workspaceArgs(path))])
      orca.log(`created sandbox ${name} for ${path}`)
      notify('Docker Sandbox ready', `${basename(path)} · ${AGENT} · ${seconds(start)}`)
    } catch (err) {
      orca.log(`sbx create failed for ${path}: ${errorText(err)}`)
      notify('Docker Sandbox not created', `${name}: ${errorText(err)}`)
    }
  })

  orca.events.on('worktree.removed', async ({ path }) => {
    const name = sandboxName(path)
    try {
      await run(sbx, ['rm', '--force', name])
      orca.log(`removed sandbox ${name}`)
      notify('Docker Sandbox removed', `${basename(path)} → ${name}`)
    } catch (err) {
      orca.log(`sbx rm ${name}: ${errorText(err)}`)
      // "Not found" is normal for worktrees that predate the plugin.
      if (!/not found|no such/i.test(errorText(err))) {
        notify('Docker Sandbox not removed', `${name}: ${errorText(err)}`)
      }
    }
  })

  // Types the attach command into the focused worktree's terminal, creating
  // the sandbox first if it is missing (worktrees made before the plugin was
  // installed, or a create that failed). The name is computed in the shell from
  // the repo top level, mirroring sandboxName().
  orca.commands.register('sbx-run', async () => {
    const ctx = await orca.host.call('workspace.readContext', {})
    const terminalId = ctx?.terminals?.[0]?.id
    if (!terminalId) {
      notify('Docker Sandbox', 'Open a terminal in this worktree first.')
      return { ok: false }
    }
    const text = [
      'd=$(git rev-parse --show-toplevel)',
      'c=$(git rev-parse --path-format=absolute --git-common-dir)',
      'case "$c" in "$d"/*) c= ;; esac',
      `n="orca-$(printf %s "$(basename "$d")" | tr -c 'A-Za-z0-9.-' '-')-$(printf %s "$d" | shasum | cut -c1-6)"`,
      `if ${sbx} ls -q | grep -qx "$n"; then ${sbx} run "$n"; else ${sbx} run --name "$n" ${AGENT} "$d" \${c:+"$c"}; fi`
    ].join('; ')
    await orca.host.call('terminal.sendText', { terminalId, text, enter: true })
    return { ok: true }
  })
}
