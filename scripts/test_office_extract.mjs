// Pre-flight check of lib/office.ts logic using the same installed packages.
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'

const decodeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&')

function slideText(xml) {
  const paras = xml.split(/<a:p[ >]/).slice(1).map((p) => p.split('</a:p>')[0])
  const lines = []
  for (const p of paras) {
    const runs = [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((r) => decodeXml(r[1]))
    const line = runs.join('').replace(/\s+/g, ' ').trim()
    if (line) lines.push(line)
  }
  return lines.join('\n')
}

const docx = readFileSync('testfiles/محاضرة-الجهاز-التنفسي.docx')
const d = await mammoth.extractRawText({ buffer: docx })
console.log('DOCX chars:', d.value.length)
console.log('DOCX head:', JSON.stringify(d.value.slice(0, 160)))

const zip = await JSZip.loadAsync(readFileSync('testfiles/محاضرة-الصدر.pptx'))
const slides = Object.keys(zip.files)
  .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)[1]) - Number(b.match(/slide(\d+)\.xml/)[1]))
console.log('PPTX slides:', slides.length)
const blocks = []
for (let i = 0; i < slides.length; i++) {
  const xml = await zip.files[slides[i]].async('string')
  const txt = slideText(xml)
  if (txt) blocks.push(`— سلايد ${i + 1} —\n${txt}`)
}
const joined = blocks.join('\n\n')
console.log('PPTX chars:', joined.length)
console.log('PPTX head:', JSON.stringify(joined.slice(0, 200)))
