import { describe, expect, it } from 'vitest'
import { keywordTree, parseKeywordInput, showKeyword } from './keywords'

describe('keyword input', () => {
  it('splits on commas and makes hierarchies from > or |', () => {
    expect(parseKeywordInput('Places > Canada > Ottawa, Family , ,Trips|2026')).toEqual(['Places|Canada|Ottawa', 'Family', 'Trips|2026'])
  })

  it('drops duplicates regardless of case', () => {
    expect(parseKeywordInput('Lake, lake, LAKE')).toEqual(['Lake'])
  })

  it('shows paths with chevrons', () => {
    expect(showKeyword('Places|Canada')).toBe('Places › Canada')
  })
})

describe('keywordTree', () => {
  it('nests levels and keeps direct counts', () => {
    const tree = keywordTree([
      { path: 'Places|Canada|Ottawa', count: 3 },
      { path: 'Places|Canada', count: 1 },
      { path: 'Family', count: 2 },
    ])
    expect(tree.map((n) => n.name)).toEqual(['Family', 'Places'])
    const places = tree[1]
    expect(places.count).toBe(0)
    expect(places.children[0]).toMatchObject({ name: 'Canada', path: 'Places|Canada', count: 1 })
    expect(places.children[0].children[0]).toMatchObject({ name: 'Ottawa', count: 3 })
  })
})
