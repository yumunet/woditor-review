export function updateCommentScroll(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>('.comments-list');
  if (!list) return;
  const up = root.querySelector<HTMLButtonElement>('[data-action=comment-scroll][data-value="-1"]');
  const down = root.querySelector<HTMLButtonElement>(
    '[data-action=comment-scroll][data-value="1"]',
  );
  if (up) up.hidden = list.scrollTop <= 1;
  if (down) down.hidden = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
}
