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
  s.trim().toLowerCase().replace(/[\s/\\#?%&=+.,;:!"'()[\]{}<>|*_`~^$@]+/g, '-').replace(/^-+|-+$/g, '')

export function tocOf(md: string) {
  return [...md.matchAll(/^(#{2,3})\s+(.+)$/gm)].map((m) => {
    const text = m[2].replace(/[*_`]/g, '').trim()
    return { level: m[1].length, text, id: slug(text) }
  })
}

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
