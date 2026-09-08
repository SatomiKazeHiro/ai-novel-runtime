// Cross-platform dev orchestrator.
//
// Why this exists: on Windows, `concurrently` and `pnpm -r --parallel` both
// funnel subcommands through pnpm.cmd → cmd.exe, so Ctrl+C surfaces the
// "终止批处理操作 (Y/N)?" prompt before the process tree dies. This script
// spawns the two dev subprocesses as bare Node processes (tsx watch + vite's
// Node entry), so cmd.exe never enters the picture and Ctrl+C is silent.
//
// On non-Windows platforms the same code path works — `shell:false` with
// process.execPath (Node) is portable. pnpm shims are only consulted for
// predev package builds, which this script assumes have already been run
// (`pnpm install` then start dev — server/web `predev` hooks also rebuild).

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const TSX_ENTRY = resolve(ROOT, 'node_modules/tsx/dist/cli.mjs')
const VITE_ENTRY = resolve(ROOT, 'apps/web/node_modules/vite/bin/vite.js')

const jobs = [
  {
    name: 'server',
    color: 33,
    cwd: resolve(ROOT, 'apps/server'),
    command: process.execPath,
    args: [TSX_ENTRY, 'watch', '--clear-screen=false', 'src/server.ts']
  },
  {
    name: 'web',
    color: 36,
    cwd: resolve(ROOT, 'apps/web'),
    command: process.execPath,
    args: [VITE_ENTRY]
  }
]

// Sanity check: require that packages have been built at least once.
const missingDist = ['ai-provider', 'knowledge-graph', 'memory-engine', 'prompt-runtime', 'shared']
  .filter((p) => !existsSync(resolve(ROOT, 'packages', p, 'dist')))
if (missingDist.length > 0) {
  console.error(`[dev] missing packages/*/dist for: ${missingDist.join(', ')}`)
  console.error('[dev] run `pnpm install` first, or `pnpm -r --filter "./packages/*" build`.')
  process.exit(1)
}

const children = []
let shuttingDown = false

function prefix(name, color) {
  return `\x1b[${color}m[${name}]\x1b[0m `
}

function pipeOutput(child, name, color) {
  const tag = prefix(name, color)
  const forward = (stream) => (chunk) => {
    const text = chunk.toString()
    const lines = text.split(/\r?\n/)
    const out = lines.map((l, i) => (i === lines.length - 1 && l === '' ? '' : tag + l)).join('\n')
    stream.write(out)
  }
  child.stdout.on('data', forward(process.stdout))
  child.stderr.on('data', forward(process.stderr))
}

for (const job of jobs) {
  const child = spawn(job.command, job.args, {
    cwd: job.cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    windowsHide: true
  })
  children.push(child)
  pipeOutput(child, job.name, job.color)

  child.on('exit', (code, signal) => {
    process.stdout.write(`\n${prefix(job.name, job.color)}exited code=${code} signal=${signal || 'none'}\n`)
    if (shuttingDown) return
    shuttingDown = true
    const exitCode = signal
      ? 128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1)
      : (code ?? 1)
    shutdown(exitCode)
  })
}

function shutdown(exitCode) {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    try { child.kill('SIGTERM') } catch {}
  }
  // SIGTERM should let tsx watch and vite flush; escalate to SIGKILL if alive.
  const escalation = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      try { child.kill('SIGKILL') } catch {}
    }
  }, 1500)
  // Give stdout/stderr a beat to flush, then exit.
  setTimeout(() => {
    clearTimeout(escalation)
    process.exit(exitCode)
  }, 1800)
}

process.on('SIGINT',  () => { if (!shuttingDown) { shuttingDown = true; shutdown(130) } })
process.on('SIGTERM', () => { if (!shuttingDown) { shuttingDown = true; shutdown(143) } })