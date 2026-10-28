import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ReactNode } from 'react'

export function textOf(n: ReactNode): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (n && typeof n === 'object' && 'props' in n) {
    return textOf((n as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

export const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[\s/\\#?%&=+.,;:!"'()[\]{}<>|*_`~^$@\u2066\u2069]+/g, '-').replace(/^-+|-+$/g, '')

export function tocOf(md: string) {
  return [...md.matchAll(/^(#{2,3})\s+(.+)$/gm)].map((m) => {
    const text = m[2].replace(/[*_`]/g, '').trim()
    return { level: m[1].length, text, id: slug(text) }
  })
}

// Wraps English words inside Arabic text so brackets and punctuation stay on the correct side.
type HNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HNode[] }
const AR = /[\u0600-\u06FF]/
const LATIN = /\(?[A-Za-z0-9][A-Za-z0-9'’\-–/&%+°µ×.]*(?: [A-Za-z0-9(][A-Za-z0-9'’\-–/&%+°µ×.)]*)*\)?/g

function bidiWalk(node: HNode) {
  if (!node.children) return
  if (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')) return
  const next: HNode[] = []
  for (const c of node.children) {
    if (c.type === 'text' && c.value && AR.test(c.value)) {
      const v = c.value
      let last = 0
      for (const m of v.matchAll(LATIN)) {
        const s = m.index ?? 0
        if (s > last) next.push({ type: 'text', value: v.slice(last, s) })
        next.push({ type: 'element', tagName: 'bdi', properties: { dir: 'ltr' }, children: [{ type: 'text', value: m[0] }] })
        last = s + m[0].length
      }
      if (last < v.length) next.push({ type: 'text', value: v.slice(last) })
    } else {
      bidiWalk(c)
      next.push(c)
    }
  }
  node.children = next
}
const rehypeBidi = () => (tree: HNode) => bidiWalk(tree)

export function BidiText({ text }: { text: string }) {
  if (!AR.test(text)) return <>{text}</>
  const parts: ReactNode[] = []
  let last = 0
  let k = 0
  for (const x of text.matchAll(LATIN)) {
    const s = x.index ?? 0
    if (s > last) parts.push(text.slice(last, s))
    parts.push(<bdi key={k++} dir="ltr">{x[0]}</bdi>)
    last = s + x[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

export default function Markdown({ children, dir }: { children: string; dir?: 'rtl' | 'ltr' }) {
  return (
    <div className="md" dir={dir}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeBidi]}
        components={{
          h2: ({ children }) => <h2 id={slug(textOf(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={slug(textOf(children))}>{children}</h3>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
