<div align="center">

```
████  █████  ████ █████ ████   ███  █   █ █████ ████
█   █ █     █       █   █   █ █   █  █ █  █     █   █
█   █ ████   ███    █   ████  █   █   █   ████  ████
█   █ █         █   █   █  █  █   █   █   █     █  █
████  █████ ████    █   █   █  ███    █   █████ █   █
```

**ตัวล้างพื้นที่สำหรับ mobile dev — ล็อกเป็น preset เดียว**

เห็นก่อน · ยืนยันก่อน · ลบได้เฉพาะที่ตกลงไว้ในไฟล์เดียว

[เริ่มใช้](#เริ่มใช้-ใน-3-นาที) · [ลบอะไรได้บ้าง](#ลบอะไรได้บ้าง-preset) · [ความปลอดภัย](#ความปลอดภัย) · [คำสั่ง](#คำสั่ง) · [Watch](#watch--เตือนก่อนดิสก์เต็ม) · [FAQ](#faq)

`macOS` · `bun` · ไม่มี dependency · 19 tests · v0.4.0

</div>

---

## ทำไมต้องมี

Mac ของคน Flutter / iOS / Android เต็มเร็วมาก — Gradle, AVD, Simulator, DerivedData, `.dart_tool`, โมเดลที่โหลดค้าง รวมกันได้หลายสิบ GB.
ลบมือก็เสี่ยงลบผิด ส่วนเครื่องมือทั่วไป ([Mole](https://github.com/tw93/Mole), CleanMyMac) ไม่รู้จักของฝั่ง Android/Flutter หรือเลือกข้ามไว้ (เช่น Gradle, AVD).

**destroyer แก้ด้วยการจำกัดขอบเขตให้แคบที่สุด:**

| | |
|---|---|
| 🎯 **แสดงเฉพาะที่จะล้าง** | ไม่มีรายการ "ทั้งหมดในเครื่อง" ให้เลือกพลาด — เห็นแค่สิ่งที่อยู่ใน preset |
| 🔒 **ลบได้แค่นั้นจริง** | ตัวลบปฏิเสธทุกอย่างที่ไม่อยู่ใน `config/preset.toml` ไม่ว่าจะเรียกจากทางไหน (มีเทส) |
| 👀 **ดูก่อนลบเสมอ** | สแกน → แผน → พิมพ์ `DESTROY` ถึงจะลงมือ · `--dry-run` ไม่แตะอะไรเลย |
| 🧯 **ไม่ลบใต้เท้าแอปที่เปิดอยู่** | VS Code / Xcode / Simulator / emulator รันอยู่ = ข้ามเป้านั้น |

> ทำงานคู่กับ Mole ได้: Mole ดูแลของทั่วไป (cache, browser, brew) · destroyer ดูแล preset ของ mobile dev

---

## เริ่มใช้ ใน 3 นาที

**ต้องมี:** macOS + [bun](https://bun.sh) (ทดสอบกับ 1.3.14) · ไม่ต้อง `bun install` · ถ้าจะล้าง Simulator/AVD ต้องมี Xcode command line tools / Android SDK cmdline-tools

```bash
git clone git@github.com:phanuphong100stars/stars-destroyer.git ~/Project/Personal/destroyer
cd ~/Project/Personal/destroyer
bun test                                                          # 19 tests ควรผ่านหมด
chmod +x src/cli.ts && ln -s "$PWD/src/cli.ts" ~/.local/bin/destroyer   # ให้พิมพ์สั้นๆ ว่า destroyer
```

**ครั้งแรกทำตามลำดับนี้:**

| ขั้น | คำสั่ง | ได้อะไร |
|---|---|---|
| 1 | `destroyer apply --dry-run` | ดูแผนทั้งหมด **ไม่ลบอะไร** |
| 2 | `destroyer` | หน้าจอรายการ → เอาตัวที่อยากเก็บออกด้วย `space` → พิมพ์ `DESTROY` |
| 3 | ดูสรุปท้ายจอ | ขนาดที่คืน + คำสั่ง `sudo` (ถ้ามี) ให้คัดลอกไปรันเอง |

<details>
<summary><b>ตัวอย่างผลลัพธ์</b> (ชื่อโปรเจกต์/ตัวเลขเป็นตัวอย่าง)</summary>

```
PRESET "sweep" — ทำได้แค่นี้ (20 รูปแบบใน config/preset.toml) · พบในเครื่อง 20 รายการ

── A ล้างได้เลย · สร้างใหม่เอง ไม่เสียข้อมูล ───────────────────── 30.64 GB · 12 รายการ
[x] gradle:transforms               ██████████████   9.22 GB  Gradle transform cache
[x] dart:analysis-server            ███████▋         5.06 GB  Dart analysis server cache
[x] android:avd-snapshots:Pixel_8   ██████▎          4.06 GB  AVD Pixel_8 · quickboot snapshots
[x] xcode:sim-syscache              ████▉            3.26 GB  CoreSimulator system cache ⚠sudo
[x] projects:my-app:.dart_tool      ██▊              1.85 GB  my-app · .dart_tool
…
╭─ PRESET "sweep" — แผนถ้า apply (ยังไม่ลบอะไร)
│ 20 targets · 51.47 GB · tier C 7 ตัว (อยู่ใน preset)
│ ลบได้จริง 48.21 GB (ขั้นที่ต้อง sudo 3.26 GB จะพิมพ์ให้ ไม่รันเอง)
│ ว่างตอนนี้ 36.97 GB → 85.18 GB
╰─
```
</details>

---

## ทำงานยังไง

```
destroyer ─▶ สแกน ─▶ รายการใน preset ─▶ แผน + gates ─▶ พิมพ์ DESTROY ─▶ ลบ ─▶ สรุป + log
                       (เอาออกได้)       │                │
                                         ├ path ผ่าน checkPath?
                                         ├ แอปเจ้าของกำลังรัน? → ข้าม
                                         └ มี tier C? → ต้องพิมพ์ DESTROY เสมอ
```

หน้าจอเลือก: `↑↓`/`jk` เลื่อน · `space` เลือก/เอาออก · **`i` ดูข้างใน** (path, ลบแล้วเกิดอะไร, สิ่งที่จะทำ, แอปเจ้าของรันอยู่ไหม) · `a` tier A · `n` ไม่เลือก · `s` เลือกทั้งหมดตาม preset · `enter` ไปต่อ · `q` ออก (ออกที่ไหนก็ไม่ลบอะไร)

---

## ลบอะไรได้บ้าง (preset)

ทั้งหมดอยู่ในไฟล์เดียว: [`config/preset.toml`](config/preset.toml) — 20 รูปแบบ. อะไรที่ไม่อยู่ในนี้ **ไม่ถูกแสดง และลบไม่ได้**.

| Tier | รายการ | ลบแล้วเกิดอะไร |
|---|---|---|
| ✅ **A** ล้างได้เลย | `gradle:transforms` `gradle:build-cache` | build ครั้งแรกช้าลง (Gradle สร้างใหม่เอง) |
| | `dart:analysis-server` | IDE index ใหม่ตอนเปิดโปรเจกต์ |
| | `projects:*:.dart_tool` | `flutter pub get` |
| | `projects:*:ios/build` `android/build` `android/app/build` `android/.gradle` | build ใหม่ |
| | `projects:*:*/.next` | `next dev` / `build` |
| | `vscode:cached-vsix` | โหลดใหม่เองตอนอัปเดต extension |
| | `xcode:sim-appcache:*` | cache + tmp ของแอปใน simulator — ไม่แตะ session/ตั้งค่า |
| | `android:avd-snapshots:*` | boot emulator แบบ cold ครั้งแรกช้ากว่า |
| | `xcode:sim-syscache` ⚠ | sim boot ครั้งแรกช้ากว่า · **ต้อง sudo — พิมพ์คำสั่งให้** |
| 🟡 **B** โหลดใหม่ | `android:avd-userdata:*` | เหมือน wipe data — เสียข้อมูลใน emulator |
| 🟠 **C** ตัดสินเอง | `android:avd:*` `android:image:android-34:*` | สร้าง AVD / ติดตั้ง image ใหม่ใน Android Studio |
| | `android:ndk:28.*` | ติดตั้งใหม่ผ่าน SDK Manager |
| | `xcode:sim:iphone-18-pro-max-*` | ลบ simulator เครื่องนั้น (flutter run ลงแอปใหม่ได้) |
| | `ai:hf:*` | โมเดล Hugging Face — โหลดใหม่ (ใช้เน็ต) |
| | `flutter:sdk:flutter-3.35.0` | `git clone` ใหม่ |

แผนที่มีรายการ tier C **ต้องพิมพ์ `DESTROY` เสมอ** (`--yes` ข้ามไม่ได้).
ดูว่าเครื่องคุณเจออะไรบ้าง: `destroyer preset`

**จะเพิ่ม/ตัดรายการ?** แก้ `config/preset.toml` แล้ว commit ที่ repo — ไม่มี config ผู้ใช้ทับ. รูปแบบกว้างอย่าง `*` หรือ `projects:*` โหลดไม่ผ่าน (บังคับให้เจาะจง).

---

## ความปลอดภัย

destroyer **จะไม่**:

| ไม่ทำ | กันด้วย |
|---|---|
| ลบของนอก preset | `scan` ตัดทิ้งตั้งแต่ต้น + `applyTarget` ปฏิเสธ id นอก preset แม้ path/action ถูกต้อง |
| ลบ `~` · `~/Library` ทั้งโฟลเดอร์ · `~/.ssh` · `~/.claude` · `~/Documents` · Desktop · Downloads · path นอก home | `checkPath` ตรวจก่อนลบทุกครั้ง |
| ตาม symlink ออกไปลบที่อื่น | ปฏิเสธเป้าที่เป็น symlink · symlink ข้างในถูกลบแค่ตัวลิงก์ · ตรวจ `realpath` ซ้ำ |
| รันคำสั่งผ่าน shell | ใช้ argv ตรงๆ · คำสั่งภายนอกมี allowlist 4 รูป: `xcrun simctl delete`, `xcrun simctl runtime delete`, `avdmanager delete avd`, `sdkmanager --uninstall` |
| รันเป็น root | ขั้นที่ต้อง `sudo` ถูก **พิมพ์ให้** คัดลอกไปรันเอง |
| ลบใต้เท้าแอปที่เปิดอยู่ | เช็ก process เจ้าของ → ข้ามเป้านั้น (Gradle daemon / Dart analysis server ถามให้หยุดได้ `y/N`) |
| ลบโดยไม่ถาม | dry-run ก่อน · ต้องพิมพ์ `DESTROY` · ไม่มี TTY ต้อง `--yes` และแผนห้ามมี tier C |
| ลบจาก `watch` | `watch` แค่วัดพื้นที่ว่างแล้วเตือน |

ทุกการลบเขียน log: `~/Library/Logs/destroyer/YYYY-MM-DD.jsonl`

---

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `destroyer` | สแกน → รายการ preset (ติ๊กไว้ทั้งหมด) → แผน + gates → `DESTROY` → ลบ → สรุป *(ต้องรันใน terminal)* |
| `destroyer scan [--json]` | ดูอย่างเดียว ไม่ลบ |
| `destroyer apply [--dry-run] [--yes] [--skip id,…] [--stop-daemons]` | ลบตาม preset แบบไม่ติ๊ก · `--dry-run` ดูแผนเฉยๆ · `--yes` ข้าม `DESTROY` (**เฉพาะแผนไม่มี tier C**) · `--skip` เอาออกอย่างเดียว เพิ่มไม่ได้ · `--stop-daemons` หยุด Gradle daemon / Dart analysis server ให้เอง |
| `destroyer show <id>` | รายละเอียดของรายการใน preset |
| `destroyer preset` | preset อนุญาตอะไรบ้าง และเจอในเครื่องกี่รายการ |
| `destroyer watch status \| check \| install \| uninstall` | เตือนก่อนดิสก์เต็ม |

เพิ่ม `--fresh` วัดขนาดใหม่ทั้งหมด · `--plain` ปิดสี/แอนิเมชัน (pipe หรือ `NO_COLOR` ก็ปิดเอง)

---

## Watch — เตือนก่อนดิสก์เต็ม

```bash
destroyer watch install            # ตรวจทุก 60 นาที เตือนเมื่อว่าง < 20 GB (ถามยืนยันก่อน)
destroyer watch install --print    # ดู plist ที่จะเขียน โดยไม่ติดตั้งอะไร
destroyer watch status             # ติดตั้งอยู่ไหม / ว่างเท่าไร / เตือนล่าสุด
destroyer watch uninstall
```

ปรับได้: `--threshold 25` · `--every 30` (นาที) · `--cooldown 6` (ชม. ระหว่างการเตือน).
เมื่อต่ำกว่าเกณฑ์ → สแกน → แจ้งเตือน macOS "ล้างตาม preset ได้ราว X GB" → **จบ ไม่ลบอะไร**.
ติดตั้ง = เขียน `~/Library/LaunchAgents/com.stars.destroyer.watch.plist` + `launchctl bootstrap` · log ที่ `~/Library/Logs/destroyer/watch.log`

---

## FAQ

<details>
<summary><b>ทำไมบางรายการถูกข้าม ("‖ … กำลังรัน")?</b></summary>

เจ้าของของนั้นยังเปิดอยู่ — เช่น VS Code เปิดอยู่เลยข้าม `vscode:*` (ลบ cache ใต้เท้าแอปที่ใช้อยู่ไม่ปลอดภัย). ปิดแอปแล้วรันใหม่. Gradle daemon กับ Dart analysis server ถามให้หยุดให้ได้ (`y/N`) หรือใส่ `--stop-daemons`.
</details>

<details>
<summary><b>ทำไมชื่อ "Jarred Sumner" โผล่ใน System Settings → Login Items?</b></summary>

งาน `watch` รัน `bun` และ macOS แสดงชื่อ **ผู้เซ็นโปรแกรมที่ถูกรัน** — `bun` เซ็นด้วย `Developer ID Application: Jarred Sumner` (ผู้สร้าง Bun) ไม่ใช่ชื่อโปรเจกต์นี้. ปิดได้ที่ toggle นั้น หรือ `destroyer watch uninstall`.
</details>

<details>
<summary><b>สแกนครั้งแรกทำไมช้า (~15 วินาที)?</b></summary>

บางโฟลเดอร์มีไฟล์เป็นแสน (`~/.dartServer` ~315,000 ไฟล์ → `du` ~11 วิ). ขนาดถูกจำไว้ 10 นาทีที่ `~/.cache/destroyer/du.json` → รอบถัดไป ~0.5 วินาที · ล้างอัตโนมัติหลัง apply · `--fresh` วัดใหม่.
</details>

<details>
<summary><b>ต้องใช้ sudo ไหม?</b></summary>

มีรายการเดียวที่ต้องใช้: `xcode:sim-syscache` (CoreSimulator system cache, `/Library/Developer/CoreSimulator/Caches`). destroyer ไม่รันเป็น root — จะ **พิมพ์คำสั่ง** ให้คัดลอกไปรันเองท้ายสรุป. ที่เหลือไม่ต้อง sudo.
</details>

<details>
<summary><b>ต่างจาก Mole ยังไง?</b></summary>

Mole เป็นเครื่องมือล้างเครื่องทั่วไป (กว้าง) · destroyer เป็น preset แคบเฉพาะ mobile dev และ **ล็อกขอบเขต** ที่ตัวลบ ใช้คู่กันได้ — ให้ Mole ดูแล cache/browser/brew ส่วน destroyer ดูแล Gradle/AVD/Simulator/Flutter.
</details>

<details>
<summary><b>อยากเพิ่ม/ตัดรายการล้าง?</b></summary>

แก้ `config/preset.toml` แล้ว commit. ถ้าเป็นของชนิดใหม่ที่ยังไม่มีตัวสแกน ต้องเพิ่ม module ใน `src/modules/` (ส่ง **ข้อมูล** กลับ ไม่ลบเอง) แล้วใส่ id ใน preset. ไม่มีทางเพิ่มผ่าน config ผู้ใช้โดยตั้งใจ.
</details>

---

## สำหรับคนแก้โค้ด

```
config/preset.toml   ← ขอบเขตที่ลบได้ (บังคับ — แก้ที่ repo เท่านั้น)
src/
  cli.ts             ← คำสั่ง
  core.ts            ← preset, scan, checkPath, ขนาด + cache
  exec.ts            ← ที่เดียวที่ลบ (allowlist, ตรวจ owner, log)
  apply.ts           ← plan → gates → DESTROY → run → สรุป
  tui.ts · view.ts · ui.ts   ← หน้าจอเลือก/รัน และการแสดงผล
  watch.ts           ← เตือนก่อนดิสก์เต็ม (launchd)
  modules/           ← ตัวสแกน: xcode android gradle dart projects ai vscode stale-projects
test/                ← bun test (19 tests)
```

- module ส่ง **ข้อมูล** กลับ (path, ขนาด, tier, action) — ไม่ลบเอง; มีแต่ `exec.ts` ที่ลบ
- ก่อนแก้ preset/`exec.ts` รัน `bun test` — มีเทสสำหรับกฎ path, การล็อก preset, การลบบนโฟลเดอร์ชั่วคราว, allowlist คำสั่ง, `watch`
- ทดสอบอะไรที่ลบจริงให้ใช้ `HOME=$(mktemp -d)` (บ้านปลอม) ไม่ใช่เครื่องจริง

---

## สถานะและข้อจำกัด

<details>
<summary><b>สิ่งที่ตรวจแล้ว / ยังไม่ได้ตรวจ</b> (เปิดอ่านก่อนใช้ครั้งแรก)</summary>

**ตรวจแล้ว**
- เทส 19 ข้อ: กฎ path · preset (รูปแบบ/การล็อก/ปฏิเสธ id นอก preset แม้ path ถูก) · การลบจริงบนโฟลเดอร์ชั่วคราว (ลบ/เก็บโฟลเดอร์/symlink/ปฏิเสธ/dry-run) · allowlist คำสั่ง · ตรวจแอปที่รัน · `watch`
- ทดสอบครบวงจรบน **HOME ปลอม**: scan โชว์เฉพาะ preset · ยัด module/`targets.toml` เอง, `--only`, `--set`, คำสั่งที่ถูกถอด → ลบของนอก preset ไม่ได้ · หน้าจอเลือก/รันผ่านเทอร์มินัลเสมือน

**ยังไม่ได้ตรวจ**
- ❗ **ยังไม่เคยรันลบบนข้อมูลจริง** — ครั้งแรกให้เริ่มจาก `destroyer apply --dry-run`
- ❗ คำสั่งภายนอก (`simctl delete`, `simctl runtime delete`, `avdmanager`, `sdkmanager`) ผ่านเทสแค่ฝั่ง allowlist ไม่เคยถูกรันจริง เพราะจะแก้ระบบจริง
- แท่งในหน้ารันเป็นแอนิเมชันตามเวลา ไม่ใช่ความคืบหน้าจริงของ `rm` (เป้าใหญ่ช้าจะค้างราว 92% จนเสร็จ)
- `watch` ผ่านเทสบน HOME ปลอมและ `plutil -lint`; การเด้งแจ้งเตือนจริงไม่ได้ถูกยิงในเทส
</details>

---

<div align="center">

ขอบคุณ [Mole](https://github.com/tw93/Mole) สำหรับแนวคิดและตัวอย่างที่ดี · ทำด้วย [bun](https://bun.sh)

</div>
