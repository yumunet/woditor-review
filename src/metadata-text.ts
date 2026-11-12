import type { ReviewFile } from './model';

export function metadataHeader(text: string, type: ReviewFile['type']): string {
  const boundary =
    type === 'database'
      ? /^<<--CSV_START-->>\r?$/m
      : /^(?:WoditorEvCOMMAND_START|\[COMMAND_TEXT_START\]|\[\d+\]\[)/m;
  const end = text.search(boundary);
  return end < 0 ? text : text.slice(0, end);
}

export function metadataContextText(
  file: ReviewFile,
  key: string,
): { source: string | null; translation: string | null } {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = (text: string) =>
    new RegExp(`^${escaped}=([^\\r\\n]*)`, 'm').exec(metadataHeader(text, file.type))?.[1] ?? null;
  const slot = file.slots.find((slot) => slot.kind === 'metadata' && slot.key === key);
  return {
    source: slot?.sourceOverride ?? value(file.jaText),
    translation: slot?.translation ?? value(file.enText),
  };
}

export function metadataItem(file: ReviewFile, key: string) {
  const slot = file.slots.find((slot) => slot.kind === 'metadata' && slot.key === key);
  return slot && file.items.find((item) => item.slotIds.includes(slot.id));
}
