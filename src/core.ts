// destroyer core — types, config, module loading, scan, sets, path safety.
// P1 = read-only: nothing here deletes anything. Targets carry an `action` (data) that a future `apply` will execute.
import { readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { $ } from 'bun'

export type Tier = 'A' | 'B' | 'C'
export type Action =
  | { kind: 'rm'; paths: string[]; keepDir?: boolean } // keepDir = delete contents, keep the folder
  | { kind: 'exec'; argv: string[] }                    // owner's own tool first (simctl, sdkmanager…)
  | { kind: 'sudo'; cmd: string }                       // printed for the user, NEVER executed by destroyer
export type Target = {
  id: string; label: string; bytes: number; tier: Tier; regen: string
  paths: string[]; action: Action; owners?: string[]; note?: string; module?: string
}
export type Mod = {
  id: string; kind?: 'cleaner' | 'reporter'
  detect?: (c: Ctx) => boolean | Promise<boolean>
  scan?: (c: Ctx) => Promise<Target[]>
  annotate?: (t: Target[], c: Ctx) => Promise<Record<string, string>>
}

export const HOME = homedir()
export const CONFIG = process.env.DESTROYER_CONFIG ?? join(HOME, '.config/destroyer')
export const expand = (p: string) => p.replace(/^~/, HOME)
export const short = (p: string) => (p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p)
export const fmt = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.round(b / 1e6) + ' MB')
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '')

// ---------- path safety (the same gate a future `apply` uses) ----------
const INSIDE_DENY = ['.ssh', '.gnupg', '.claude', 'Documents', 'Desktop', 'Pictures', 'Music', 'Movies', 'Downloads', 'Library/Keychains', 'Library/Mail', 'Library/Messages']
const EQUAL_DENY = ['Library', 'Library/Application Support', 'Library/Caches', 'Library/Developer', 'Library/Containers', 'Project', 'Applications', 'Public', '.config', '.local', '.cache', '.gradle', '.android', '.pub-cache', '.nvm', '.rbenv', '.vscode', '.Trash']
export function checkPath(p: string, home = HOME): string | null {
  if (!p.startsWith('/') || p.split('/').includes('..')) return 'ต้องเป็น path เต็มและไม่มี ..'
  const n = p.replace(/\/+$/, '')
  if (n === '/Library/Developer/CoreSimulator' || n.startsWith('/Library/Developer/CoreSimulator/')) return n === '/Library/Developer/CoreSimulator' ? 'ตื้นเกินไป' : null
  if (n === home) return 'ห้ามลบ home ทั้งโฟลเดอร์'
  if (!n.startsWith(home + '/')) return 'อยู่นอก home (ไม่อนุญาต)'
  const rel = n.slice(home.length + 1)
  const hit = INSIDE_DENY.find(x => rel === x || rel.startsWith(x + '/')); if (hit) return `อยู่ในของที่ห้ามแตะ (~/${hit})`
  if (EQUAL_DENY.includes(rel)) return `กว้างเกินไป (~/${rel} ทั้งโฟลเดอร์)`
  return null
}
export let execCheck: ((argv: string[]) => string | null) | undefined   // set by exec.ts (avoids an import cycle)
export const setExecCheck = (f: (argv: string[]) => string | null) => { execCheck = f }
export function validateTarget(t: Partial<Target>): string[] {
  const e: string[] = [], at = `target "${t.id}"`
  if (!t.id || typeof t.id !== 'string') e.push('ต้องมี id')
  if (!['A', 'B', 'C'].includes(t.tier as string)) e.push(`${at}: tier '${t.tier}' ใช้ไม่ได้ — ต้องเป็น A/B/C (D คือของที่ห้ามแตะ ประกาศไม่ได้)`)
  if (!(Number.isFinite(t.bytes) && (t.bytes as number) >= 0)) e.push(`${at}: bytes ต้องเป็นตัวเลข`)
  if (!Array.isArray(t.paths)) e.push(`${at}: paths ต้องเป็น array`)
  const a = t.action
  if (!a) e.push(`${at}: ต้องมี action`)
  else if (a.kind === 'rm') { if (!a.paths?.length) e.push(`${at}: rm ต้องมี paths`); for (const p of a.paths ?? []) { const x = checkPath(p); if (x) e.push(`${at}: ไม่ปลอดภัย ${short(p)} — ${x}`) } }
  else if (a.kind === 'exec') { if (!a.argv?.length) e.push(`${at}: exec ต้องมี argv`); else { const x = execCheck?.(a.argv); if (x) e.push(`${at}: ${x}`) } }
  else if (a.kind === 'sudo') { if (!a.cmd?.startsWith('sudo ')) e.push(`${at}: sudo cmd ต้องขึ้นต้นด้วย "sudo "`) }
  else e.push(`${at}: action.kind '${(a as any).kind}' ไม่รู้จัก`)
  return e
}

// ---------- config ----------
export type Config = { roots: string[] }
export function readConfig(): Config {
  const f = join(CONFIG, 'config.toml'), c: any = existsSync(f) ? Bun.TOML.parse(readFileSync(f, 'utf8')) : {}
  return { roots: c.roots ?? ['~/Project'] }   // where your git repos live (projects module)
}

// ---------- context handed to modules ----------
export type Ctx = ReturnType<typeof makeCtx>
// size cache: du on 300k-file folders takes ~10s, so remember sizes for 10 minutes (--fresh = measure again)
const CACHE_FILE = join(process.env.XDG_CACHE_HOME ?? join(HOME, '.cache'), 'destroyer/du.json')
let cache: Record<string, [number, number]> = {}
try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) } catch {}
export const cacheStats = { hits: 0, oldestMs: 0 }
const TTL = process.argv.includes('--fresh') ? 0 : 600_000
export function clearCache() { cache = {}; saveCache() }   // after apply: sizes of what we just emptied are stale
export function saveCache() { try { mkdirSync(dirname(CACHE_FILE), { recursive: true }); writeFileSync(CACHE_FILE, JSON.stringify(cache)) } catch {} }
export function makeCtx(cfg = readConfig()) {
  const dirs = (p: string) => { try { return readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => join(p, d.name)) } catch { return [] as string[] } }
  const du1 = async (p: string) => {
    if (!existsSync(p)) return 0
    const hit = cache[p], age = hit ? Date.now() - hit[1] : Infinity
    if (TTL && age < TTL) { cacheStats.hits++; cacheStats.oldestMs = Math.max(cacheStats.oldestMs, age); return hit[0] }
    const b = (parseInt(await $`du -sk ${p}`.quiet().nothrow().text()) || 0) * 1024; cache[p] = [b, Date.now()]; return b
  }
  const repos = (maxDepth = 3) => {
    const out: string[] = []
    const walk = (d: string, depth: number) => {
      if (existsSync(join(d, '.git'))) return void out.push(d)
      if (depth >= maxDepth) return
      for (const c of dirs(d)) { const n = c.split('/').pop()!; if (!n.startsWith('.') && n !== 'node_modules') walk(c, depth + 1) }
    }
    for (const r of cfg.roots) walk(expand(r), 0)
    return out
  }
  return {
    home: HOME, join, exists: existsSync, sh: $, dirs, repos, config: cfg,
    has: (cmd: string) => Bun.which(cmd) !== null,
    du: async (p: string | string[]) => (await Promise.all([p].flat().map(du1))).reduce((a, b) => a + b, 0),
  }
}

// ---------- loading modules (built-in only: nothing a user drops in can widen what the tool is allowed to clean) ----------
export type Loaded = { mod: Mod; source: string; file: string; status: 'loaded' | 'skipped'; why?: string }
export async function load(ctx: Ctx): Promise<Loaded[]> {
  const dir = join(import.meta.dir, 'modules'), out: Loaded[] = []
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ts')).sort()) {
    const file = join(dir, f)
    try {
      const mod: Mod = (await import(file)).default
      const ok = mod.detect ? await mod.detect(ctx) : true
      out.push({ mod, source: 'built-in', file, status: ok ? 'loaded' : 'skipped', why: ok ? undefined : 'detect() = false' })
    } catch (e) { out.push({ mod: { id: f }, source: 'built-in', file, status: 'skipped', why: `error: ${e}` }) } // one broken module never breaks the rest
  }
  return out
}

// ---------- scan ----------
export type ScanHooks = { start?: (id: string) => void; done?: (id: string, n: number, bytes: number, ms: number) => void; fail?: (id: string, why: string) => void }
export async function scan(ctx: Ctx, mods: Loaded[], hooks: ScanHooks = {}) {
  const targets: Target[] = [], counts: Record<string, number> = {}, warnings: string[] = [], seen = new Set<string>()
  // cleaners run in parallel; processing of each result is synchronous, so `seen` stays consistent
  await Promise.all(mods.filter(l => l.status === 'loaded' && l.mod.scan).map(async l => {
    const id = l.mod.id, t0 = performance.now(); hooks.start?.(id)
    try {
      const ts = await l.mod.scan!(ctx); let n = 0, bytes = 0
      for (const t of ts) {
        if (!inPreset(t.id)) continue                     // not in the preset = not shown, not cleanable
        const errs = validateTarget(t)
        if (errs.length) { warnings.push(`${id}: ข้าม "${t.id}" — ${errs.join('; ')}`); continue }
        if (seen.has(t.id)) { warnings.push(`${id}: id ซ้ำ "${t.id}" — ข้าม`); continue }
        seen.add(t.id); n++; bytes += t.bytes; targets.push({ ...t, module: id })
      }
      counts[id] = n; hooks.done?.(id, n, bytes, performance.now() - t0)
    } catch (e) { l.status = 'skipped'; l.why = `scan error: ${e}`; warnings.push(`${id}: scan error ${e}`); hooks.fail?.(id, String(e)) }
  }))
  for (const l of mods.filter(l => l.status === 'loaded' && l.mod.annotate)) {
    const t0 = performance.now(); hooks.start?.(l.mod.id)
    try {
      const notes = await l.mod.annotate!(targets, ctx); counts[l.mod.id] = Object.keys(notes).length
      for (const t of targets) if (notes[t.id]) t.note = [t.note, notes[t.id]].filter(Boolean).join(' · ')
      hooks.done?.(l.mod.id, counts[l.mod.id], 0, performance.now() - t0)
    } catch (e) { warnings.push(`${l.mod.id}: annotate error ${e}`); hooks.fail?.(l.mod.id, String(e)) }
  }
  targets.sort((a, b) => a.tier.localeCompare(b.tier) || b.bytes - a.bytes)
  return { targets, counts, warnings }
}

// ---------- preset: the ONLY things this tool may clean (config/preset.toml is part of the code, not user config) ----------
export type Preset = { name: string; allow: string[] }
export const globRe = (g: string) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
export function loadPreset(file = join(import.meta.dir, '../config/preset.toml')): Preset {
  const p: any = Bun.TOML.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(p.allow) || !p.allow.length) throw new Error('preset.toml ต้องมี allow = [...] อย่างน้อย 1 รายการ')
  for (const g of p.allow) {
    if (typeof g !== 'string' || !/^[a-z][a-z-]*:\S+$/.test(g)) throw new Error(`preset: รูปแบบ "${g}" ไม่ถูกต้อง (ต้องเป็น module:ชื่อ)`)
    if (/^[a-z][a-z-]*:\*+$/.test(g)) throw new Error(`preset: "${g}" กว้างเกินไป (ทั้ง module) — ระบุให้เจาะจง`)
  }
  return { name: p.name ?? 'preset', allow: p.allow }
}
let presetCache: Preset | undefined
export const preset = () => (presetCache ??= loadPreset())
export const inPreset = (id: string, p: Preset = preset()) => p.allow.some(g => globRe(g).test(id))
export const presetMissing = (targets: Target[], p: Preset = preset()) => p.allow.filter(g => !targets.some(t => globRe(g).test(t.id)))
