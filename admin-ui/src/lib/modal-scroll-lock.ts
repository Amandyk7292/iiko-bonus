const locks = new Set<symbol>();
let alreadyLocked: boolean[] = [];

export function lockModalScroll() {
  const token = Symbol('modal');
  const roots = [document.documentElement, document.body];
  if (locks.size === 0) {
    alreadyLocked = roots.map((root) => root.classList.contains('modal-open'));
    roots.forEach((root) => root.classList.add('modal-open'));
  }
  locks.add(token);
  return () => {
    if (!locks.delete(token) || locks.size > 0) return;
    roots.forEach((root, index) => {
      if (!alreadyLocked[index]) root.classList.remove('modal-open');
    });
  };
}

export function isTopmostModal(panel: HTMLElement | null) {
  const panels = document.querySelectorAll('.modal-backdrop > .modal-panel');
  return panel !== null && panels[panels.length - 1] === panel;
}
