export function installTooltips() {
  let tooltip: HTMLElement | null = null,
    target: HTMLElement | null = null,
    timer: ReturnType<typeof setTimeout> | undefined,
    suppress: HTMLElement | null = null;
  const hide = () => {
    clearTimeout(timer);
    target?.removeAttribute('aria-describedby');
    tooltip?.remove();
    tooltip = target = null;
  };
  const show = (element: HTMLElement) => {
    hide();
    if (!element.isConnected) return;
    target = element;
    tooltip = document.createElement('div');
    tooltip.id = 'control-tooltip';
    tooltip.role = 'tooltip';
    tooltip.className = 'control-tooltip';
    tooltip.textContent = element.dataset.tooltip!;
    document.body.append(tooltip);
    element.setAttribute('aria-describedby', tooltip.id);
    const anchor = element.getBoundingClientRect(),
      rect = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(6, Math.min(anchor.left + anchor.width / 2 - rect.width / 2, innerWidth - rect.width - 6))}px`;
    tooltip.style.top = `${anchor.top >= rect.height + 8 ? anchor.top - rect.height - 6 : anchor.bottom + 6}px`;
  };
  const control = (event: Event) =>
    (event.target as HTMLElement).closest<HTMLElement>('[data-tooltip]');
  document.addEventListener('pointerover', (event) => {
    const element = control(event);
    if (event.pointerType === 'mouse' && element) show(element);
  });
  document.addEventListener('pointerout', (event) => {
    if (target && !target.contains(event.relatedTarget as Node)) hide();
  });
  document.addEventListener('focusin', (event) => {
    const element = control(event);
    if (element) show(element);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', (event) => {
    hide();
    const element = control(event);
    if (event.pointerType !== 'mouse' && element)
      timer = setTimeout(() => {
        show(element);
        suppress = element;
      }, 500);
  });
  document.addEventListener('pointerup', () => {
    clearTimeout(timer);
    if (tooltip) timer = setTimeout(hide, 2200);
  });
  document.addEventListener('pointercancel', () => {
    suppress = null;
    hide();
  });
  document.addEventListener(
    'click',
    (event) => {
      if (suppress) {
        const element = suppress;
        suppress = null;
        if (element.contains(event.target as Node)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
    },
    true,
  );
  document.addEventListener('contextmenu', (event) => {
    if (control(event)) event.preventDefault();
  });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  return hide;
}
