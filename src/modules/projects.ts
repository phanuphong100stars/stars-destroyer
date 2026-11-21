import type { Mod, Target } from '../core'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
// build outputs per repo. ponytail: fixed list + apps/* monorepo folders; add more kinds here or via targets.toml
const KINDS: [string, 'A' | 'B', string][] = [
  ['node_modules', 'B', 'bun install / npm ci (ใช้เน็ต)'], ['.dart_tool', 'A', 'flutter pub get'], ['ios/Pods', 'B', 'pod install'],
  ['ios/build', 'A', 'flutter build ios'], ['android/.gradle', 'A', 'gradle build'], ['android/build', 'A', 'flutter build apk'], ['android/app/build', 'A', 'flutter build apk'],
]
export default {
  id: 'projects',
  async scan({ repos, du, dirs }) {
    const out: Target[] = []
    for (const r of repos()) {
      const name = r.split('/').pop()!
      const rels = [...KINDS.map(k => k[0]), ...dirs(join(r, 'apps')).flatMap(a => ['.next', 'node_modules'].map(x => `apps/${a.split('/').pop()}/${x}`))]
      const found = rels.map(rel => ({ rel, p: join(r, rel) })).filter(x => existsSync(x.p))
      const sizes = await Promise.all(found.map(x => du(x.p))) // du is the slow part — run together
      found.forEach(({ rel, p }, i) => {
        const bytes = sizes[i]; if (bytes < 20e6) return
        const k = KINDS.find(k => k[0] === rel), tier = k?.[1] ?? (rel.endsWith('node_modules') ? 'B' : 'A'), regen = k?.[2] ?? (rel.endsWith('.next') ? 'next dev / build' : 'bun install')
        out.push({ id: `projects:${name}:${rel.replace(/^apps\//, '')}`, label: `${name} · ${rel}`, bytes, tier, regen, paths: [p], action: { kind: 'rm', paths: [p] } })
      })
    }
    return out
  },
} satisfies Mod
