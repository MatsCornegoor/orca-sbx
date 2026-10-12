// Orca plugin: one Docker Sandbox per worktree.
//
// Runs in Orca's plugin worker (plain Node). Orca's v0 capability set has no
// process permission yet, so spawning `sbx` here works because the worker is
// unsandboxed Node, not because Orca grants it. Expect this to move behind a
// `process:exec` capability once Orca ships one.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
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

// Shell command typed into a worktree terminal: work out the sandbox name from
// the repo top level (mirroring sandboxName()), create the sandbox if it is
// missing, then open a shell or the agent in it. The leading space keeps it out
// of shell history.
export function sandboxCommand(mode) {
  const base = [
    'd=$(git rev-parse --show-toplevel)',
    'c=$(git rev-parse --path-format=absolute --git-common-dir)',
    '{ case "$c" in "$d"/*) c= ;; esac; }',
    `n="orca-$(printf %s "$(basename "$d")" | tr -c 'A-Za-z0-9.-' '-')-$(printf %s "$d" | shasum | cut -c1-6)"`,
    `{ sbx ls -q | grep -qx -- "$n" || sbx create --name "$n" ${AGENT} "$d" \${c:+"$c"}; }`
  ].join(' && ')
  const attach = mode === 'shell' ? 'sbx exec -it -w "$PWD" "$n" bash -l' : 'sbx run "$n"'
  return ` ${base} && ${attach}`
}

// The optional zsh hook lives in a fixed place outside the plugin's install
// dir (which is renamed per version), so ~/.zshrc can point at it.
const HOOK_SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'shell', 'orca-sbx.zsh')
const HOOK_TARGET = join(homedir(), '.local', 'share', 'orca-sbx', 'orca-sbx.zsh')
const ZSHRC = join(homedir(), '.zshrc')
const HOOK_COMMENT = '# orca-sbx: open Orca worktree terminals inside their Docker Sandbox'
const HOOK_LINE = 'source ~/.local/share/orca-sbx/orca-sbx.zsh'
const HOOK_BLOCK = `\n${HOOK_COMMENT}\n${HOOK_LINE}\n`

async function readZshrc() {
  try {
    return await readFile(ZSHRC, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return ''
    throw err
  }
}

export async function installZshHook() {
  await mkdir(dirname(HOOK_TARGET), { recursive: true })
  await copyFile(HOOK_SOURCE, HOOK_TARGET)
  const rc = await readZshrc()
  if (rc.split('\n').includes(HOOK_LINE)) return { changedZshrc: false }
  if (rc) await writeFile(`${ZSHRC}.orca-sbx.bak`, rc)
  if (rc === '') {
    await writeFile(ZSHRC, HOOK_BLOCK.slice(1))
  } else {
    await writeFile(ZSHRC, `${rc}${rc.endsWith('\n') ? '' : '\n'}${HOOK_BLOCK}`)
  }
  return { changedZshrc: true }
}

export async function removeZshHook() {
  const rc = await readZshrc()
  // Undo exactly what install added; fall back to dropping the two lines if
  // the user moved them.
  const next = rc.includes(HOOK_BLOCK)
    ? rc.replace(HOOK_BLOCK, '')
    : rc.split('\n').filter((line) => line !== HOOK_LINE && line !== HOOK_COMMENT).join('\n')
  if (next !== rc) {
    await writeFile(`${ZSHRC}.orca-sbx.bak`, rc)
    await writeFile(ZSHRC, next)
  }
  await rm(dirname(HOOK_TARGET), { recursive: true, force: true })
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

  // Keep an installed hook in step with this plugin version.
  if (existsSync(HOOK_TARGET)) {
    copyFile(HOOK_SOURCE, HOOK_TARGET).catch((err) => orca.log(`hook refresh failed: ${err.message}`))
  }

  orca.commands.register('zsh-hook-install', async () => {
    try {
      const { changedZshrc } = await installZshHook()
      notify(
        'zsh hook installed',
        changedZshrc
          ? 'Added one line to ~/.zshrc (backup: ~/.zshrc.orca-sbx.bak). Open a new terminal in a sandboxed worktree.'
          : 'Hook updated; ~/.zshrc already loads it.'
      )
      return { ok: true }
    } catch (err) {
      notify('zsh hook not installed', err.message)
      return { ok: false }
    }
  })

  orca.commands.register('zsh-hook-remove', async () => {
    try {
      await removeZshHook()
      notify('zsh hook removed', 'New terminals open on your Mac again.')
      return { ok: true }
    } catch (err) {
      notify('zsh hook not removed', err.message)
      return { ok: false }
    }
  })

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

  // Types the command into a terminal of the focused worktree. Plugins can't
  // open terminals or see which one is in front, so this uses the first.
  const sendToTerminal = (mode) => async () => {
    const ctx = await orca.host.call('workspace.readContext', {})
    const terminalId = ctx?.terminals?.[0]?.id
    if (!terminalId) {
      notify('Docker Sandbox', 'Open a terminal in this worktree first.')
      return { ok: false }
    }
    await orca.host.call('terminal.sendText', { terminalId, text: sandboxCommand(mode), enter: true })
    return { ok: true }
  }
  orca.commands.register('sbx-shell', sendToTerminal('shell'))
  orca.commands.register('sbx-claude', sendToTerminal('claude'))
}
