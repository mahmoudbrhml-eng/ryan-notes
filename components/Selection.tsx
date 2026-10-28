'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

type Ctx = {
  selected: string[]
  mode: boolean
  toggle: (id: string) => void
  start: (id: string) => void
  clear: () => void
}

const C = createContext<Ctx>({ selected: [], mode: false, toggle: () => {}, start: () => {}, clear: () => {} })

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>([])
  const [mode, setMode] = useState(false)
  const value: Ctx = {
    selected,
    mode,
    toggle: (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    start: (id) => {
      setMode(true)
      setSelected((s) => (s.includes(id) ? s : [...s, id]))
    },
    clear: () => {
      setSelected([])
      setMode(false)
    },
  }
  return <C.Provider value={value}>{children}</C.Provider>
}

export const useSelection = () => useContext(C)
