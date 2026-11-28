import { describe, expect, it } from 'vite-plus/test'

import { isSpaceTarget, isTypingTarget } from '../../../src/player/surface-interaction'

type MockElement = {
  tagName: string
  attrs: Record<string, string>
  parent: MockElement | null
  closest: (selector: string) => MockElement | null
}

const matchesSimpleSelector = (el: MockElement, selector: string): boolean => {
  const trimmed = selector.trim()
  const roleMatch = /^\[role="([^"]+)"\]$/.exec(trimmed)
  if (roleMatch) return el.attrs.role === roleMatch[1]
  return el.tagName.toLowerCase() === trimmed.toLowerCase()
}

const makeEl = (tagName: string, attrs: Record<string, string> = {}, parent: MockElement | null = null): MockElement => {
  const el: MockElement = {
    tagName: tagName.toUpperCase(),
    attrs,
    parent,
    closest(selector: string) {
      const parts = selector.split(',')
      let cur: MockElement | null = el
      while (cur) {
        if (parts.some((part) => matchesSimpleSelector(cur!, part))) return cur
        cur = cur.parent
      }
      return null
    },
  }
  return el
}

describe('player shortcut target guards', () => {
  it('treats buttons, selects, summaries, and interactive ARIA controls as Space targets', () => {
    const button = makeEl('button', { type: 'button' })
    const buttonLabel = makeEl('span', {}, button)
    expect(isSpaceTarget(button as unknown as EventTarget)).toBe(true)
    expect(isSpaceTarget(buttonLabel as unknown as EventTarget)).toBe(true)

    const menuCheckbox = makeEl('button', { role: 'menuitemcheckbox', 'aria-checked': 'false' })
    const menuLabel = makeEl('span', {}, menuCheckbox)
    expect(isSpaceTarget(menuCheckbox as unknown as EventTarget)).toBe(true)
    expect(isSpaceTarget(menuLabel as unknown as EventTarget)).toBe(true)

    for (const role of ['button', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'checkbox', 'radio', 'option', 'tab', 'combobox']) {
      expect(isSpaceTarget(makeEl('div', { role }) as unknown as EventTarget)).toBe(true)
    }
    expect(isSpaceTarget(makeEl('select') as unknown as EventTarget)).toBe(true)
    expect(isSpaceTarget(makeEl('summary') as unknown as EventTarget)).toBe(true)
  })

  it('lets Space control playback on sliders, links, video, headings, and non-elements', () => {
    expect(isSpaceTarget(makeEl('div', { role: 'slider' }) as unknown as EventTarget)).toBe(false)
    expect(isSpaceTarget(makeEl('a', { href: '/watch?v=dQw4w9WgXcQ' }) as unknown as EventTarget)).toBe(false)
    expect(isSpaceTarget(makeEl('video') as unknown as EventTarget)).toBe(false)
    expect(isSpaceTarget(makeEl('h1') as unknown as EventTarget)).toBe(false)
    expect(isSpaceTarget({} as unknown as EventTarget)).toBe(false)
    expect(isSpaceTarget(null)).toBe(false)
  })

  it('identifies typing targets accurately', () => {
    expect(isTypingTarget(makeEl('input') as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget(makeEl('textarea') as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget(makeEl('button') as unknown as EventTarget)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
