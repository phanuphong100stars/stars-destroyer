import type { Mod, Target } from '../core'
import { statSync } from 'node:fs'
export default {
  id: 'ai',
  detect: ({ exists, home, join }) => exists(join(home, '.cache/huggingface/hub')),
  async scan({ home, join, dirs, du }) {
    const out: Target[] = []
    for (const p of dirs(join(home, '.cache/huggingface/hub')).filter(d => /\/models--/.test(d))) {
      const bytes = await du(p); if (bytes < 20e6) continue
      const name = p.split('/').pop()!.replace(/^models--/, '').replace(/--/g, '/')
      const days = Math.floor((Date.now() - statSync(p).mtimeMs) / 864e5)
      out.push({ id: `ai:hf:${name.replace(/[^\w.-]+/g, '-')}`, label: `Hugging Face · ${name}`, bytes, tier: 'C', regen: 'โหลดใหม่ (ใช้เน็ต)', paths: [p], action: { kind: 'rm', paths: [p] }, note: `แก้ล่าสุด ${days} วันก่อน` })
    }
    return out
  },
} satisfies Mod
