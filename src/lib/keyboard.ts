const OPEN_LAYER =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"], [role="menu"]';
const CONTROL =
  'button, a[href], [role="combobox"], [role="button"], [role="menuitem"], [role="option"]';
const EDITABLE = "input, textarea, select";

export function shouldIgnoreGlobalKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  const target = e.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable || target.closest(EDITABLE)) return true;
    if (e.key !== "Escape" && target.closest(CONTROL)) return true;
  }
  return document.querySelector(OPEN_LAYER) !== null;
}
