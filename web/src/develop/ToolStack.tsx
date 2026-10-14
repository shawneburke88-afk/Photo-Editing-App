// The Develop tool stack (owner's decisions, 2026-10-11 and 2026-10-12; docs/USABILITY.md "Develop panel
// layout"): one scrolling list of collapsible groups in workflow order, Crop first, with a jump bar of group
// buttons at the top. Nothing is hidden; the jump bar only scrolls to a group (opening it if it was closed) and
// shows which group is in view. Labels hide when the panel is narrow and the name shows on hover.
//
// Groups are created only when they have content. The planned order (USABILITY.md) is Crop, Basic, Curve,
// Colour, Detail, Effects; each later group is one more entry in the list DevelopView passes.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useStoredJson } from '../lib/useStoredJson'
import { eyeIcon } from './tools'

export type GroupId = 'crop' | 'remove' | 'basic' | 'curve' | 'colour' | 'grading' | 'detail' | 'effects'

export interface ToolGroup {
  id: GroupId
  /** One word for the jump bar (owner's list: Crop, Basic, Curve, Colour, Detail, Effects). */
  label: string
  /** Heading of the group in the stack. */
  title: string
  icon: ReactNode
  content: ReactNode
  /**
   * LightBench's per-group on/off eye (an idea from LightCraft): shows the photo without this group, for a
   * before/after of just this group. Only a view; nothing is saved.
   */
  bypass?: { off: boolean; onToggle: () => void; title: string }
}

interface Props {
  groups: ToolGroup[]
  /** Shown above the groups (e.g. the process version offer). */
  header?: ReactNode
  /** Shown below the groups. */
  footer?: ReactNode
  /** Asks the stack to show a group (e.g. R opens Crop): scrolls to it and opens it. Changes each time. */
  reveal?: { id: GroupId; n: number } | null
}

export function ToolStack({ groups, header, footer, reveal }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [stored, setStored] = useStoredJson<{ closed: GroupId[] }>('lightbench.develop.closedGroups', { closed: [] })
  const closed = new Set(stored.closed)
  const [inView, setInView] = useState<GroupId | null>(groups[0]?.id ?? null)
  // Labels hide when the buttons don't fit with them (the width they need is measured while they are shown).
  const [compact, setCompact] = useState(false)
  const needed = useRef(0)
  const labels = groups.map((g) => g.label).join(' ')
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const check = () => {
      if (!el.classList.contains('compact')) {
        // Each button's content (16 px icon, gap, label) plus its padding and border, then the bar's own gaps and padding.
        const px = (v: string) => parseFloat(v) || 0
        const bar = getComputedStyle(el)
        const buttons = [...el.querySelectorAll<HTMLElement>('.jump')]
        needed.current =
          buttons.reduce((n, b) => {
            const st = getComputedStyle(b)
            const label = b.querySelector<HTMLElement>('.jump-label')?.offsetWidth ?? 0
            return n + 16 + px(st.columnGap) + label + px(st.paddingLeft) + px(st.paddingRight) + px(st.borderLeftWidth) + px(st.borderRightWidth)
          }, 0) +
          (buttons.length - 1) * px(bar.columnGap) + px(bar.paddingLeft) + px(bar.paddingRight)
      }
      setCompact(el.clientWidth + 0.5 < needed.current)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [labels])

  const setOpen = (id: GroupId, open: boolean) => setStored({ closed: open ? stored.closed.filter((x) => x !== id) : [...stored.closed, id] })

  function jump(id: GroupId) {
    if (closed.has(id)) setOpen(id, true)
    // After the group has opened.
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-group="${id}"]`)
      const sc = scroller.current
      if (!el || !sc) return
      sc.scrollTo({ top: el.offsetTop - (bar.current?.offsetHeight ?? 0), behavior: 'smooth' })
      setInView(id)
    })
  }

  useEffect(() => {
    if (reveal) jump(reveal.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal])

  // The group in view: the last one whose heading has reached the bottom of the jump bar.
  useEffect(() => {
    const sc = scroller.current
    if (!sc) return
    const onScroll = () => {
      const top = sc.scrollTop + (bar.current?.offsetHeight ?? 0) + 8
      let current: GroupId | null = null
      const all = [...sc.querySelectorAll<HTMLElement>('[data-group]')]
      for (const el of all) if (el.offsetTop <= top) current = el.dataset.group as GroupId
      // At the very bottom, the last group counts as in view even if its heading can't reach the top.
      if (all.length && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) current = all[all.length - 1].dataset.group as GroupId
      setInView(current ?? groups[0]?.id ?? null)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [groups])

  return (
    <div className="tool-stack" ref={scroller}>
      <nav className={`jumpbar ${compact ? 'compact' : ''}`} ref={bar} aria-label="Tool groups">
        {groups.map((g) => (
          <button
            key={g.id}
            className={`jump ${inView === g.id ? 'on' : ''}`}
            onClick={() => jump(g.id)}
            title={g.title}
            aria-label={g.title}
            aria-current={inView === g.id ? 'true' : undefined}
          >
            {g.icon}
            <span className="jump-label">{g.label}</span>
          </button>
        ))}
      </nav>
      {header}
      {groups.map((g) => {
        const open = !closed.has(g.id)
        return (
          <section key={g.id} className={`tool-group ${open ? 'open' : 'closed'} ${g.bypass?.off ? 'bypassed' : ''}`} data-group={g.id} aria-label={g.title}>
            <header className="tool-group-head">
              <button className="tool-group-toggle" onClick={() => setOpen(g.id, !open)} aria-expanded={open}>
                <span className="tool-group-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                {g.icon}
                <span>{g.title}</span>
              </button>
              {g.bypass && (
                <button
                  className={`tool-group-eye ${g.bypass.off ? 'off' : ''}`}
                  onClick={g.bypass.onToggle}
                  aria-pressed={g.bypass.off}
                  title={g.bypass.title}
                  aria-label={g.bypass.title}
                >
                  {eyeIcon(g.bypass.off)}
                </button>
              )}
            </header>
            {open && <div className="tool-group-body">{g.content}</div>}
          </section>
        )
      })}
      {footer}
    </div>
  )
}
