// Global shortcuts that work whether or not focus is inside CodeMirror (§8.3).
export interface GlobalActions {
  save(): void;
  present(): void;
  exportPdf(): void;
}

export function handleGlobalShortcut(e: KeyboardEvent, a: GlobalActions): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  switch (e.key.toLowerCase()) {
    case "s":
      e.preventDefault();
      a.save();
      return true;
    case "p":
      e.preventDefault();
      a.present();
      return true;
    case "e":
      e.preventDefault();
      a.exportPdf();
      return true;
  }
  return false;
}
