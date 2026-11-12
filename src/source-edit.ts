import type { Item, ReviewFile } from './model';
export function updateManualSources(file: ReviewFile, item: Item, values: Map<string, string>) {
  const slots = item.slotIds.map((id) => file.slots.find((s) => s.id === id)!);
  for (const [id, text] of values) {
    if (!slots.some((s) => s.id === id && s.sourceMissing) || text.includes('\0'))
      throw new Error('補完できる原文ではありません');
  }
  for (const slot of slots) if (values.has(slot.id)) slot.sourceOverride = values.get(slot.id)!;
  item.approved = false;
}
