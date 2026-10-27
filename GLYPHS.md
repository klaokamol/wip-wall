# Glyph widths and alignment

Checked 2026-10-23 in Ghostty 1.3.1 on macOS (default font family, no `font-family` set). It records what was measured and what is left to decide. Fixed so far: zero-width characters (commit 2b530b4) and the card marker set (see Adopted marker set). The rest below is still open.

Two separate questions:

1. **Width**: does `widthOf` (`hooks/board.ts`) count the same cells the terminal draws? Measured with the cursor position report, so it is exact.
2. **Look**: do glyphs that stack in one column have the same size and baseline? Judged by eye from screenshots, so it is not exact.

## Result summary

- 199 sample strings measured, 187 matched `widthOf` and 12 did not (see Width mismatches); the 4 zero-width ones are fixed since, so 8 remain.
- All 26 non-ASCII glyphs the pane draws are 1 cell wide in both `widthOf` and Ghostty.
- Several glyphs that stack in one column look uneven (see Look mismatches).

## Glyphs the pane draws

Enumerated from `hooks/*.ts(x)` (tests excluded). Re-enumerate with the command under Re-check.

| Glyph | Code point | Where | Role |
| --- | --- | --- | --- |
| `●` | U+25CF | view.tsx, register.tsx, pulse.tsx | card marker: here (pulse frame 1) |
| `◉` | U+25C9 | view.tsx, register.tsx, pulse.tsx | card marker: open; pulse frame 2; setup root selected |
| `◎` | U+25CE | view.tsx, register.tsx | card marker: resumable |
| `○` | U+25CB | view.tsx, register.tsx | card marker: none; setup root unselected |
| `◌` | U+25CC | register.tsx | spinner fallback |
| `✕` | U+2715 | view.tsx, register.tsx | hide, right edge |
| `↩` | U+21A9 | view.tsx | restore (Dismissed), right edge |
| `×` | U+00D7 | view.tsx:156 | chooser close `[×]` |
| `✓` `✗` | U+2713 U+2717 | view.tsx | setup checks |
| `↓` | U+2193 | view.tsx, register.tsx | branch mark |
| `←` `→` | U+2190 U+2192 | board.ts | due date (late, ahead) |
| `─` | U+2500 | view.tsx, register.tsx | section rules |
| `·` `…` | U+00B7 U+2026 | board.ts, view.tsx, register.tsx | separators, clip |
| braille `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | U+2800 block | spinner.tsx | spinner frames |

`↻` and `★` appear in `board.test.ts` fixtures only, not in the pane.

## Width mismatches (`widthOf` vs Ghostty)

| Input | Ghostty | `widthOf` | Note |
| --- | --- | --- | --- |
| ZWJ emoji (`👩‍💻`, `👨‍👩‍👧`, `🏳️‍🌈`, `❤️‍🔥`, `🧑‍🚀`) | 2 | 4 to 6 | known ceiling, `ponytail:` line in `board.ts` |
| U+200B ZWSP, U+200E LRM, U+FEFF BOM, U+2060 WJ | 0 | 1 | **Fixed in 2b530b4**: `CONTROL` in `board.ts` now also holds U+200B, U+200E, U+200F, U+2060-2064 and U+FEFF, so `clean` turns them into a space (1 cell, same as `widthOf`). U+200C ZWNJ was not measured and U+200D ZWJ must stay (it joins emoji), so both are left out. Side effect: `isWebUrl` now refuses a url holding one of them. Not yet looked at in the real pane |
| Devanagari, Tamil with combining vowel signs or virama | 4 | 6 | Indic marks are not in `MARKS`; irrelevant for Thai |
| lone Regional Indicator (`🇹`) | 2 | 1 | rare |

Everything else matched: Thai (tone marks, upper and lower vowels, `ำ`, `ฤๅ`), emoji presentation, VS16, VS15, skin tone, flag pairs, keycaps, CJK, Hangul, kana, halfwidth, fullwidth, Latin with combining accents, Cyrillic, Greek, Arabic, Hebrew, box and block, math and arrows, ambiguous-width symbols (`° × ① № ★ ○ ● ♥`), enclosed, private use (powerline), soft hyphen.

## Look mismatches (same width, uneven when stacked)

The card marker items below describe the old set (`✦ ✧ ● ⊙ ○`), replaced by the Adopted marker set; the other items are still open except the setup root list, which now uses `◉`/`○`.

Cell width is equal, but the drawn size or baseline differs. Likely cause: glyphs from different Unicode blocks come from different fonts.

- Card marker column: `✦` (big 4-point star, Dingbats) vs `●` (fills the cell) vs `⊙` (small, inner dot reads as a different family) vs `○` (slightly smaller than `●`).
- `pulse.tsx` alternates `✦` and `✧`; `✧` is a thin outline and much smaller, so the marker changes size while pulsing.
- Setup root list: `●` is clearly larger than `○`.
- Dismissed right edge: `↩` is taller and sits lower than `✕`, so mixed rows look staggered.
- `[×]` (U+00D7, sits at x-height) vs `✕` (U+2715, taller): two close buttons with different looks.
- Minor: `✓` is shorter and lower than `✗`; `✗` is nearly identical to `✕`; `←` `→` are shorter than `↓`.

Fine: braille spinner frames, `·` `…` `@` baselines, `─` joins into a continuous rule.

### Candidate marker sets tried (all 1 cell)

- `◆ ● ◉ ○` (here, open, resumable, none): best match. `●` `◉` `○` share size and position; `◆` is slightly smaller but centred. `pulse.tsx` could use `◆` and `◇`.
- Rejected: `⬤` U+2B24 and `⚫` U+26AB (2 cells, overflow), `◐` U+25D0 (too small), `◈`, `★` `☆` (too large, star shape).
- Not tried yet: a replacement for `↩` close to `✕` in size (for example `↺`); `●` with `◯` (U+25EF) as the pair for setup roots.

## Adopted marker set

Chosen after measuring ink weight (see the last section): `○` none, `◎` resumable, `◉` open, `●` here. The four share one Unicode block and one cell box, and their weights step evenly (16, 27, 39, 53), so a column of mixed states reads as one ramp: the more filled, the more alive.

- here pulses `●` and `◉` (`pulse.tsx`) in the box view and in `[c]`. `cardRow` had no pulse before, so the here card never blinked in `[c]`; `pane.test.tsx` now asserts it.
- The legend reads `● here  ◉ open  ◎ resumable  ○ none`.
- Setup root list: `◉` selected, `○` other. Spinner fallback: `◌`.
- Weak spot: the `◉` frame of the pulse looks like an open card, so only the blinking tells here from open (here also sits in Working).
- Fallbacks if the blink is too faint: `●`/`○` (53 against 16, big swing, but the off frame looks like none) or `●`/`◎` (53 against 27).
- Left as they were: `[×]` (kept on purpose), `↩` against `✕` in Dismissed, `✓`/`✗` and `←`/`→` heights.

## Untested

- Only the compact view's right edge was checked in the real pane; box view and Dismissed were not.
- Text samples were measured as bare strings, not inside a card box.
- One terminal and one font. Another terminal, font or `font-family` can differ, especially for ambiguous-width symbols.
- The look judgements are by eye, not measured in pixels.

## Re-check

### 1. Enumerate glyphs in source

```sh
node -e '
const fs=require("fs");const m=new Map();
for(const f of fs.readdirSync("hooks").filter(f=>/\.tsx?$/.test(f)&&!/test/.test(f))){
 for(const ch of fs.readFileSync("hooks/"+f,"utf8")){if(ch.codePointAt(0)>127){const e=m.get(ch)||new Set();e.add(f);m.set(ch,e)}}}
for(const [k,e] of [...m].sort((a,b)=>a[0].codePointAt(0)-b[0].codePointAt(0)))console.log(k,"U+"+k.codePointAt(0).toString(16).toUpperCase().padStart(4,"0"),[...e].join(","))'
```

### 2. Measure width in the terminal

Must run in a real Ghostty tab (needs a tty). `samples.txt` holds one string per line. The script prints each string and asks the terminal for the cursor column.

```zsh
: > out.tsv
while IFS= read -r s; do
  printf '\r\e[K%s\e[6n' "$s"; IFS=';' read -rs -d R _ col </dev/tty
  printf '%s\t%d\n' "$s" $((col-1)) >> out.tsv
done < samples.txt
```

From a Claude Code session, open a tab with `osascript` instead of asking the user to paste:

```applescript
tell application "Ghostty"
  set cfg to new surface configuration from {initial working directory:"<dir>", initial input:"zsh measure.zsh\n"}
  set t to new tab in front window with configuration cfg
end tell
```

### 3. Compare with `widthOf`

```js
// node --experimental-strip-types --no-warnings cmp.mjs
import { readFileSync } from 'node:fs'
import { widthOf } from './hooks/board.ts'
const lines = readFileSync('out.tsv', 'utf8').split('\n').filter(Boolean)
for (const l of lines) { const [s, n] = l.split('\t'); if (String(widthOf(s)) !== n) console.log(JSON.stringify(s), 'ghostty', n, 'widthOf', widthOf(s)) }
```

### 4. Look at stacking

Print the glyphs one per row in the column the pane uses, then capture only the Ghostty window (the window id comes from `CGWindowListCopyWindowInfo`, match the tab title set with `printf '\e]2;<title>\a'`):

```sh
screencapture -x -o -l <windowid> shot.png
sips -c <h> <w> --cropOffset <y> <x> shot.png --out crop.png
sips -z <2h> <2w> crop.png --out zoom.png
```

Alignment check for widths: pad each sample with `widthOf` to a fixed column and print `|` after it. A straight `|` column means `widthOf` is right; a shifted row names the mismatch.

### Sample set used (199 strings)

ascii; thai (`ก็ ก้ ก์ กำ ที่ นี้ ปู ผู้ ไทย สวัสดี เรื่อง ไอคอน ตรงกัน ฤๅ`); emoji presentation (`😀 ✅ ❌ ⭐ 🔥 🚀 🐛 🎉 ⚡ 🔴 🟢 🟡 ✨ ❓ ➕ ⛔ ☕ ⌚ ⏩ ♈`); emoji needing VS16 (`❤️ ✔️ ☑️ ⚠️ ✂️ ⚙️ ℹ️ ▶️ ✈️ ☀️ ✖️ ↔️ ©️ ™️ ❗ ↩️ ➡️ ⬅️ ⬆️ ⬇️`); the same symbols without VS16; VS15 (`☺︎`); skin tone; ZWJ; flags (including a lone `🇹`); keycaps; CJK, Hangul, kana, halfwidth kana; fullwidth; Latin accents and combining; Cyrillic, Greek; Devanagari, Tamil; Arabic, Hebrew; math and arrows; box and block; typographic punctuation; ambiguous-width symbols; zero-width (`U+200B 200D 00AD 200E FEFF 2060` between `a` and `b`); private use (`U+E0A0 F015 F0001`); enclosed (`㊗ ㊙ 🈶 🅰 🅱 Ⓐ ⒈`); misc symbols (`☃ ☂ ✿ ❀ ♻ ☎ ✆ ☠ ☮ ✌ ☝ ⏰ ⏳`).

## Ink weight of marker candidates (measured in Ghostty 1.3.1, 2026-10-23)

Probe: one glyph per line followed by `|`, screenshot of the Ghostty window (`screencapture -l <window id>`), converted with `sips -s format bmp`, then per row: bounding box and the sum of anti-aliased brightness (`ink`) of the glyph left of the `|`. Resolution is 1x (an `M` is 6x10 px), so boxes are +-1 px and `ink` is a relative weight only. All glyphs are centred on the same cell column (`cx` 5.5 for every row).

| Glyph | Box (px) | Ink |
| --- | --- | --- |
| `●` U+25CF | 8x9 | 52.6 |
| `◉` U+25C9 | 8x9 | 39.2 |
| `◎` U+25CE | 8x9 | 27.2 |
| `◈` U+25C8 | 8x8 | 23.5 |
| `✦` U+2726 | 8x8 | 22.8 |
| `✴` U+2734 | 8x8 | 19.2 |
| `❖` U+2756 | 8x8 | 18.9 |
| `✷` U+2737 | 8x7 | 18.8 |
| `○` U+25CB | 8x9 | 16.4 |
| `✶` U+2736 | 6x8 | 15.7 |
| `✳` U+2733 | 8x7 | 13.2 |

`⬥` U+2B25 drew nothing in the measured region (not checked further).

What this says:

- Boxes and centres match, so the uneven look in a stacked column is ink weight: `●` is about 3x `○`, and `✦` (22.8) sits between `○` and `◎`, lighter than the `●` it was meant to outrank.
- `○ ◎ ◉ ●` is an even ramp (16, 27, 39, 53; steps of 11 to 14): none, resumable, open, here.
- No star glyph reaches `◉` or `●` weight (the heaviest is `✦` at 22.8), so a star cannot stand in for `●`. `✴` (19.2) matches `○` (16.4) and `✦` in weight, not `●`.
- A measurement through CoreText directly (`CTFontCreateForString`) is not usable: it picked a different fallback font per glyph (Helvetica, Lucida Grande, Hiragino, Zapf Dingbats) and sized `◉` twice as large as `●`, which Ghostty does not do.
