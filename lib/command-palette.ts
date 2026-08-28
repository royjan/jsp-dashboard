/**
 * Opening ⌘K from somewhere that is not a keyboard.
 *
 * The palette owns its own `open` state and always has -- it is mounted once in
 * the TopBar and reached by the shortcut or by its own trigger button. Now that
 * /search is gone, three other surfaces need to open it (the sidebar entry, the
 * phone's bottom tab, the "part not found" card), and none of them can hold a
 * ref to a component that renders somewhere else in the tree.
 *
 * A window event rather than context: the palette is a leaf of the layout, the
 * callers are scattered across pages, and a provider wrapping the whole app to
 * pass one boolean would be more wiring than the thing it carries.
 */
export const OPEN_COMMAND_PALETTE = 'jan:open-command-palette'

export function openCommandPalette() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))
}
