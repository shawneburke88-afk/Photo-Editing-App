// The Masks group of the tool stack (docs/PHASE3.md Part 23; owner's decision 6: docked, not floating): new masks,
// the list of masks with their parts and their eyes, the overlay, then the selected mask's Amount, Feather and Refine,
// the selected part's own controls, and its local sliders in Basic's groups and order.

import { useState, useSyncExternalStore } from 'react'
import { withKey } from '../settings/shortcuts'
import {
  AI_WHAT_LABELS, describeKinds, hasUnknown, isPeoplePart, KIND_LABELS, PEOPLE_PARTS, LOCAL_KEYS, LOCAL_LABELS, LOCAL_RANGE, maskFamily, MAX_DABS, MAX_MASKS, needsAi, needsDepth, partLabel, RANGE_KINDS, SHAPE_KINDS,
  type AiShape, type PeoplePart, type BrushShape, type ColourShape, type DepthShape, type LocalKey, type LocalMask, type LuminanceShape, type MaskComponent, type MaskOp, type RadialShape, type ShapeKind,
} from '../engine/develop/masks'
import type { Depth } from './useDepth'
import type { ObjectSelect } from './useObjectSelect'
import type { People } from './usePeople'
import type { PeoplePick } from './useMasking'
import type { SkySelect } from './useSky'
import { OVERLAY_MODES } from '../engine/develop/indicators'
import { HELP, MASK_HELP, PEOPLE_PART_HELP, RANGE_NOTE, type ControlHelp } from './help'
import { DEFAULT_MASK_BRUSH, MASK_BRUSH_SIZE, OVERLAY_COLOURS } from './maskUi'
import { Slider } from './Slider'
import { eyeIcon } from './tools'
import type { Masking } from './useMasking'
import { describeMaskValues, maskClipboard, maskValues } from './maskSettings'
import { MaskPresetsMenu } from './MaskPresetsMenu'

interface Props {
  masks: LocalMask[]
  m: Masking
  disabled: boolean
  showHint: boolean
  /** A Lightroom `.acr` file is next to the photo: its masks can't be read. */
  acr: boolean
  /** Masks read from Lightroom's own fields, and what was left out (experimental). */
  lightroomNote: string | null
  /** The AI Depth range's model and depth map (Part 24). */
  depth: Depth
  /** Object select's model, the photo's encoding and its messages (Part 27). */
  object: ObjectSelect
  /** People: the people and faces found on the photo, and the list to tick (Part 28). */
  people: People
  /** The Sky mask's model and its messages (Part 29). */
  sky: SkySelect
}

const NEW_KINDS: { kind: ShapeKind; action: string; short: string }[] = [
  { kind: 'brush', action: 'develop.maskBrush', short: 'Brush' },
  { kind: 'linear', action: 'develop.maskLinear', short: 'Linear' },
  { kind: 'radial', action: 'develop.maskRadial', short: 'Radial' },
  { kind: 'colour', action: 'develop.maskColour', short: 'Colour' },
  { kind: 'luminance', action: 'develop.maskLuminance', short: 'Luminance' },
]
/** The AI row (Part 27): masks an AI model makes on this computer (People and Sky have their own buttons below; subject joins later). */
const AI_KINDS: { kind: ShapeKind; action: string; short: string }[] = [
  { kind: 'ai', action: 'develop.maskObject', short: 'Object' },
  { kind: 'depth', action: 'develop.maskDepth', short: 'Depth' },
]
const OP_SIGN: Record<MaskOp, string> = { add: '+', subtract: '−', intersect: '∩' }
const OP_NAME: Record<MaskOp, string> = { add: 'Add', subtract: 'Subtract', intersect: 'Intersect' }

const LOCAL_GROUPS: { title: string; keys: LocalKey[] }[] = [
  { title: 'White balance', keys: ['temperature', 'tint'] },
  { title: 'Tone', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { title: 'Presence', keys: ['texture', 'clarity', 'dehaze', 'saturation', 'vibrance'] },
  // Glow: only its amount is per mask (owner's decision GL3; Camera Raw: "the Glow amount can be set independently for each
  // mask"); its Style, Range, Spread and Warmth are the Effects group's.
  { title: 'Effects', keys: ['glow'] },
]
const BASIC_HELP: Record<LocalKey, string> = { temperature: 'temp', tint: 'tint', exposure: 'exposure', contrast: 'contrast', highlights: 'highlights', shadows: 'shadows', whites: 'whites', blacks: 'blacks', saturation: 'saturation', vibrance: 'vibrance', texture: 'texture', clarity: 'clarity', dehaze: 'dehaze', glow: 'glowLocal' }

function localHelp(k: LocalKey): ControlHelp {
  const h = HELP[BASIC_HELP[k]]
  if (k === 'temperature' || k === 'tint')
    return {
      hint: k === 'temperature' ? 'Warmer or cooler, in the mask' : 'Greener or more magenta, in the mask',
      what: `${k === 'temperature' ? 'Shifts the colour towards blue or yellow' : 'Shifts the colour towards green or magenta'} inside the mask, relative to the photo’s white balance (−100…100, not kelvin), keeping its brightness.`,
      left: k === 'temperature' ? 'Cooler.' : 'Greener.',
      right: k === 'temperature' ? 'Warmer.' : 'More magenta.',
    }
  if (k === 'glow') return h
  const where = k === 'texture' || k === 'clarity' || k === 'dehaze' ? 'Presence slider' : 'slider'
  return { ...h, hint: `${h.hint}, in the mask`, what: `${h.what} Here it acts only where the mask is, on top of Basic’s ${where} (the two add up).` }
}

/** The "Part to combine" choice for a Sky part (an AI part, `what: 'sky'`; Part 29). */
const SKY_PART = 'sky'

export function MasksPanel({ masks, m, disabled, showHint, acr, lightroomNote, depth, object, people, sky }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [addKind, setAddKind] = useState<ShapeKind | typeof SKY_PART | null>(null)
  const mask = masks.find((x) => x.id === m.sel.mask) ?? null
  const comp = mask?.components.find((c) => c.id === m.sel.comp) ?? null
  const family = mask ? maskFamily(mask) : null
  const kindsFor = family === 'range' ? RANGE_KINDS : family === 'shape' ? SHAPE_KINDS : [...SHAPE_KINDS, ...RANGE_KINDS]
  const skyAdd = addKind === SKY_PART && kindsFor.includes('ai')
  const chosenAdd = addKind && addKind !== SKY_PART && kindsFor.includes(addKind) ? addKind : kindsFor[0]
  const ov = m.overlay
  /** Copied mask settings (Part 31): kept while LightBench is open, for any mask on any photo. */
  const clip = useSyncExternalStore(maskClipboard.subscribe, maskClipboard.get)

  return (
    <div className="dpanel masks-panel">
      {acr && (
        <p className="masks-warn small" role="note">
          This photo has a Lightroom <code>.acr</code> file next to it. Lightroom keeps heavy edits, masks and AI settings there; LightBench can’t read it, so masks kept there are missing here.
        </p>
      )}
      {lightroomNote && <p className="masks-note small muted" role="note">{lightroomNote}</p>}
      <section>
        <div className="crop-tools">
          <button className={`button small ${m.active ? 'on' : ''}`} disabled={disabled} onClick={() => (m.active ? m.end() : m.start())} aria-pressed={m.active} title={withKey(m.active ? 'Finish masking' : 'Show the masks on the photo, to draw and change them', 'develop.masks')}>
            {m.active ? 'Done' : 'Edit on photo…'}
          </button>
          <span className="muted small">{masks.length ? `${masks.length} ${masks.length === 1 ? 'mask' : 'masks'}` : 'No masks yet'}</span>
        </div>
        <div className="mask-new" role="group" aria-label="New mask">
          {NEW_KINDS.map((k) => (
            <button
              key={k.kind}
              className={`button small touch ${m.creating?.kind === k.kind && !m.creating.op ? 'on' : ''}`}
              disabled={disabled || masks.length >= MAX_MASKS}
              onClick={() => m.newOf(k.kind)}
              title={withKey(k.kind === 'depth' ? `New depth range mask (AI): ${MASK_HELP.depthNew.what}` : `New ${KIND_LABELS[k.kind].toLowerCase()} mask`, k.action)}
            >
              {k.short}
            </button>
          ))}
        </div>
        <div className="mask-new mask-ai" role="group" aria-label="New AI mask">
          <span className="small muted mask-ai-label" title="Masks an AI model makes on this computer: your photos are never uploaded">AI</span>
          {AI_KINDS.map((k) => (
            <button
              key={k.kind}
              className={`button small touch ${(k.kind === 'ai' ? m.objectMode === 'new' : m.creating?.kind === k.kind && !m.creating.op) ? 'on' : ''}`}
              disabled={disabled || masks.length >= MAX_MASKS || (k.kind === 'ai' && m.objectBusy)}
              aria-pressed={k.kind === 'ai' ? m.objectMode === 'new' : undefined}
              onClick={() => (k.kind === 'ai' && m.objectMode === 'new' ? m.setCreating(null) : m.newOf(k.kind))}
              title={withKey(k.kind === 'depth' ? `New depth range mask (AI): ${MASK_HELP.depthNew.what}` : `New object selection (AI): ${MASK_HELP.objectNew.what}`, k.action)}
            >
              {k.short}
            </button>
          ))}
          <button
            className={`button small touch ${people.found ? 'on' : ''}`}
            disabled={disabled || masks.length >= MAX_MASKS || m.objectBusy}
            aria-pressed={!!people.found}
            onClick={() => (people.found ? people.close() : void m.findPeople())}
            title={withKey(`New people mask (AI): ${MASK_HELP.peopleNew.what}`, 'develop.maskPeople')}
          >
            People
          </button>
          <button
            className={`button small touch ${m.skyBusy ? 'on' : ''}`}
            disabled={disabled || masks.length >= MAX_MASKS || m.skyBusy}
            aria-busy={m.skyBusy || undefined}
            onClick={() => void m.newSky()}
            title={`New sky mask (AI): ${MASK_HELP.skyNew.what}`}
          >
            Sky
          </button>
        </div>
        <p className="muted small mask-range-note">{RANGE_NOTE}</p>
        {people.status && <p className="small crop-note" role="status" aria-busy="true">{people.status}</p>}
        {people.error && (
          <p className="small masks-warn" role="alert">
            {people.error}{' '}
            <button className="linklike" onClick={() => window.dispatchEvent(new CustomEvent('lightbench:settings', { detail: 'ai' }))} title="Open Settings → AI models">AI models…</button>{' '}
            <button className="linklike" onClick={() => people.setError(null)} title="Hide this message">Dismiss</button>
          </p>
        )}
        {people.found && <PeopleList people={people} m={m} disabled={disabled} />}
        {m.objectMode && (
          <div className="small crop-note mask-object-note" role="status">
            {object.status ? (
              <span aria-busy="true">{object.status}</span>
            ) : !object.ready ? (
              <span aria-busy="true">Getting Object select ready…</span>
            ) : m.objectBusy ? (
              <span aria-busy="true">Selecting…</span>
            ) : m.objectMode === 'refine' ? (
              <span>Click something to select it; Shift-click adds to the selected object, Alt-click removes from it, a drag selects inside a box. On a touch screen, tap, then choose below.</span>
            ) : (
              <span>Point at something to see what would be selected, then click{m.objectMode === 'part' && m.creating?.op ? ` to ${m.creating.op} it` : ''}; a drag selects inside a box. On a touch screen, tap, then choose below.</span>
            )}{' '}
            <button className="linklike" onClick={() => (m.objectMode === 'refine' ? m.setPicking(null) : m.setCreating(null))} title="End Object select (Esc)">Done</button>
            {m.touchPoint && (
              <span className="crop-tools mask-object-touch" role="group" aria-label="Use the tapped spot">
                <button className="button small touch" disabled={disabled || m.objectBusy || !object.ready} onClick={() => void m.onObjectClick(m.touchPoint)} title={MASK_HELP.objectSelectHere.what}>Select</button>
                {m.objectMode === 'refine' && (
                  <>
                    <button className="button small touch" disabled={disabled || m.objectBusy || !object.ready} onClick={() => void m.onObjectClick(m.touchPoint, true, false)} title={MASK_HELP.objectAdd.what}>Add</button>
                    <button className="button small touch" disabled={disabled || m.objectBusy || !object.ready} onClick={() => void m.onObjectClick(m.touchPoint, false, true)} title={MASK_HELP.objectRemove.what}>Remove</button>
                  </>
                )}
              </span>
            )}
          </div>
        )}
        {object.error && (
          <p className="small masks-warn" role="alert">
            {object.error}{' '}
            <button className="linklike" onClick={() => window.dispatchEvent(new CustomEvent('lightbench:settings', { detail: 'ai' }))} title="Open Settings → AI models">AI models…</button>{' '}
            <button className="linklike" onClick={() => object.setError(null)} title="Hide this message">Dismiss</button>
          </p>
        )}
        {(sky.status || m.skyBusy) && <p className="small crop-note" role="status" aria-busy="true">{sky.status ?? 'Getting the Sky mask ready…'}</p>}
        {sky.error && (
          <p className="small masks-warn" role="alert">
            {sky.error}{' '}
            <button className="linklike" onClick={() => window.dispatchEvent(new CustomEvent('lightbench:settings', { detail: 'ai' }))} title="Open Settings → AI models">AI models…</button>{' '}
            <button className="linklike" onClick={() => sky.setError(null)} title="Hide this message">Dismiss</button>
          </p>
        )}
        {masks.some(needsAi) && (
          <p className="small masks-note" role="note">
            Some AI selections aren’t made for this photo yet, so they aren’t shown.{' '}
            <button className="linklike" disabled={disabled || m.objectBusy || m.skyBusy} onClick={() => void m.computeMissingAi()} title={MASK_HELP.objectCompute.what}>Compute for this photo</button>
          </p>
        )}
        {m.creating && m.creating.kind !== 'ai' && (
          <p className="small crop-note" role="status">
            {m.creating.kind === 'linear' ? 'Drag on the photo from where the effect is full to where it ends.' : m.creating.kind === 'radial' ? 'Drag on the photo from the centre outwards (a click makes a circle).' : m.creating.kind === 'brush' ? 'Paint on the photo. Alt-drag erases.' : 'Click a colour on the photo.'}{' '}
            <button className="linklike" onClick={() => m.setCreating(null)}>Cancel</button>
          </p>
        )}
        {m.picking === 'luminance' && <p className="small crop-note" role="status">Click a tone on the photo to centre the range on it. <button className="linklike" onClick={() => m.setPicking(null)}>Done</button></p>}
        {m.picking === 'colour' && <p className="small crop-note" role="status">Click a colour on the photo; Shift-click adds a sample (up to five). <button className="linklike" onClick={() => m.setPicking(null)}>Done</button></p>}
        {m.picking === 'depth' && <p className="small crop-note" role="status">Click on the photo to centre the depth range at that distance. <button className="linklike" onClick={() => m.setPicking(null)}>Done</button></p>}
        {(depth.status || m.depthBusy) && <p className="small crop-note" role="status" aria-busy="true">{depth.status ?? 'Preparing the AI Depth model…'}</p>}
        {depth.error && (
          <p className="small masks-warn" role="alert">
            {depth.error}{' '}
            <button className="linklike" onClick={() => window.dispatchEvent(new CustomEvent('lightbench:settings', { detail: 'ai' }))}>AI models…</button>{' '}
            <button className="linklike" onClick={() => depth.setError(null)}>Dismiss</button>
          </p>
        )}
        {masks.some(needsDepth) && (
          <p className="small masks-note" role="note">
            Some Depth ranges have no depth map for this photo yet, so they aren’t shown.{' '}
            <button className="linklike" disabled={disabled || m.depthBusy} onClick={() => void m.computeMissingDepth()}>Compute the depth map</button>
          </p>
        )}
        {m.message && <p className="small masks-warn" role="alert">{m.message}</p>}
        {masks.length > 0 && (
          <ul className="mask-list" aria-label="Masks">
            {masks.map((x) => {
              const sel = x.id === m.sel.mask
              const off = m.hidden.has(x.id)
              return (
                <li key={x.id} className={`mask-row ${sel ? 'selected' : ''}`}>
                  <div className="mask-head">
                    <button className={`tool-group-eye mask-eye ${off ? 'off' : ''}`} onClick={() => m.toggleHidden(x.id)} aria-pressed={off} title={off ? `Show ${x.name} again` : `Show the photo without ${x.name} (nothing is changed)`} aria-label={off ? `Show ${x.name} again` : `Hide ${x.name}`} disabled={disabled}>
                      {eyeIcon(off)}
                    </button>
                    {renaming === x.id ? (
                      <input
                        className="mask-rename"
                        defaultValue={x.name}
                        autoFocus
                        aria-label="Mask name"
                        onBlur={(e) => {
                          m.rename(x.id, e.target.value)
                          setRenaming(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') setRenaming(null)
                          e.stopPropagation()
                        }}
                      />
                    ) : (
                      <button className="mask-name touch" onClick={() => m.select(sel ? null : x.id)} onDoubleClick={() => setRenaming(x.id)} aria-pressed={sel} title="Click to select · double-click to rename">
                        <span>{x.name}</span>
                        <span className="muted small">{hasUnknown(x) ? 'made with a newer LightBench: kept, not shown' : `${describeKinds(x)}${x.invert ? ', inverted' : ''}`}</span>
                      </button>
                    )}
                  </div>
                  {sel && (
                    <ul className="mask-parts" aria-label={`Parts of ${x.name}`}>
                      {x.components.map((c, i) => (
                        <ComponentRow key={c.id} c={c} first={i === 0} selected={c.id === m.sel.comp} m={m} disabled={disabled} />
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {mask && (
          <div className="mask-add" role="group" aria-label={`Add to ${mask.name}`}>
            <select aria-label="Part to combine" title="The kind of part to combine with this mask" value={skyAdd ? SKY_PART : chosenAdd} onChange={(e) => setAddKind(e.target.value as ShapeKind | typeof SKY_PART)} disabled={disabled}>
              {kindsFor.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}{k === 'depth' || k === 'ai' ? ' (AI)' : ''}</option>)}
              {kindsFor.includes('ai') && <option value={SKY_PART}>Sky (AI)</option>}
            </select>
            {(['add', 'subtract', 'intersect'] as MaskOp[]).map((op) => (
              <button key={op} className="button small touch" disabled={disabled || (skyAdd && m.skyBusy)} onClick={() => (skyAdd ? void m.newSky(op) : m.addPart(chosenAdd, op))} title={skyAdd ? `${OP_NAME[op]} the sky ${op === 'add' ? 'to' : op === 'subtract' ? 'from' : 'with'} ${mask.name}: ${MASK_HELP.skyPart.what}` : `${OP_NAME[op]} ${chosenAdd === 'ai' ? 'an object selection' : `a ${KIND_LABELS[chosenAdd].toLowerCase()}`} ${op === 'add' ? 'to' : op === 'subtract' ? 'from' : 'with'} ${mask.name}`}>
                {OP_SIGN[op]} {OP_NAME[op]}
              </button>
            ))}
          </div>
        )}
        <div className="mask-overlay-row" role="group" aria-label="Mask overlay">
          <label className="check small" title={withKey('Show the selected mask over the photo while masking', 'mask.overlay')}>
            <input type="checkbox" checked={ov.on} onChange={(e) => m.setOverlay({ ...ov, on: e.target.checked })} disabled={disabled} />
            Overlay
          </label>
          <select aria-label="Overlay mode" title={withKey('Overlay mode', 'mask.overlayMode')} value={ov.mode} onChange={(e) => m.setOverlay({ ...ov, on: true, mode: Number(e.target.value) })} disabled={disabled}>
            {OVERLAY_MODES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
          </select>
          <select aria-label="Overlay colour" title={withKey('Overlay colour', 'mask.overlayColour')} value={ov.colour} onChange={(e) => m.setOverlay({ ...ov, on: true, colour: Number(e.target.value) })} disabled={disabled || ov.mode > 2}>
            {OVERLAY_COLOURS.map((c, i) => <option key={c.name} value={i}>{c.name}</option>)}
          </select>
        </div>
        {(ov.mode <= 2) && (
          <Slider label="Overlay opacity" value={ov.opacity} min={10} max={100} step={1} defaultValue={50} format={(v) => `${Math.round(v)} %`} disabled={disabled} onChange={(v) => m.setOverlay({ ...ov, opacity: v })} />
        )}
        {m.active && (
          <label className="check small" title={withKey('Show the pins of all masks, or only the selected one', 'mask.pins')}>
            <input type="checkbox" checked={m.pins} onChange={(e) => m.setPins(e.target.checked)} /> Show all pins
          </label>
        )}
      </section>
      {(m.creating?.kind === 'brush' || comp?.shape.kind === 'brush') && <BrushControls m={m} disabled={disabled} showHint={showHint} dabsLeft={m.dabsLeft()} />}
      {mask && comp && <ShapeControls m={m} mask={mask} comp={comp} disabled={disabled} showHint={showHint} />}
      {mask && comp && comp.shape.kind === 'ai' && (comp.shape as AiShape).what === 'sky' && <SkyControls m={m} mask={mask} comp={comp} disabled={disabled} />}
      {mask && (
        <section className="mask-settings" aria-label={`${mask.name} settings`}>
          <div className="crop-tools">
            <strong className="small">{mask.name}</strong>
            <span className="crop-tools-gap" />
            <button className={`button small ${mask.invert ? 'on' : ''}`} disabled={disabled} onClick={m.invertMask} aria-pressed={mask.invert} title={withKey('Invert the whole mask', 'mask.invert')}>Invert</button>
            <button className="button small" disabled={disabled} onClick={m.duplicate} title="Duplicate this mask">Duplicate</button>
            <button className="button small" disabled={disabled} onClick={() => m.deleteMask()} title="Delete this mask">Delete</button>
          </div>
          <Slider label="Amount" help={MASK_HELP.amount} showHint={showHint} value={mask.amount} min={0} max={200} step={1} defaultValue={100} format={(v) => `${Math.round(v)} %`} disabled={disabled} onChange={(v) => m.setMaskValue('amount', v)} />
          <Slider label="Feather" help={MASK_HELP.feather} showHint={showHint} value={mask.feather} min={0} max={100} step={1} defaultValue={0} format={(v) => `${Math.round(v)}`} disabled={disabled} onChange={(v) => m.setMaskValue('feather', v)} />
          <Slider label="Refine" help={MASK_HELP.refine} showHint={showHint} value={mask.refine} min={0} max={100} step={1} defaultValue={0} format={(v) => `${Math.round(v)}`} disabled={disabled} onChange={(v) => m.setMaskValue('refine', v)} />
          {LOCAL_GROUPS.map((g) => (
            <div key={g.title} className="mask-local-group">
              <h3>{g.title}</h3>
              {g.keys.map((k) => (
                <Slider
                  key={k}
                  label={LOCAL_LABELS[k]}
                  help={localHelp(k)}
                  showHint={showHint}
                  value={mask.adjust[k] ?? 0}
                  min={LOCAL_RANGE[k][0]}
                  max={LOCAL_RANGE[k][1]}
                  step={k === 'exposure' ? 0.01 : 1}
                  defaultValue={0}
                  format={(v) => (k === 'exposure' ? `${v > 0 ? '+' : ''}${v.toFixed(2)} EV` : `${v > 0 ? '+' : ''}${Math.round(v)}`)}
                  disabled={disabled}
                  onChange={(v) => m.setAdjust(k, k === 'exposure' ? Math.round(v * 100) / 100 : Math.round(v))}
                />
              ))}
            </div>
          ))}
          <div className="mask-values-tools" role="group" aria-label={`${mask.name} sliders`}>
            <button className="linklike" disabled={disabled || !LOCAL_KEYS.some((k) => mask.adjust[k])} onClick={m.resetAdjust} title={`Set all of ${mask.name}’s sliders back to 0`}>Reset mask sliders</button>
            <button className="linklike" disabled={disabled} onClick={m.copySettings} title={withKey(`Copy ${mask.name}’s sliders and Amount (${describeMaskValues(maskValues(mask))}), to paste onto any mask, on this photo or another`, 'develop.maskCopySettings')}>
              Copy mask settings
            </button>
            <button
              className="linklike"
              disabled={disabled || !clip}
              onClick={() => m.applyValues('Paste mask settings', clip?.values)}
              title={withKey(clip ? `Set ${mask.name}’s sliders and Amount to those copied from ${clip.from} (${describeMaskValues(clip.values)}). Its shape and parts stay as they are.` : 'Copy a mask’s settings first, then paste them onto this mask', 'develop.maskPasteSettings')}
            >
              Paste mask settings
            </button>
            <MaskPresetsMenu maskName={mask.name} values={maskValues(mask)} disabled={disabled} onApply={(p) => m.applyValues(`Mask preset: ${p.name}`, p.values)} />
          </div>
        </section>
      )}
    </div>
  )
}

function ComponentRow({ c, first, selected, m, disabled }: { c: MaskComponent; first: boolean; selected: boolean; m: Masking; disabled: boolean }) {
  const label = c.shape.kind === 'ai' ? `${partLabel(c.shape as AiShape)} (AI)${(c.shape as AiShape).raster ? '' : ', waiting'}` : partLabel(c.shape)
  return (
    <li className={`mask-part ${selected ? 'selected' : ''}`}>
      {first ? (
        <span className="mask-op" title="The first part: the others combine with it">●</span>
      ) : (
        <select className="mask-op" aria-label={`How ${label} combines`} value={c.op} disabled={disabled} onChange={(e) => m.setComponent(c.id, { op: e.target.value as MaskOp })}>
          {(['add', 'subtract', 'intersect'] as MaskOp[]).map((op) => <option key={op} value={op}>{OP_SIGN[op]} {OP_NAME[op]}</option>)}
        </select>
      )}
      <button className="mask-part-name touch" onClick={() => m.select(m.sel.mask, c.id)} aria-pressed={selected}>{label}{c.invert ? ' (inverted)' : ''}</button>
      <button className={`button small ${c.invert ? 'on' : ''}`} disabled={disabled} onClick={() => m.setComponent(c.id, { invert: !c.invert })} aria-pressed={c.invert} title="Invert this part">Invert</button>
    </li>
  )
}

function BrushControls({ m, disabled, showHint, dabsLeft }: { m: Masking; disabled: boolean; showHint: boolean; dabsLeft: number }) {
  const b = m.brush
  return (
    <section className="mask-brush-controls" aria-label="Brush">
      <div className="upright-modes" role="group" aria-label="Brush mode">
        <button className={`button small touch ${!b.erase ? 'on' : ''}`} aria-pressed={!b.erase} onClick={() => m.setBrush({ ...b, erase: false })} disabled={disabled}>Paint</button>
        <button className={`button small touch ${b.erase ? 'on' : ''}`} aria-pressed={b.erase} onClick={() => m.setBrush({ ...b, erase: true })} disabled={disabled} title={withKey('Erase from the mask (Alt-drag erases while held)', 'mask.erase')}>Erase</button>
      </div>
      <Slider label="Size" help={MASK_HELP.brushSize} showHint={showHint} value={b.size} min={MASK_BRUSH_SIZE[0]} max={MASK_BRUSH_SIZE[1]} step={1} defaultValue={DEFAULT_MASK_BRUSH.size} format={(v) => `${Math.round(v)} px`} disabled={disabled} onChange={(v) => m.setBrush({ ...b, size: Math.round(v) })} />
      <Slider label="Feather" help={MASK_HELP.brushFeather} showHint={showHint} value={b.feather} min={0} max={100} step={1} defaultValue={DEFAULT_MASK_BRUSH.feather} format={(v) => `${Math.round(v)} %`} disabled={disabled} onChange={(v) => m.setBrush({ ...b, feather: Math.round(v) })} />
      <Slider label="Flow" help={MASK_HELP.brushFlow} showHint={showHint} value={b.flow} min={1} max={100} step={1} defaultValue={DEFAULT_MASK_BRUSH.flow} format={(v) => `${Math.round(v)} %`} disabled={disabled} onChange={(v) => m.setBrush({ ...b, flow: Math.round(v) })} />
      <Slider label="Density" help={MASK_HELP.brushDensity} showHint={showHint} value={b.density} min={1} max={100} step={1} defaultValue={DEFAULT_MASK_BRUSH.density} format={(v) => `${Math.round(v)} %`} disabled={disabled} onChange={(v) => m.setBrush({ ...b, density: Math.round(v) })} />
      <label className="small mask-pressure">
        Pen pressure{' '}
        <select value={b.pressure} onChange={(e) => m.setBrush({ ...b, pressure: e.target.value as typeof b.pressure })} disabled={disabled} aria-label="Pen pressure changes">
          <option value="off">Off</option>
          <option value="size">Changes the size</option>
          <option value="flow">Changes the flow</option>
        </select>
      </label>
      {dabsLeft < MAX_DABS && <p className="muted small">{dabsLeft.toLocaleString('en')} of {MAX_DABS.toLocaleString('en')} brush dabs left in this mask.</p>}
    </section>
  )
}

function ShapeControls({ m, mask, comp, disabled, showHint }: { m: Masking; mask: LocalMask; comp: MaskComponent; disabled: boolean; showHint: boolean }) {
  const s = comp.shape
  if (s.kind === 'radial') {
    const r = s as RadialShape
    return (
      <section aria-label="Radial gradient">
        <Slider label="Feather" help={MASK_HELP.radialFeather} showHint={showHint} value={r.feather} min={0} max={100} step={1} defaultValue={50} format={(v) => `${Math.round(v)}`} disabled={disabled} onChange={(v) => m.changeShape(comp.id, { ...r, feather: Math.round(v) }, `${mask.name}: radial feather`)} />
      </section>
    )
  }
  if (s.kind === 'luminance') {
    const l = s as LuminanceShape
    const [a, b, c, d] = l.range
    const smooth = Math.round(Math.max(b - a, d - c))
    const set = (lo: number, hi: number, sm: number) => {
      const x = Math.min(lo, hi)
      const y = Math.max(lo, hi)
      m.changeShape(comp.id, { kind: 'luminance', range: [Math.max(0, x - sm), x, y, Math.min(100, y + sm)] }, `${mask.name}: luminance range`)
    }
    return (
      <section aria-label="Luminance range">
        <Slider label="Range: dark end" help={MASK_HELP.lumLow} showHint={showHint} value={b} min={0} max={100} step={1} defaultValue={60} format={(v) => `L* ${Math.round(v)}`} disabled={disabled} onChange={(v) => set(Math.round(v), c, smooth)} />
        <Slider label="Range: bright end" help={MASK_HELP.lumHigh} showHint={showHint} value={c} min={0} max={100} step={1} defaultValue={100} format={(v) => `L* ${Math.round(v)}`} disabled={disabled} onChange={(v) => set(b, Math.round(v), smooth)} />
        <Slider label="Smoothness" help={MASK_HELP.lumSmooth} showHint={showHint} value={smooth} min={0} max={50} step={1} defaultValue={20} format={(v) => `${Math.round(v)}`} disabled={disabled} onChange={(v) => set(b, c, Math.round(v))} />
        <button className={`button small touch ${m.picking === 'luminance' ? 'on' : ''}`} disabled={disabled} onClick={() => { if (!m.active) m.start(); m.setPicking(m.picking === 'luminance' ? null : 'luminance') }}>Pick a tone…</button>
      </section>
    )
  }
  if (s.kind === 'depth') {
    const l = s as DepthShape
    const [a, b, c, d] = l.range
    const smooth = Math.round(Math.max(b - a, d - c))
    const set = (lo: number, hi: number, sm: number) => {
      const x = Math.min(lo, hi)
      const y = Math.max(lo, hi)
      m.changeShape(comp.id, { ...l, range: [Math.max(0, x - sm), x, y, Math.min(100, y + sm)] }, `${mask.name}: depth range`)
    }
    return (
      <section aria-label="Depth range">
        {!l.raster && <p className="small masks-warn">No depth map for this photo yet: this part isn’t shown.</p>}
        <Slider label="Depth: near end" help={MASK_HELP.depthNear} showHint={showHint} value={b} min={0} max={100} step={1} defaultValue={0} format={(v) => `${Math.round(v)}`} disabled={disabled} onChange={(v) => set(Math.round(v), c, smooth)} />
        <Slider label="Depth: far end" help={MASK_HELP.depthFar} showHint={showHint} value={c} min={0} max={100} step={1} defaultValue={30} format={(v) => `${Math.round(v)}`} disabled={disabled} onChange={(v) => set(b, Math.round(v), smooth)} />
        <Slider label="Depth feather" help={MASK_HELP.depthFeather} showHint={showHint} value={smooth} min={0} max={50} step={1} defaultValue={20} format={(v) => `${Math.round(v)}`} disabled={disabled} onChange={(v) => set(b, c, Math.round(v))} />
        <div className="crop-tools">
          <button className={`button small touch ${m.picking === 'depth' ? 'on' : ''}`} disabled={disabled || !l.raster} onClick={() => { if (!m.active) m.start(); m.setPicking(m.picking === 'depth' ? null : 'depth') }}>Pick a distance…</button>
          <label className="check small" title={MASK_HELP.depthView.what}>
            <input type="checkbox" checked={m.depthView} disabled={disabled || !l.raster} onChange={(e) => { if (!m.active) m.start(); m.setDepthView(e.target.checked) }} /> Show depth map
          </label>
        </div>
        <p className="muted small">0 is the nearest part of this photo, 100 the farthest (relative depth from the AI model, not distances). Model: {l.model}{l.modelVersion ? ` ${l.modelVersion}` : ''}.</p>
      </section>
    )
  }
  if (s.kind === 'colour') {
    const c = s as ColourShape
    return (
      <section aria-label="Colour range">
        <p className="small">{c.samples.length} {c.samples.length === 1 ? 'sample' : 'samples'} (up to 5)</p>
        <Slider label="Refine" help={MASK_HELP.colourRefine} showHint={showHint} value={c.refine} min={0} max={100} step={1} defaultValue={50} format={(v) => `${Math.round(v)}`} disabled={disabled} onChange={(v) => m.changeShape(comp.id, { ...c, refine: Math.round(v) }, `${mask.name}: colour refine`)} />
        <button className={`button small touch ${m.picking === 'colour' ? 'on' : ''}`} disabled={disabled} onClick={() => { if (!m.active) m.start(); m.setPicking(m.picking === 'colour' ? null : 'colour') }}>Pick colours…</button>
      </section>
    )
  }
  if (s.kind === 'brush') {
    const n = (s as BrushShape).strokes.length
    return <p className="muted small">{n} {n === 1 ? 'stroke' : 'strokes'}. Paint to add, Alt-drag or Erase to take away.</p>
  }
  if (s.kind === 'ai' && (s as AiShape).what === 'sky') return null
  if (s.kind === 'ai' && isPeoplePart((s as AiShape).what)) {
    const a = s as AiShape
    return (
      <section aria-label={`${partLabel(a)} selection`}>
        {!a.raster && <p className="small masks-warn">This selection isn’t made for this photo yet: it isn’t shown.</p>}
        <p className="muted small">
          {partLabel(a)}{a.prompt?.all ? `: everyone found (${a.prompt.boxes?.length ?? 0} ${a.prompt.boxes?.length === 1 ? 'person' : 'people'} when it was made)` : ''}. Made on this computer by {a.model}{a.modelVersion ? ` ${a.modelVersion}` : ''}{a.models && a.models.length > 1 ? `, with ${a.models.filter((x) => !x.startsWith(`${a.model} `)).map((x) => x.split(' ')[0]).join(', ')}` : ''}.
        </p>
        <div className="crop-tools">
          <button className="button small touch" disabled={disabled || m.objectBusy || !a.prompt} onClick={() => void m.recomputeAi(comp.id)} title={MASK_HELP.peopleRecompute.what}>Compute again</button>
        </div>
      </section>
    )
  }
  if (s.kind === 'ai') {
    const a = s as AiShape
    const pts = a.prompt?.points ?? []
    const add = pts.filter((x) => x[2] === 1).length
    const remove = pts.length - add
    return (
      <section aria-label={`${partLabel(a)} selection`}>
        {!a.raster && <p className="small masks-warn">This selection isn’t made for this photo yet: it isn’t shown.</p>}
        <p className="muted small">
          {a.prompt?.box ? 'Selected inside a box' : `Selected at ${add} ${add === 1 ? 'point' : 'points'}`}{remove ? `, ${remove} removed` : ''}. Made on this computer by {a.model}{a.modelVersion ? ` ${a.modelVersion}` : ''}.
        </p>
        {a.what === 'object' && (
          <div className="crop-tools">
            <button className={`button small touch ${m.objectMode === 'refine' ? 'on' : ''}`} disabled={disabled || m.objectBusy} aria-pressed={m.objectMode === 'refine'} onClick={() => { if (!m.active) m.start(); m.setPicking(m.objectMode === 'refine' ? null : 'object') }} title={MASK_HELP.objectPick.what}>Refine on photo…</button>
            <button className="button small touch" disabled={disabled || m.objectBusy || !a.prompt} onClick={() => void m.recomputeAi(comp.id)} title={MASK_HELP.objectRecompute.what}>Compute again</button>
          </div>
        )}
      </section>
    )
  }
  return null
}

/** The people found on the photo: a row per person and one for everyone, a tick per part (Part 28). */
function PeopleList({ people, m, disabled }: { people: People; m: Masking; disabled: boolean }) {
  const f = people.found!
  const [ticks, setTicks] = useState<ReadonlySet<string>>(() => new Set())
  const key = (who: number | 'all', what: PeoplePart) => `${who}/${what}`
  const toggle = (k: string) => setTicks((t) => {
    const n = new Set(t)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })
  const rows: { who: number | 'all'; label: string; title: string }[] = [
    { who: 'all', label: 'All people', title: MASK_HELP.peopleAll.what },
    ...f.people.map((p) => ({ who: p.index, label: `Person ${p.index}`, title: `${MASK_HELP.peopleOne.what}${p.face ? '' : ' No face was found for this person.'}` })),
  ]
  const picks: PeoplePick[] = rows.flatMap((r) => PEOPLE_PARTS.filter((w) => ticks.has(key(r.who, w))).map((what) => ({ who: r.who, what })))
  const found = f.people.length
  return (
    <div className="people-list" role="group" aria-label="People found">
      <p className="small" role="status">
        {found ? `${found} ${found === 1 ? 'person' : 'people'} found${f.faces ? `, ${f.faces} ${f.faces === 1 ? 'face' : 'faces'}` : ''}. Tick what to select.` : 'No people found in this photo.'}
      </p>
      {found > 0 && (
        <table className="people-table small">
          <thead>
            <tr>
              <th scope="col" aria-label="Who" />
              {PEOPLE_PARTS.map((w) => <th key={w} scope="col" title={PEOPLE_PART_HELP[w]}>{w === 'person' ? 'Whole' : AI_WHAT_LABELS[w]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.who)} className={`people-row ${people.hot === r.who ? 'hot' : ''}`} onMouseEnter={() => people.setHot(r.who)} onMouseLeave={() => people.setHot(null)}>
                <th scope="row" title={r.title}>{r.label}</th>
                {PEOPLE_PARTS.map((w) => (
                  <td key={w}>
                    <input
                      type="checkbox"
                      checked={ticks.has(key(r.who, w))}
                      disabled={disabled || m.objectBusy}
                      onChange={() => toggle(key(r.who, w))}
                      onFocus={() => people.setHot(r.who)}
                      aria-label={`${r.label}: ${w === 'person' ? 'whole person' : AI_WHAT_LABELS[w].toLowerCase()}`}
                      title={`${r.label}: ${PEOPLE_PART_HELP[w]}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="crop-tools">
        {found > 0 && (
          <button className="button small primary touch" disabled={disabled || m.objectBusy || !picks.length} onClick={() => void m.makePeople(picks)} title={MASK_HELP.peopleMake.what}>
            {m.objectBusy ? 'Making the mask…' : picks.length ? `Make mask (${picks.length} ${picks.length === 1 ? 'part' : 'parts'})` : 'Make mask'}
          </button>
        )}
        <button className="button small touch" onClick={() => people.close()} title="Close this list without making a mask (Esc)">{found ? 'Cancel' : 'Close'}</button>
      </div>
    </div>
  )
}

/** A Sky part (Part 29): where it came from, finding it again, and "everything except the sky" (the mask's Invert). */
function SkyControls({ m, mask, comp, disabled }: { m: Masking; mask: LocalMask; comp: MaskComponent; disabled: boolean }) {
  const a = comp.shape as AiShape
  return (
    <section aria-label="Sky">
      {!a.raster && <p className="small masks-warn">The sky isn’t found for this photo yet: this part isn’t shown.</p>}
      <p className="muted small">The sky, found on this computer by {a.model}{a.modelVersion ? ` ${a.modelVersion}` : ''}. {mask.components.length === 1 ? ' To change everything except the sky, use the button below or the mask’s Invert.' : ' To leave the sky out instead, click Invert on this part.'}</p>
      <div className="crop-tools">
        <button className="button small touch" disabled={disabled || m.skyBusy} onClick={() => void m.recomputeAi(comp.id)} title={MASK_HELP.skyRecompute.what}>Find the sky again</button>
        {mask.components.length === 1 && (
          <button className={`button small touch ${mask.invert ? 'on' : ''}`} disabled={disabled} aria-pressed={mask.invert} onClick={m.invertMask} title={MASK_HELP.skyInvert.what}>
            Everything except the sky
          </button>
        )}
      </div>
    </section>
  )
}
