'use client'

import { useState } from 'react'
import Icon from './Icon'
import type { MindNode } from '@/lib/prompts'

// Mind map renderer (خريطة ذهنية): the AI tree drawn as an indented outline
// with connector lines. Every branch collapses on tap, so a 3-level map works
// as a two-minute review and as a full reference. Pure CSS + logical
// properties → RTL-safe and dark-mode aware like the rest of the app.

const BRANCH_DOTS = [
  'bg-brand',
  'bg-navy',
  'bg-warn',
  'bg-danger',
]

function Leaf({ t, dot }: { t: string; dot: string }) {
  return (
    <li className="flex items-start gap-2 py-0.5">
      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span dir="auto" className="text-sm leading-6">{t}</span>
    </li>
  )
}

function Branch({ node, depth }: { node: MindNode; depth: number }) {
  const [open, setOpen] = useState(true)
  const kids = node.c ?? []
  if (kids.length === 0) return <Leaf t={node.t} dot={BRANCH_DOTS[depth % BRANCH_DOTS.length]} />
  return (
    <li className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        dir="auto"
        className="flex w-full items-start gap-2 rounded-lg py-0.5 text-start hover:bg-surface2/60"
      >
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-current opacity-70 transition-transform ${open ? 'rotate-0' : 'rotate-180 rtl:-rotate-180'}`}>
          <Icon name={open ? 'chevD' : 'chevU'} className="h-3.5 w-3.5" />
        </span>
        <span className={`text-sm font-semibold leading-6 ${depth === 0 ? 'text-brand' : ''}`}>{node.t}</span>
        <span className="muted ms-auto shrink-0 pt-1 text-[11px]">{kids.length}</span>
      </button>
      {open && (
        <ul className="ms-2 border-s border-line ps-4">
          {kids.map((k, i) => (
            <Branch key={i} node={k} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function MindMap({ tree, hint }: { tree: MindNode; hint: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl bg-brand-soft px-4 py-3">
        <span dir="auto" className="text-base font-bold text-brand">{tree.t}</span>
      </div>
      <ul className="ms-1 flex flex-col">
        {(tree.c ?? []).map((b, i) => (
          <Branch key={i} node={b} depth={0} />
        ))}
      </ul>
      <p className="muted text-xs leading-5">{hint}</p>
    </div>
  )
}
