// discover: big folders no module/target covers yet. Skips covered paths (that's what makes it fast), hides system/protected.
import { join } from 'node:path'
import { HOME, short, globRe, expand, daysAgo, type Ctx, type Target } from './core'
const PROT = new Set(['.claude', '.ssh', '.gnupg', '.Trash', '.config', '.local', '.android', '.git'])
export const tierGuess = (p: string): 'B' | 'C' => (/\/Caches\/|cache|model|download|tmp|temp|archive/i.test(p) ? 'B' : 'C')
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>) {
  const out: R[] = []; let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]) } })); return out
}
export async function discover(ctx: Ctx, targets: Target[], minMB: number, onProgress?: (done: number, total: number, found: number) => void) {
  const covered = targets.flatMap(t => t.paths), ignore = ctx.config.ignore.map(g => globRe(expand(g))), min = minMB * 1e6
  const isCovered = (p: string) => covered.some(c => c === p || p.startsWith(c + '/'))
  const holdsCovered = (p: string) => covered.some(c => c.startsWith(p + '/'))
  const ignored = (p: string) => ignore.some(re => re.test(p))
  let skipped = 0; const queue: string[] = []
  const add = (p: string, depth = 0) => {
    if (isCovered(p) || ignored(p)) return void skipped++
    if (holdsCovered(p) && depth < 3) return void ctx.dirs(p).forEach(k => add(k, depth + 1))
    queue.push(p)
  }
  const roots: [string, (n: string) => boolean][] = [[join(HOME, 'Library/Application Support'), () => true], [join(HOME, 'Library/Caches'), () => true], [HOME, n => n.startsWith('.')]]
  for (const [root, ok] of roots) for (const d of ctx.dirs(root)) { const n = d.split('/').pop()!; if (ok(n) && !/^com\.apple\./.test(n) && !PROT.has(n)) add(d) }
  let done = 0, found = 0
  const sized = await pool(queue, 8, async p => { const b = await ctx.du(p); done++; if (b >= min) found++; onProgress?.(done, queue.length, found); return { p, b } })
  let rows = sized.filter(r => r.b >= min)
  const big = rows.filter(r => r.b >= 500e6)
  const kids = await pool(big, 4, async r => (await pool(ctx.dirs(r.p).filter(k => !isCovered(k) && !ignored(k)), 8, async k => ({ p: k, b: await ctx.du(k) }))).filter(k => k.b >= min))
  rows = rows.flatMap(r => { const i = big.indexOf(r); return i >= 0 && kids[i].length ? kids[i] : [r] })
  return { skipped, rows: rows.sort((a, b) => b.b - a.b).map(r => ({ path: short(r.p), abs: r.p, bytes: r.b, tier: tierGuess(r.p), ageDays: daysAgo(r.p) })) }
}
