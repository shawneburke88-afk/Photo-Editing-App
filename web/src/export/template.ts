// Export file names from templates, using darktable's variable syntax (src/common/variables.c) so templates
// work in both apps: $(FILE.NAME), $(SEQUENCE[4,1]), $(EXIF.YEAR) …, plus darktable's legacy underscore
// names ($(FILE_NAME)) and a subset of its bash-like operators: $(VAR-default), $(VAR^^), $(VAR,,),
// $(VAR:offset:length). A "/" in a template makes subfolders.

export interface TemplateContext {
  fileName: string
  /** Folder of the original, relative to its library folder. */
  folder: string
  /** 1-based position in this export batch. */
  sequence: number
  /** Camera-local capture time as Unix seconds read in UTC (0 if unknown). */
  capturedAt: number
  make: string
  model: string
  lens: string
  iso: number
  aperture: number
  shutter: number
  focalLength: number
  rating: number
  /** 0 none, 1 red … 5 purple. */
  color: number
  width: number
  height: number
  now?: Date
}

export const TEMPLATE_PRESETS = [
  { id: 'original', label: 'Same name as the original', template: '$(FILE.NAME)' },
  { id: 'edited', label: 'Original name + “-edit”', template: '$(FILE.NAME)-edit' },
  { id: 'date-seq', label: 'Capture date + number', template: '$(EXIF.YEAR)-$(EXIF.MONTH)-$(EXIF.DAY)_$(SEQUENCE[4])' },
  { id: 'date-name', label: 'Capture date + original name', template: '$(EXIF.YEAR)$(EXIF.MONTH)$(EXIF.DAY)_$(FILE.NAME)' },
] as const

/** Variables listed in the export dialog's help. */
export const TEMPLATE_VARIABLES: [string, string][] = [
  ['$(FILE.NAME)', 'original file name without extension'],
  ['$(FILE.EXTENSION)', 'original extension, e.g. NEF'],
  ['$(FILE.FOLDER)', 'folder of the original'],
  ['$(SEQUENCE[4,1])', 'number in this export, 4 digits, starting at 1'],
  ['$(EXIF.YEAR) $(EXIF.MONTH) $(EXIF.DAY)', 'capture date'],
  ['$(EXIF.HOUR) $(EXIF.MINUTE) $(EXIF.SECOND)', 'capture time'],
  ['$(YEAR) $(MONTH) $(DAY)', 'today’s date'],
  ['$(EXIF.MAKER) $(EXIF.MODEL) $(EXIF.LENS)', 'camera and lens'],
  ['$(EXIF.ISO) $(EXIF.APERTURE) $(EXIF.EXPOSURE) $(EXIF.FOCAL.LENGTH)', 'camera settings'],
  ['$(STARS) $(LABELS)', 'rating and colour label'],
  ['$(WIDTH.EXPORT) $(HEIGHT.EXPORT)', 'exported size in pixels'],
]

const LABELS = ['', 'red', 'yellow', 'green', 'blue', 'purple']
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function value(name: string, args: string | undefined, c: TemplateContext): string | null {
  const cap = c.capturedAt > 0 ? new Date(c.capturedAt * 1000) : null
  const now = c.now ?? new Date()
  const dot = c.fileName.lastIndexOf('.')
  switch (name) {
    case 'FILE.NAME':
      return dot > 0 ? c.fileName.slice(0, dot) : c.fileName
    case 'FILE.EXTENSION':
      return dot > 0 ? c.fileName.slice(dot + 1) : ''
    case 'FILE.FOLDER':
      return c.folder
    case 'SEQUENCE': {
      const [digits = '4', start = '1'] = (args ?? '').split(',').map((s) => s.trim())
      return pad(c.sequence - 1 + (Number(start) || 0), Number(digits) || 4)
    }
    case 'EXIF.YEAR':
      return cap ? String(cap.getUTCFullYear()) : ''
    case 'EXIF.MONTH':
      return cap ? pad(cap.getUTCMonth() + 1) : ''
    case 'EXIF.DAY':
      return cap ? pad(cap.getUTCDate()) : ''
    case 'EXIF.HOUR':
      return cap ? pad(cap.getUTCHours()) : ''
    case 'EXIF.MINUTE':
      return cap ? pad(cap.getUTCMinutes()) : ''
    case 'EXIF.SECOND':
      return cap ? pad(cap.getUTCSeconds()) : ''
    case 'YEAR':
      return String(now.getFullYear())
    case 'MONTH':
      return pad(now.getMonth() + 1)
    case 'DAY':
      return pad(now.getDate())
    case 'HOUR':
      return pad(now.getHours())
    case 'MINUTE':
      return pad(now.getMinutes())
    case 'SECOND':
      return pad(now.getSeconds())
    case 'EXIF.MAKER':
      return c.make
    case 'EXIF.MODEL':
      return c.model
    case 'EXIF.LENS':
      return c.lens
    case 'EXIF.ISO':
      return c.iso ? String(Math.round(c.iso)) : ''
    case 'EXIF.APERTURE':
      return c.aperture ? c.aperture.toFixed(1) : ''
    case 'EXIF.EXPOSURE':
      // darktable replaces "/" with "_" in file names.
      return !c.shutter ? '' : c.shutter < 1 ? `1_${Math.round(1 / c.shutter)}` : `${Math.round(c.shutter * 10) / 10}`
    case 'EXIF.FOCAL.LENGTH':
      return c.focalLength ? String(Math.round(c.focalLength)) : ''
    case 'STARS':
      return String(c.rating)
    case 'LABELS':
      return LABELS[c.color] ?? ''
    case 'WIDTH.EXPORT':
      return String(c.width)
    case 'HEIGHT.EXPORT':
      return String(c.height)
    default:
      return null
  }
}

/** Applies the operators darktable supports (subset) to a variable's value. */
function operate(v: string, op: string): string {
  if (op === '^^') return v.toUpperCase()
  if (op === ',,') return v.toLowerCase()
  if (op === '^') return v.charAt(0).toUpperCase() + v.slice(1)
  if (op === ',') return v.charAt(0).toLowerCase() + v.slice(1)
  if (op.startsWith('-')) return v || op.slice(1)
  if (op.startsWith('+')) return v ? op.slice(1) : ''
  const m = /^:(-?\d+)(?::(\d+))?$/.exec(op)
  if (m) {
    const off = Number(m[1])
    const start = off < 0 ? Math.max(0, v.length + off) : off
    return m[2] !== undefined ? v.substr(start, Number(m[2])) : v.slice(start)
  }
  return v
}

/** Characters Windows (and most systems) don't allow in file names. */
export const sanitizeSegment = (s: string) =>
  Array.from(s, (ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
    .join('')
    .replace(/[. ]+$/, '')
    .trim()

/**
 * Expands a template into a relative path without extension ("2026/2026-10-11_0001"). Unknown variables are
 * left as typed so mistakes are visible.
 */
export function expandTemplate(template: string, c: TemplateContext): string {
  const expanded = template.replace(/\$\(([A-Za-z_.]+)(?:\[([^\]]*)\])?((?:\^\^|,,|\^|,|[-+][^)]*|:-?\d+(?::\d+)?)?)\)/g, (whole, raw: string, args, op) => {
    const name = raw.toUpperCase().replace(/_/g, '.')
    const v = value(name, args, c)
    return v === null ? whole : operate(v, op ?? '')
  })
  const parts = expanded.split('/').map(sanitizeSegment).filter(Boolean)
  return parts.length ? parts.join('/') : 'export'
}
