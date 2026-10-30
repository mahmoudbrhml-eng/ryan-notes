'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

type Ctx = {
  selected: string[]
  mode: boolean
  toggle: (id: string) => void
  start: (id: string) => void
  setAll: (ids: string[]) => void
  clear: () => void
}

const C = createContext<Ctx>({ selected: [], mode: false, toggle: () => {}, start: () => {}, setAll: () => {}, clear: () => {} })

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>([])
  // "Mode" is just "something is ticked" now: the small checkbox on every row
  // selects directly, so there is no separate selection state to enter or leave.
  const value: Ctx = {
    selected,
    mode: selected.length > 0,
    toggle: (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    start: (id) => setSelected((s) => (s.includes(id) ? s : [...s, id])),
    setAll: (ids) => setSelected(ids),
    clear: () => setSelected([]),
  }
  return <C.Provider value={value}>{children}</C.Provider>
}

export const useSelection = () => useContext(C)
