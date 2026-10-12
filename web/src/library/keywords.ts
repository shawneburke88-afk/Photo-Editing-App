import { KEYWORD_SEP, normalizeKeyword } from '../sidecar/xmp'

/** "Places > Canada > Ottawa, Family" → ["Places|Canada|Ottawa", "Family"] (">" or "|" separate levels). */
export function parseKeywordInput(text: string): string[] {
  const out = new Map<string, string>()
  for (const part of text.split(',')) {
    const path = normalizeKeyword(part.replace(/>/g, KEYWORD_SEP))
    if (path && !out.has(path.toLowerCase())) out.set(path.toLowerCase(), path)
  }
  return [...out.values()]
}

/** "Places|Canada|Ottawa" → "Places › Canada › Ottawa". */
export const showKeyword = (path: string) => path.split(KEYWORD_SEP).join(' › ')

export interface KeywordNode {
  name: string
  path: string
  /** Photos carrying exactly this keyword (0 for a level that only groups others). */
  count: number
  children: KeywordNode[]
}

/** Builds the keyword tree from the flat list of paths. */
export function keywordTree(list: { path: string; count: number }[]): KeywordNode[] {
  const root: KeywordNode = { name: '', path: '', count: 0, children: [] }
  for (const { path, count } of list) {
    let node = root
    let sofar = ''
    for (const part of path.split(KEYWORD_SEP)) {
      sofar = sofar ? `${sofar}${KEYWORD_SEP}${part}` : part
      let child = node.children.find((c) => c.name.toLowerCase() === part.toLowerCase())
      if (!child) {
        child = { name: part, path: sofar, count: 0, children: [] }
        node.children.push(child)
      }
      node = child
    }
    node.count += count
  }
  const sort = (n: KeywordNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}
