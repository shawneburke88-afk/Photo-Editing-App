// Whether LightBench runs as an installed app window (the manifest's `"display": "standalone"`), where Chromium passes
// keys it keeps for itself in a tab, such as Ctrl+N ("In Apps mode, no keys are reserved": Chromium's
// browser_command_controller.cc, checked by Cowork on 2026-10-13). Asked at each key press, so it is always current.

export function isStandalone(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}
