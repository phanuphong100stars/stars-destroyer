// the only place that deletes anything. Every path is re-checked right before removal; symlinks are never followed.
import { lstatSync, readdirSync, realpathSync, appendFileSync, mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { checkPath, HOME, setExecCheck, type Target } from './core'

export type Outcome = { id: string; status: 'done' | 'failed' | 'blocked' | 'printed' | 'skipped' | 'dry'; bytes: number; ms: number; message?: string; cmd?: string }

// ---- exec allowlist: only the owner's own tools, only these shapes, never through a shell
const UUID = /^[0-9A-Fa-f-]{36}$/
export function checkExec(argv: string[]): string | null {
  const [bin = '', ...a] = argv, name = bin.split('/').pop()
  if (name === 'xcrun' && a[0] === 'simctl' && a[1] === 'delete' && a.length === 3 && UUID.test(a[2])) return null
  if (name === 'xcrun' && a[0] === 'simctl' && a[1] === 'runtime' && a[2] === 'delete' && a.length === 4 && UUID.test(a[3])) return null
  if (name === 'avdmanager' && a.length === 4 && a[0] === 'delete' && a[1] === 'avd' && a[2] === '-n' && /^[\w.-]+$/.test(a[3])) return null
  if (name === 'sdkmanager' && a.length === 2 && a[0] === '--uninstall' && /^[\w;.\-]+$/.test(a[1])) return null
  return 'คำสั่งนี้ไม่อยู่ใน allowlist (xcrun simctl delete / runtime delete, avdmanager delete avd, sdkmanager --uninstall)'
}

setExecCheck(checkExec)

// ---- who owns a target: don't delete under a running app
const OWNER: Record<string, { pat: string; stop?: boolean }> = {
  'Gradle daemon': { pat: 'GradleDaemon', stop: true },
  'IDE (Dart analysis server)': { pat: 'analysis_server', stop: true },
  'Visual Studio Code': { pat: 'Visual Studio Code.app/' },   // Electron = many processes (main, helpers, crashpad): match any inside the bundle
  Xcode: { pat: 'Xcode.app/Contents/MacOS/Xcode' },
  Simulator: { pat: 'Simulator.app/Contents/MacOS/Simulator' },
  'Android emulator': { pat: 'qemu-system' },
}
export const stoppable = (owner: string) => !!OWNER[owner]?.stop
// Xcode stays specific: its build services run from Xcode.app even when the GUI is closed
export const ownerPattern = (owner: string) => OWNER[owner]?.pat ?? `${owner}.app/`
const pat = ownerPattern
export function runningOwner(owner: string): number[] {
  const r = Bun.spawnSync(['pgrep', '-f', pat(owner)])
  return r.exitCode === 0 ? new TextDecoder().decode(r.stdout).split('\n').filter(Boolean).map(Number).filter(p => p !== process.pid) : []
}
export async function stopOwner(owner: string): Promise<boolean> { // only for "stoppable" owners (daemons that restart by themselves)
  if (!stoppable(owner)) return false
  Bun.spawnSync(['pkill', '-TERM', '-f', pat(owner)])
  for (let i = 0; i < 15; i++) { if (!runningOwner(owner).length) return true; await Bun.sleep(200) }
  return false
}

// ---- removal
async function removePath(p: string, keepDir: boolean, home: string): Promise<number> {
  const bad = checkPath(p, home); if (bad) throw new Error(`ไม่ปลอดภัย: ${bad}`)
  const st = lstatSync(p, { throwIfNoEntry: false }); if (!st) return 0
  if (st.isSymbolicLink()) throw new Error('เป็น symlink — ไม่ลบ')
  const bad2 = checkPath(realpathSync(p), realpathSync(home)); if (bad2) throw new Error(`ไม่ปลอดภัย (หลังแปลง symlink): ${bad2}`)
  if (keepDir) { for (const c of readdirSync(p)) await rm(join(p, c), { recursive: true, force: true }) } // children only; a symlink child is unlinked, never followed
  else await rm(p, { recursive: true, force: true })
  return 1
}
export async function applyTarget(t: Target, o: { home?: string; dryRun?: boolean } = {}): Promise<Outcome> {
  const t0 = performance.now(), home = o.home ?? HOME, a = t.action
  const res = (status: Outcome['status'], message?: string, cmd?: string): Outcome => ({ id: t.id, status, bytes: status === 'done' ? t.bytes : 0, ms: Math.round(performance.now() - t0), message, cmd })
  if (a.kind === 'sudo') return res('printed', undefined, a.cmd)   // never executed
  if (o.dryRun) return res('dry')
  try {
    if (a.kind === 'exec') {
      const bad = checkExec(a.argv); if (bad) return res('failed', bad)
      const p = Bun.spawn(a.argv, { stdout: 'pipe', stderr: 'pipe' })
      const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()])
      return code === 0 ? res('done') : res('failed', (err.trim() || `exit ${code}`).slice(0, 200))
    }
    let removed = 0
    for (const p of a.paths) removed += await removePath(p, !!a.keepDir, home)
    return removed ? res('done') : res('skipped', 'ไม่มีแล้ว')
  } catch (e: any) { return res('failed', String(e?.message ?? e)) }
}

// ---- log (JSONL, one line per action)
export const logDir = () => process.env.DESTROYER_LOG_DIR ?? join(HOME, 'Library/Logs/destroyer')
export const logFile = () => join(logDir(), new Date().toISOString().slice(0, 10) + '.jsonl')
export function logLine(o: object) { try { mkdirSync(logDir(), { recursive: true }); appendFileSync(logFile(), JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n') } catch {} }
