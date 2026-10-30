// Test harness: MP3 frame split (lossless) + split-part group matching.
// Run from the repo root:  node scripts/test_split_merge.ts
import { splitMp3InJs } from '../lib/compress.ts'
import { matchPartGroup, parsePartName } from '../lib/parts.ts'

let failures = 0
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !extra ? '' : ` — ${extra}`}`)
  if (!cond) failures++
}

// ---------------------------------------------------------------------------
// Synthetic MP3: ID3v2 tag + a chain of valid MPEG1 Layer III 128kbps 44.1kHz
// frames (417 bytes each), payload filled with a non-sync byte.
function buildMp3(frames: number, tagSize = 200): Buffer {
  const tag = Buffer.alloc(10 + tagSize, 0)
  tag.write('ID3', 0, 'ascii')
  tag[5] = 0x03 // version 2.3
  // syncsafe size of the body (tagSize bytes)
  tag[6] = (tagSize >> 21) & 0x7f
  tag[7] = (tagSize >> 14) & 0x7f
  tag[8] = (tagSize >> 7) & 0x7f
  tag[9] = tagSize & 0x7f

  const head = Buffer.from([0xff, 0xfb, 0x90, 0x00])
  const frameLen = 417 // floor(144 * 128000 / 44100)
  const one = Buffer.concat([head, Buffer.alloc(frameLen - 4, 0x5a)])
  const big = Buffer.allocUnsafe(frames * frameLen)
  for (let i = 0; i < frames; i++) one.copy(big, i * frameLen)
  return Buffer.concat([tag, big])
}

const bufToU8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
const toFile = (b: Buffer, name: string) => new File([bufToU8(b)], name, { type: 'audio/mpeg' })

async function testMp3Split() {
  const frames = 195_000 // ≈ 81MB → must become 3 parts under COPY_TARGET (38MB)
  const src = buildMp3(frames)
  const size = src.byteLength
  const file = toFile(src, 'Urology round instruments.mp3')
  const t0 = Date.now()
  const parts = await splitMp3InJs(file)
  const ms = Date.now() - t0

  check('split produced ≥2 parts', parts.length >= 2, `got ${parts.length}`)
  check('split is fast (<5s)', ms < 5000, `${ms}ms`)

  const total = parts.reduce((a, p) => a + p.size, 0)
  check('total size preserved', total === size, `${total} vs ${size}`)

  const names = parts.map((p) => p.name)
  const want = parts.length
  const namesOk = names.every((n, i) => n === `Urology round instruments (${i + 1}-${want}).mp3`)
  check('part names are (k-N).mp3', namesOk, names.join(' | '))

  // every part under the storage-safe target (38MB) + one frame of slack
  const slack = 417
  check('parts fit the storage plan', parts.every((p) => p.size <= 38 * 1024 * 1024 + slack),
    parts.map((p) => `${(p.size / 1048576).toFixed(1)}MB`).join(', '))

  // byte-for-byte lossless: concatenating the parts restores the input
  const chunks: Buffer[] = []
  for (const p of parts) chunks.push(Buffer.from(await p.arrayBuffer()))
  const rebuilt = Buffer.concat(chunks)
  check('content is byte-for-byte identical', rebuilt.equals(src))

  // part boundaries are frame-aligned: each part after the first starts with a sync word
  const aligned = chunks.slice(1).every((c) => c[0] === 0xff && (c[1] & 0xe0) === 0xe0)
  check('cuts land on frame boundaries', aligned)

  // the ID3 tag survives in the first part and only there
  check('ID3 tag kept in part 1', chunks[0].subarray(0, 3).toString('ascii') === 'ID3')
}

function testPartGroup() {
  check('parsePartName basic', JSON.stringify(parsePartName('Lecture (2-3).mp3')) ===
    JSON.stringify({ base: 'Lecture', idx: 2, total: 3 }))
  check('parsePartName rejects plain names', parsePartName('Lecture.mp3') === null)
  check('parsePartName rejects zero index', parsePartName('L (0-3).mp3') === null)

  const g = matchPartGroup(['Lecture (2-3).mp3', 'Lecture (1-3).mp3', 'Lecture (3-3).mp3'])
  check('group matches out of order', !!g && g.base === 'Lecture' && g.total === 3 &&
    g.ordered.join('|') === 'Lecture (1-3).mp3|Lecture (2-3).mp3|Lecture (3-3).mp3')

  check('group rejects missing part', matchPartGroup(['Lecture (1-3).mp3', 'Lecture (2-3).mp3']) === null)
  check('group rejects mixed bases', matchPartGroup(['A (1-2).mp3', 'B (2-2).mp3']) === null)
  check('group rejects mixed totals', matchPartGroup(['A (1-2).mp3', 'A (2-3).mp3']) === null)
  check('group rejects duplicate index', matchPartGroup(['A (1-2).mp3', 'A (1-2).mp3']) === null)
  check('group rejects a single file', matchPartGroup(['A (1-2).pdf']) === null)
  check('group rejects plain files', matchPartGroup(['A.mp3', 'B.mp3']) === null)
  check('group accepts pdf parts', matchPartGroup(['Scan (1-2).pdf', 'Scan (2-2).pdf'])?.total === 2)
}

await testMp3Split()
testPartGroup()
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
