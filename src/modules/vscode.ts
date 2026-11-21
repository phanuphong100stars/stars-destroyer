import type { Mod, Target } from '../core'
// ของที่ VS Code โหลดมาเก็บไว้เอง — Mole ล้างแค่ cache/log เล็กๆ ไม่แตะพวกนี้
export default {
  id: 'vscode',
  detect: ({ exists, home, join }) => exists(join(home, 'Library/Application Support/Code')),
  async scan({ home, join, exists, du }) {
    const base = join(home, 'Library/Application Support/Code'), out: Target[] = []
    const items: [string, string, string, 'A' | 'B', string][] = [
      ['vscode:cached-vsix', 'CachedExtensionVSIXs', 'VS Code · ไฟล์ติดตั้ง extension ที่เก็บไว้', 'A', 'โหลดใหม่เองตอนอัปเดต/ติดตั้ง extension'],
      ['vscode:dictation-models', 'chatDictationModels', 'VS Code · โมเดลพิมพ์ด้วยเสียง (Chat)', 'B', 'โหลดใหม่ตอนใช้พิมพ์ด้วยเสียงครั้งหน้า (ใช้เน็ต)'],
      ['vscode:dictation-runtime', 'chatDictationRuntime', 'VS Code · runtime พิมพ์ด้วยเสียง', 'B', 'โหลดใหม่ตอนใช้ครั้งหน้า (ใช้เน็ต)'],
    ]
    for (const [id, dir, label, tier, regen] of items) {
      const p = join(base, dir); if (!exists(p)) continue
      const bytes = await du(p); if (bytes < 20e6) continue
      out.push({ id, label, bytes, tier, regen, paths: [p], action: { kind: 'rm', paths: [p] }, owners: ['Visual Studio Code'] })
    }
    return out
  },
} satisfies Mod
