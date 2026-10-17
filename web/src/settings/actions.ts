// Every keyboard action in LightBench, with its plain name, where it works and its keys in each shortcut
// set. The views only say what each action does (`useShortcuts`); which keys run it is decided here and in
// the user's own changes (keymap.ts), so every shortcut can be changed in Settings → Keyboard.
//
// "lightbench" is LightBench's own set (the keys of version 0.1.0, plus a few new ones). "lightroom" uses
// Lightroom Classic's key wherever LightBench differs; where an action has no `lightroom` entry, both sets
// agree. Which Lightroom keys were checked against Adobe's documentation is listed in docs/PHASE2.md, Part 12.

import type { Chord } from './chords'

/** Where an action works. A view uses `global` plus one or more of the others (see `VIEWS`). */
export type Context = 'global' | 'library' | 'cull' | 'cull-one' | 'compare' | 'survey' | 'develop' | 'crop' | 'guided' | 'curve' | 'mixer' | 'remove' | 'mask'

export const CONTEXT_NAMES: Record<Context, string> = {
  global: 'Everywhere',
  library: 'Library',
  cull: 'Culling, Compare and Survey',
  'cull-one': 'Culling (one photo)',
  compare: 'Compare',
  survey: 'Survey',
  develop: 'Develop',
  crop: 'Develop: cropping',
  guided: 'Develop: Guided Upright',
  curve: 'Develop: tone curve target',
  mixer: 'Develop: colour mixer tool',
  remove: 'Develop: Remove brush',
  mask: 'Develop: masking',
}

/** The contexts that are active together. Two actions can't share a key if one view has both. */
export const VIEWS: Context[][] = [
  ['global', 'library'],
  ['global', 'cull', 'cull-one'],
  ['global', 'cull', 'compare'],
  ['global', 'cull', 'survey'],
  ['global', 'develop'],
  // While cropping, Develop listens to 'crop' instead, so O can cycle the crop overlay and Esc cancel the crop.
  ['global', 'crop'],
  // While drawing Guided Upright lines, Develop listens to 'guided' instead (Delete removes a line, Esc finishes).
  ['global', 'guided'],
  // While the Tone Curve's targeted adjustment tool is on, Develop listens to 'curve' instead (↑ ↓ nudge the tones
  // under the pointer, Esc ends the tool), like the other on-photo tools.
  ['global', 'curve'],
  // The same for the Colour Mixer's targeted adjustment tool and Point Color's picker (↑ ↓ nudge, Esc ends).
  ['global', 'mixer'],
  // While the Remove brush is on the photo, Develop listens to 'remove' instead ([ and ] change the brush size).
  ['global', 'remove'],
  // While masking on the photo (docs/PHASE3.md Part 23), Develop listens to 'mask' instead (O shows the overlay, [ and ]
  // change the brush size, H the pins, Esc deselects), as Lightroom's keys do in its masking tool.
  ['global', 'mask'],
]

export type PresetId = 'lightbench' | 'lightroom'
export const PRESET_NAMES: Record<PresetId, string> = { lightbench: 'LightBench', lightroom: 'Lightroom Classic' }

export interface ActionDef {
  id: string
  /** Plain name, as shown in Settings, the shortcut list and command search. */
  label: string
  contexts: Context[]
  /** Keys in the LightBench set. */
  keys: Chord[]
  /** Keys in the Lightroom Classic set, when they differ. */
  lightroom?: Chord[]
  /**
   * Only when LightBench runs as an installed app window (`display-mode: standalone`), where the browser passes keys it
   * keeps for itself in a tab (Ctrl+N). In a tab its keys do what the browser does.
   */
  standalone?: true
}

const PHOTO: Context[] = ['library', 'cull']
const SETTINGS: Context[] = ['library', 'develop']
const ONE_OR_COMPARE: Context[] = ['cull-one', 'compare']
/** Develop, also while cropping. */
const DEVELOP_ANY: Context[] = ['develop', 'crop']
/** Develop, also with an on-photo tool open (not while cropping or drawing Guided Upright lines). */
const SNAPSHOT_CONTEXTS: Context[] = ['develop', 'curve', 'mixer', 'remove', 'mask']

export const ACTIONS: ActionDef[] = [
  // Everywhere
  { id: 'app.settings', label: 'Settings', contexts: ['global'], keys: ['Ctrl+,'] },
  { id: 'app.commands', label: 'Find an action by name', contexts: ['global'], keys: ['Ctrl+Shift+P'] },
  { id: 'app.shortcuts', label: 'Show keyboard shortcuts', contexts: ['global'], keys: ['?', 'Ctrl+/'] },
  { id: 'app.scaleUp', label: 'Larger interface', contexts: ['global'], keys: ['Ctrl+Alt+=', 'Ctrl+Alt++'] },
  { id: 'app.scaleDown', label: 'Smaller interface', contexts: ['global'], keys: ['Ctrl+Alt+-'] },

  // Flags, stars and labels: the selected photos in the Library, the photo on screen when culling
  { id: 'photo.pick', label: 'Pick', contexts: PHOTO, keys: ['P'] },
  { id: 'photo.reject', label: 'Reject', contexts: PHOTO, keys: ['X'] },
  { id: 'photo.unflag', label: 'Remove flag', contexts: PHOTO, keys: ['U'] },
  { id: 'photo.rate0', label: 'No stars', contexts: PHOTO, keys: ['0'] },
  { id: 'photo.rate1', label: '1 star', contexts: PHOTO, keys: ['1'] },
  { id: 'photo.rate2', label: '2 stars', contexts: PHOTO, keys: ['2'] },
  { id: 'photo.rate3', label: '3 stars', contexts: PHOTO, keys: ['3'] },
  { id: 'photo.rate4', label: '4 stars', contexts: PHOTO, keys: ['4'] },
  { id: 'photo.rate5', label: '5 stars', contexts: PHOTO, keys: ['5'] },
  // Lightroom Classic: ] / [ raise or lower the rating by one star, Shift+1–5 rate and go to the next photo (Adobe's
  // shortcut page, seen through search excerpts; docs/PHASE3.md Part 6). Lightroom gives [ and ] to the brush size
  // while a brush tool is active: the Remove brush's own context ('remove', Part 11), where these photo actions don't
  // run, takes [ and ] without a clash.
  { id: 'photo.rateUp', label: 'One star more', contexts: PHOTO, keys: [']'] },
  { id: 'photo.rateDown', label: 'One star less', contexts: PHOTO, keys: ['['] },
  { id: 'photo.rateNext0', label: 'No stars, then the next photo', contexts: PHOTO, keys: ['Shift+0'] },
  { id: 'photo.rateNext1', label: '1 star, then the next photo', contexts: PHOTO, keys: ['Shift+1'] },
  { id: 'photo.rateNext2', label: '2 stars, then the next photo', contexts: PHOTO, keys: ['Shift+2'] },
  { id: 'photo.rateNext3', label: '3 stars, then the next photo', contexts: PHOTO, keys: ['Shift+3'] },
  { id: 'photo.rateNext4', label: '4 stars, then the next photo', contexts: PHOTO, keys: ['Shift+4'] },
  { id: 'photo.rateNext5', label: '5 stars, then the next photo', contexts: PHOTO, keys: ['Shift+5'] },
  { id: 'photo.label1', label: 'Red label', contexts: PHOTO, keys: ['6'] },
  { id: 'photo.label2', label: 'Yellow label', contexts: PHOTO, keys: ['7'] },
  { id: 'photo.label3', label: 'Green label', contexts: PHOTO, keys: ['8'] },
  { id: 'photo.label4', label: 'Blue label', contexts: PHOTO, keys: ['9'] },
  { id: 'photo.quick', label: 'Add to or remove from the Quick Collection', contexts: PHOTO, keys: ['B'] },
  { id: 'photo.develop', label: 'Open in Develop', contexts: PHOTO, keys: ['D'] },

  // Develop settings, in the Library and in Develop
  { id: 'settings.copy', label: 'Copy develop settings…', contexts: SETTINGS, keys: ['Ctrl+C', 'Ctrl+Shift+C'], lightroom: ['Ctrl+Shift+C'] },
  { id: 'settings.paste', label: 'Paste develop settings…', contexts: SETTINGS, keys: ['Ctrl+V', 'Ctrl+Shift+V'], lightroom: ['Ctrl+Shift+V'] },
  { id: 'settings.sync', label: 'Sync settings to the selected photos…', contexts: SETTINGS, keys: ['Ctrl+Shift+S'] },
  { id: 'export', label: 'Export…', contexts: SETTINGS, keys: ['Ctrl+Shift+E'] },

  // Library
  { id: 'library.next', label: 'Next photo', contexts: ['library'], keys: ['ArrowRight'] },
  { id: 'library.prev', label: 'Previous photo', contexts: ['library'], keys: ['ArrowLeft'] },
  { id: 'library.down', label: 'Photo below', contexts: ['library'], keys: ['ArrowDown'] },
  { id: 'library.up', label: 'Photo above', contexts: ['library'], keys: ['ArrowUp'] },
  { id: 'library.first', label: 'First photo', contexts: ['library'], keys: ['Home'] },
  { id: 'library.last', label: 'Last photo', contexts: ['library'], keys: ['End'] },
  { id: 'library.selectAll', label: 'Select all', contexts: ['library'], keys: ['Ctrl+A'] },
  { id: 'library.grid', label: 'Grid', contexts: ['library'], keys: ['G', 'Escape'] },
  { id: 'library.loupe', label: 'Loupe (one large photo)', contexts: ['library'], keys: ['E', 'Enter'] },
  { id: 'library.cull', label: 'Cull: full-screen culling', contexts: ['library'], keys: ['F'] },
  { id: 'library.compare', label: 'Compare', contexts: ['library'], keys: ['C'] },
  { id: 'library.survey', label: 'Survey the selected photos', contexts: ['library'], keys: ['N'] },
  { id: 'library.remove', label: 'Remove from the library (in a collection: from the collection)', contexts: ['library'], keys: ['Delete', 'Backspace'] },
  { id: 'library.stackToggle', label: 'Expand or collapse a stack', contexts: ['library'], keys: ['S'] },
  { id: 'library.stackTop', label: 'Move to the top of its stack', contexts: ['library'], keys: ['Shift+S'] },
  { id: 'library.stack', label: 'Stack the selected photos', contexts: ['library'], keys: ['Ctrl+G'] },
  { id: 'library.unstack', label: 'Unstack', contexts: ['library'], keys: ['Ctrl+Shift+G'] },
  { id: 'library.virtualCopy', label: 'Make a virtual copy', contexts: ['library'], keys: ["Ctrl+'"] },
  { id: 'library.keywords', label: 'Add keywords', contexts: ['library'], keys: ['Ctrl+K'] },
  { id: 'library.openFolder', label: 'Open folder…', contexts: ['library'], keys: ['Ctrl+O'] },
  { id: 'library.import', label: 'Import from card…', contexts: ['library'], keys: [], lightroom: ['Ctrl+Shift+I'] },
  // Culling helpers (docs/PHASE3.md Part 18). Ctrl+Z undoes only an Apply of suggested rejects (the Library has no other
  // undo); Develop's own Ctrl+Z is in its contexts.
  { id: 'library.suggestRejects', label: 'Suggest rejects… (soft, shake: you choose and Apply)', contexts: ['library'], keys: [] },
  { id: 'library.selectBest', label: 'Select the best of each stack', contexts: ['library'], keys: [] },
  { id: 'library.undoSuggested', label: 'Undo applying suggested rejects', contexts: ['library'], keys: ['Ctrl+Z'] },

  // Culling, Compare and Survey
  { id: 'cull.info', label: 'Show or hide the info line', contexts: ['cull'], keys: ['I'] },
  { id: 'cull.compare', label: 'Switch between one photo and Compare', contexts: ['cull-one', 'compare', 'survey'], keys: ['C'] },
  { id: 'cull.zoom', label: 'Zoom to 100 % at the measured focus point, and back', contexts: ONE_OR_COMPARE, keys: ['Z'] },
  { id: 'cull.advance', label: 'Auto-advance on or off', contexts: ONE_OR_COMPARE, keys: ['A'] },
  { id: 'cull.back', label: 'Back (to the survey if it was open, otherwise to the grid)', contexts: ONE_OR_COMPARE, keys: ['Escape'] },
  { id: 'cull.close', label: 'Close: back to the grid', contexts: ONE_OR_COMPARE, keys: ['G', 'E', 'F'] },
  { id: 'cull.survey', label: 'Back to the survey', contexts: ONE_OR_COMPARE, keys: ['N'] },
  { id: 'one.next', label: 'Next photo', contexts: ['cull-one'], keys: ['ArrowRight', 'ArrowDown', 'Space'] },
  { id: 'one.prev', label: 'Previous photo', contexts: ['cull-one'], keys: ['ArrowLeft', 'ArrowUp'] },
  { id: 'one.first', label: 'First photo', contexts: ['cull-one'], keys: ['Home'] },
  { id: 'one.last', label: 'Last photo', contexts: ['cull-one'], keys: ['End'] },
  { id: 'compare.next', label: 'Next Candidate', contexts: ['compare'], keys: ['ArrowRight', 'Space'] },
  { id: 'compare.prev', label: 'Previous Candidate', contexts: ['compare'], keys: ['ArrowLeft'] },
  { id: 'compare.first', label: 'First Candidate', contexts: ['compare'], keys: ['Home'] },
  { id: 'compare.last', label: 'Last Candidate', contexts: ['compare'], keys: ['End'] },
  { id: 'compare.makeSelect', label: 'Make Select (the Candidate wins)', contexts: ['compare'], keys: ['ArrowUp'] },
  { id: 'compare.swap', label: 'Swap Select and Candidate', contexts: ['compare'], keys: ['ArrowDown'] },
  { id: 'compare.switch', label: 'Switch the active photo', contexts: ['compare'], keys: ['Tab'] },
  { id: 'survey.next', label: 'Next tile', contexts: ['survey'], keys: ['ArrowRight', 'Space', 'Tab'] },
  { id: 'survey.prev', label: 'Previous tile', contexts: ['survey'], keys: ['ArrowLeft', 'Shift+Tab'] },
  { id: 'survey.down', label: 'Tile below', contexts: ['survey'], keys: ['ArrowDown'] },
  { id: 'survey.up', label: 'Tile above', contexts: ['survey'], keys: ['ArrowUp'] },
  { id: 'survey.first', label: 'First tile', contexts: ['survey'], keys: ['Home'] },
  { id: 'survey.last', label: 'Last tile', contexts: ['survey'], keys: ['End'] },
  { id: 'survey.one', label: 'Show the active tile alone', contexts: ['survey'], keys: ['Enter'] },
  { id: 'survey.drop', label: 'Drop the active tile from the survey', contexts: ['survey'], keys: ['Delete', 'Backspace'] },
  { id: 'survey.close', label: 'Back to the grid', contexts: ['survey'], keys: ['Escape', 'G', 'N', 'E', 'F'] },

  // Develop
  { id: 'develop.undo', label: 'Undo', contexts: [...DEVELOP_ANY, 'guided', 'curve', 'mixer', 'remove', 'mask'], keys: ['Ctrl+Z'] },
  { id: 'develop.redo', label: 'Redo', contexts: [...DEVELOP_ANY, 'guided', 'curve', 'mixer', 'remove', 'mask'], keys: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'develop.before', label: 'Before / after', contexts: ['develop', 'curve', 'mixer', 'remove', 'mask'], keys: ['\\'] },
  { id: 'develop.clipping', label: 'Show clipping', contexts: ['develop', 'curve', 'mixer'], keys: ['J', 'O'], lightroom: ['J'] },
  { id: 'develop.sensorClipping', label: 'Show sensor clipping', contexts: ['develop'], keys: ['Shift+O'] },
  // Soft proofing (docs/PHASE3.md Part 20): S and Shift+S are Lightroom Classic's keys (Adobe's shortcut table, via the
  // Cowork verification of 2026-10-13). Develop only: the Library's S and Shift+S (stacks) are in another view.
  { id: 'develop.softProof', label: 'Soft proofing on or off', contexts: ['develop'], keys: ['S'] },
  { id: 'develop.proofGamut', label: 'Soft proofing: destination gamut warning', contexts: ['develop'], keys: ['Shift+S'] },
  { id: 'develop.zoom', label: 'Zoom to 100 % and back', contexts: ['develop', 'curve', 'mixer', 'remove', 'mask'], keys: ['Z'] },
  { id: 'develop.next', label: 'Next photo', contexts: ['develop'], keys: ['ArrowRight'] },
  { id: 'develop.prev', label: 'Previous photo', contexts: ['develop'], keys: ['ArrowLeft'] },
  { id: 'develop.whiteBalance', label: 'White balance picker', contexts: ['develop'], keys: ['W'] },
  { id: 'develop.cancel', label: 'Cancel the picker and fit the photo', contexts: ['develop'], keys: ['Escape'] },
  { id: 'develop.grid', label: 'Back to the Library grid', contexts: ['develop'], keys: ['G'] },
  { id: 'develop.crop', label: 'Crop and straighten (again: apply)', contexts: DEVELOP_ANY, keys: ['R'] },
  { id: 'develop.rotateLeft', label: 'Rotate left', contexts: DEVELOP_ANY, keys: ['Ctrl+['] },
  { id: 'develop.rotateRight', label: 'Rotate right', contexts: DEVELOP_ANY, keys: ['Ctrl+]'] },
  { id: 'develop.flipH', label: 'Flip horizontal', contexts: DEVELOP_ANY, keys: [] },
  { id: 'develop.flipV', label: 'Flip vertical', contexts: DEVELOP_ANY, keys: [] },
  { id: 'develop.level', label: 'Straighten: draw a level line', contexts: DEVELOP_ANY, keys: [] },
  { id: 'develop.autoStraighten', label: 'Straighten: Auto (level along the lines found)', contexts: DEVELOP_ANY, keys: [] },
  // Shift+T is LightBench's choice (Lightroom Classic's key for its Guided Upright tool is not checked here).
  { id: 'develop.guided', label: 'Transform: Guided Upright (draw lines on the photo)', contexts: ['develop', 'guided'], keys: ['Shift+T'] },
  { id: 'develop.uprightAuto', label: 'Transform: Upright Auto', contexts: ['develop'], keys: [] },
  { id: 'develop.uprightOff', label: 'Transform: Upright off', contexts: ['develop'], keys: [] },
  { id: 'develop.transformReset', label: 'Transform: reset Upright and the sliders', contexts: ['develop'], keys: [] },

  // Snapshots (docs/PHASE3.md Part 19). Lightroom Classic's key is Ctrl+N (Adobe's shortcut table, checked by Cowork),
  // but in a browser tab Chromium keeps Ctrl+N for a new window. In an installed app window it doesn't ("In Apps mode, no
  // keys are reserved", Chromium's browser_command_controller.cc, checked by Cowork), so Ctrl+N works there too.
  { id: 'develop.snapshot', label: 'New snapshot (save this photo’s settings by name)', contexts: SNAPSHOT_CONTEXTS, keys: ['Ctrl+Alt+N'] },
  { id: 'develop.snapshotApp', label: 'New snapshot (in the installed app window only)', contexts: SNAPSHOT_CONTEXTS, keys: ['Ctrl+N'], standalone: true },

  // The Tone Curve's targeted adjustment tool. Ctrl+Alt+Shift+T is Lightroom Classic's key for it as remembered, not
  // checked against Adobe's page here; LightBench uses the same.
  { id: 'develop.curveTarget', label: 'Tone curve: targeted adjustment (drag on the photo)', contexts: ['develop', 'curve'], keys: ['Ctrl+Alt+Shift+T'] },
  { id: 'develop.curveReset', label: 'Tone curve: reset', contexts: ['develop'], keys: [] },

  // Develop, while the Tone Curve's targeted adjustment tool is on
  { id: 'curve.done', label: 'Finish the targeted adjustment', contexts: ['curve'], keys: ['Escape', 'Enter'] },
  { id: 'curve.up', label: 'Targeted adjustment: brighten the tones under the pointer', contexts: ['curve'], keys: ['ArrowUp'] },
  { id: 'curve.down', label: 'Targeted adjustment: darken the tones under the pointer', contexts: ['curve'], keys: ['ArrowDown'] },
  { id: 'curve.upBig', label: 'Targeted adjustment: brighten more', contexts: ['curve'], keys: ['Shift+ArrowUp'] },
  { id: 'curve.downBig', label: 'Targeted adjustment: darken more', contexts: ['curve'], keys: ['Shift+ArrowDown'] },

  // The Colour Mixer's targeted adjustment tool, per channel, and Point Color's picker. Ctrl+Alt+Shift+H, S and L (and N
  // to end the tool) are Lightroom Classic's keys for its HSL targeted adjustment as remembered, not checked against
  // Adobe's page here; LightBench uses the same.
  { id: 'develop.mixerTargetHue', label: 'Colour mixer: targeted adjustment of Hue (drag on the photo)', contexts: ['develop', 'mixer'], keys: ['Ctrl+Alt+Shift+H'] },
  { id: 'develop.mixerTargetSat', label: 'Colour mixer: targeted adjustment of Saturation', contexts: ['develop', 'mixer'], keys: ['Ctrl+Alt+Shift+S'] },
  { id: 'develop.mixerTargetLum', label: 'Colour mixer: targeted adjustment of Luminance', contexts: ['develop', 'mixer'], keys: ['Ctrl+Alt+Shift+L'] },
  { id: 'develop.mixerTargetOff', label: 'Colour mixer: end the targeted adjustment', contexts: ['mixer'], keys: ['Ctrl+Alt+Shift+N'] },
  { id: 'develop.pointColorPick', label: 'Point Color: pick a colour on the photo', contexts: ['develop', 'mixer'], keys: [] },
  { id: 'develop.mixerReset', label: 'Colour mixer: reset', contexts: ['develop'], keys: [] },

  // Develop, while the Colour Mixer's targeted adjustment tool or Point Color's picker is on
  { id: 'mixer.done', label: 'Finish the colour mixer tool', contexts: ['mixer'], keys: ['Escape', 'Enter'] },
  { id: 'mixer.up', label: 'Colour mixer target: raise the colour under the pointer', contexts: ['mixer'], keys: ['ArrowUp'] },
  { id: 'mixer.down', label: 'Colour mixer target: lower the colour under the pointer', contexts: ['mixer'], keys: ['ArrowDown'] },
  { id: 'mixer.upBig', label: 'Colour mixer target: raise more', contexts: ['mixer'], keys: ['Shift+ArrowUp'] },
  { id: 'mixer.downBig', label: 'Colour mixer target: lower more', contexts: ['mixer'], keys: ['Shift+ArrowDown'] },

  // Develop, while drawing Guided Upright lines
  { id: 'guided.done', label: 'Finish Guided Upright', contexts: ['guided'], keys: ['Enter', 'Escape'] },
  { id: 'guided.delete', label: 'Remove the selected guide', contexts: ['guided'], keys: ['Delete', 'Backspace'] },

  // Remove, Heal and Clone (Lightroom Classic: Q opens Spot Removal, [ / ] change the brush size and Shift+[ / Shift+]
  // its feather, H shows or hides the pins: Adobe's shortcut table, seen through search excerpts, docs/PHASE3.md
  // Part 11). Shift+[ and Shift+] arrive as { and } (keys follow the printed character).
  { id: 'develop.remove', label: 'Remove, Heal and Clone: the brush on the photo (again: done)', contexts: ['develop', 'remove'], keys: ['Q'] },
  { id: 'remove.done', label: 'Finish with the Remove brush', contexts: ['remove'], keys: ['Enter'] },
  { id: 'remove.cancel', label: 'Remove brush: deselect the spot, or finish', contexts: ['remove'], keys: ['Escape'] },
  { id: 'remove.delete', label: 'Delete the selected spot', contexts: ['remove'], keys: ['Delete', 'Backspace'] },
  { id: 'remove.sizeUp', label: 'Larger brush', contexts: ['remove'], keys: [']'] },
  { id: 'remove.sizeDown', label: 'Smaller brush', contexts: ['remove'], keys: ['['] },
  { id: 'remove.featherUp', label: 'Softer brush edge (more feather)', contexts: ['remove'], keys: ['}'] },
  { id: 'remove.featherDown', label: 'Harder brush edge (less feather)', contexts: ['remove'], keys: ['{'] },
  { id: 'remove.showAll', label: 'Show all spots or only the selected one', contexts: ['remove'], keys: ['H'] },
  { id: 'remove.modeRemove', label: 'Spot mode: Remove (fill from the surroundings)', contexts: ['remove'], keys: [] },
  { id: 'remove.modeHeal', label: 'Spot mode: Heal', contexts: ['remove'], keys: [] },
  { id: 'remove.modeClone', label: 'Spot mode: Clone', contexts: ['remove'], keys: [] },
  { id: 'remove.clear', label: 'Delete all spots…', contexts: ['develop', 'remove'], keys: [] },

  // Masks (docs/PHASE3.md Part 23). Shift+W, K, M, Shift+M, Shift+J, Shift+Q, O, Shift+O, Alt+O, H, [ ], Shift+[ / ] and
  // Alt-drag are in Adobe's Lightroom Classic shortcut table (checked by Cowork, docs/research/cowork-2026-10-13b/
  // B_MASKING.md item 1f); N and ' are only on Julieanne Kost's blog (an Adobe evangelist: a secondary source), so they
  // match Lightroom per a secondary source. The same keys in both sets.
  { id: 'develop.masks', label: 'Masking: show the masks on the photo, or finish', contexts: ['develop', 'mask'], keys: ['Shift+W'] },
  { id: 'develop.maskBrush', label: 'New mask: Brush', contexts: ['develop', 'mask'], keys: ['K'] },
  { id: 'develop.maskLinear', label: 'New mask: Linear gradient', contexts: ['develop', 'mask'], keys: ['M'] },
  { id: 'develop.maskRadial', label: 'New mask: Radial gradient', contexts: ['develop', 'mask'], keys: ['Shift+M'] },
  { id: 'develop.maskColour', label: 'New mask: Colour range', contexts: ['develop', 'mask'], keys: ['Shift+J'] },
  { id: 'develop.maskLuminance', label: 'New mask: Luminance range', contexts: ['develop', 'mask'], keys: ['Shift+Q'] },
  { id: 'mask.done', label: 'Finish masking', contexts: ['mask'], keys: ['Enter'] },
  { id: 'mask.cancel', label: 'Masking: stop drawing, deselect, or finish', contexts: ['mask'], keys: ['Escape'] },
  { id: 'mask.overlay', label: 'Show or hide the mask overlay', contexts: ['mask'], keys: ['O'] },
  { id: 'mask.overlayColour', label: 'Next mask overlay colour', contexts: ['mask'], keys: ['Shift+O'] },
  { id: 'mask.overlayMode', label: 'Next mask overlay mode', contexts: ['mask'], keys: ['Alt+O'] },
  { id: 'mask.pins', label: 'Show or hide the mask pins', contexts: ['mask'], keys: ['H'] },
  { id: 'mask.sizeUp', label: 'Mask brush: larger', contexts: ['mask'], keys: [']'] },
  { id: 'mask.sizeDown', label: 'Mask brush: smaller', contexts: ['mask'], keys: ['['] },
  { id: 'mask.featherUp', label: 'Mask brush: softer edge (more feather)', contexts: ['mask'], keys: ['}'] },
  { id: 'mask.featherDown', label: 'Mask brush: harder edge (less feather)', contexts: ['mask'], keys: ['{'] },
  { id: 'mask.erase', label: 'Mask brush: erase on or off (Alt-drag erases while held)', contexts: ['mask'], keys: [] },
  { id: 'mask.invert', label: 'Invert the selected mask (matches Lightroom per a secondary source)', contexts: ['mask'], keys: ["'"] },
  { id: 'mask.newSame', label: 'New mask of the selected kind (matches Lightroom per a secondary source)', contexts: ['mask'], keys: ['N'] },
  { id: 'mask.delete', label: 'Delete the selected part of the mask (or the mask)', contexts: ['mask'], keys: ['Delete', 'Backspace'] },

  // Develop, while cropping
  { id: 'crop.apply', label: 'Apply the crop', contexts: ['crop'], keys: ['Enter'] },
  { id: 'crop.cancel', label: 'Cancel the crop', contexts: ['crop'], keys: ['Escape'] },
  { id: 'crop.overlay', label: 'Next crop overlay (thirds, grid, golden ratio, diagonals)', contexts: ['crop'], keys: ['O'] },
  { id: 'crop.swap', label: 'Swap portrait and landscape', contexts: ['crop'], keys: ['X'] },
  { id: 'crop.lock', label: 'Lock or unlock the aspect', contexts: ['crop'], keys: [] },
  { id: 'crop.reset', label: 'Reset crop, straighten, rotate and flip', contexts: DEVELOP_ANY, keys: [] },
]

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]))

/** Shift+0–5: set the rating, then go to the next photo (for hint lines). */
export const RATE_NEXT = [0, 1, 2, 3, 4, 5].map((n) => `photo.rateNext${n}`)

/** ] / [ on a photo rated `rating`: one star more or less, staying within 0–5. */
export const stepStars = (rating: number, delta: 1 | -1) => Math.min(5, Math.max(0, rating + delta))

/** The keys of an action in a shortcut set. */
export function presetKeys(a: ActionDef, preset: PresetId): Chord[] {
  return preset === 'lightroom' && a.lightroom ? a.lightroom : a.keys
}
