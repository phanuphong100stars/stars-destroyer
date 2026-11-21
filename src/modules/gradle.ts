import type { Mod, Target } from '../core'
export default {
  id: 'gradle',
  detect: ({ exists, home, join }) => exists(join(home, '.gradle/caches')),
  async scan({ home, join, dirs, du }) {
    const kids = dirs(join(home, '.gradle/caches')), out: Target[] = [], owners = ['Gradle daemon']
    const groups: [string, string, 'A' | 'B', string[], string][] = [
      ['gradle:transforms', 'Gradle transform cache', 'A', kids.filter(d => /\/\d+\.\d+(\.\d+)?$/.test(d)), 'build ครั้งแรกช้าลง (Gradle สร้างใหม่เอง)'],
      ['gradle:build-cache', 'Gradle build cache', 'A', kids.filter(d => /\/build-cache-\d+$/.test(d)), 'build ครั้งแรกช้าลง'],
      ['gradle:modules', 'Gradle dependency ที่โหลดไว้ (modules-2)', 'B', kids.filter(d => d.endsWith('/modules-2')), 'build ครั้งหน้าโหลด dependency ใหม่ทั้งหมด (ใช้เน็ต)'],
    ]
    for (const [id, label, tier, paths, regen] of groups) {
      if (!paths.length) continue
      const bytes = await du(paths); if (bytes < 20e6) continue
      out.push({ id, label: id === 'gradle:transforms' ? `${label} (${paths.map(p => p.split('/').pop()).join(', ')})` : label, bytes, tier, regen, paths, action: { kind: 'rm', paths }, owners })
    }
    return out
  },
} satisfies Mod
