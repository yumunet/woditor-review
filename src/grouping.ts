import type { Item, ReviewFile } from './model';

const editable = (item: Item) => item.code === 103 && !item.threads.length && !item.changes.length;
function update(file: ReviewFile) {
  let number = 0;
  for (const item of file.items) if (item.code === 103) item.title = `コメント ${++number}`;
  file.manualGroups = file.items.filter((i) => i.code === 103).map((i) => [...i.slotIds]);
}
export const canSplit = (item: Item) => editable(item) && item.slotIds.length > 1;
export function canMerge(file: ReviewFile, item: Item) {
  const next = file.items[file.items.indexOf(item) + 1];
  return (
    editable(item) &&
    !!next &&
    editable(next) &&
    next.depth === item.depth &&
    file.slots.find((s) => s.id === next.slotIds[0])!.line === item.lastLine + 1
  );
}
export function splitGroup(file: ReviewFile, itemId: string) {
  const index = file.items.findIndex((i) => i.id === itemId),
    item = file.items[index];
  if (!item || !canSplit(item))
    throw new Error('コメント・変更履歴のない連続コメントだけを分割できます');
  const children = item.slotIds.map((id, index) => {
    const slot = file.slots.find((s) => s.id === id)!;
    return {
      ...item,
      id: index === 0 ? item.id : 'R:' + id,
      slotIds: [id],
      lastLine: slot.line,
      approved: false,
      threads: [],
      changes: [],
    };
  });
  file.items.splice(index, 1, ...children);
  update(file);
  return children[0].id;
}
export function mergeGroup(file: ReviewFile, itemId: string) {
  const item = file.items.find((i) => i.id === itemId);
  if (!item || !canMerge(file, item))
    throw new Error('履歴のない隣接したコメント同士だけを結合できます');
  const index = file.items.indexOf(item),
    next = file.items[index + 1];
  item.slotIds.push(...next.slotIds);
  item.lastLine = next.lastLine;
  item.approved = false;
  file.items.splice(index + 1, 1);
  update(file);
  return item.id;
}

// Reapply a user's grouping to freshly parsed source, before moving any state.
export function preserveGroups(file: ReviewFile, old: ReviewFile, idMap: Map<string, string>) {
  if (!old.manualGroups) return;
  const inverse = new Map([...idMap].map(([fresh, prior]) => [prior, fresh]));
  const groups = old.manualGroups.map((ids) => ids.map((id) => inverse.get(id)));
  if (groups.some((ids) => ids.some((id) => !id)))
    throw new Error('手動グループの原文を一意に対応付けできません');
  const byStart = new Map(groups.map((ids) => [ids[0]!, ids as string[]]));
  const assigned = new Set(groups.flat());
  for (const item of file.items.filter((i) => i.code === 103)) {
    let run: string[] = [];
    const flush = () => {
      if (run.length) byStart.set(run[0], run);
      run = [];
    };
    for (const id of item.slotIds) {
      if (assigned.has(id)) flush();
      else run.push(id);
    }
    flush();
  }
  const flat = file.items.flatMap((item) =>
    item.code === 103
      ? item.slotIds.map((id) => ({
          ...item,
          id: 'R:' + id,
          slotIds: [id],
          lastLine: file.slots.find((s) => s.id === id)!.line,
        }))
      : [item],
  );
  const result: Item[] = [];
  for (let index = 0; index < flat.length; index++) {
    const item = flat[index],
      ids = byStart.get(item.slotIds[0]);
    if (!ids) {
      if (assigned.has(item.slotIds[0])) throw new Error('手動グループの並びが変わっています');
      result.push(item);
      continue;
    }
    const segment = flat.slice(index, index + ids.length);
    if (
      segment.length !== ids.length ||
      segment.some(
        (entry, i) =>
          entry.code !== 103 ||
          entry.depth !== item.depth ||
          entry.slotIds[0] !== ids[i] ||
          (i > 0 && entry.lastLine !== segment[i - 1].lastLine + 1),
      )
    )
      throw new Error('手動グループの間に別のコマンドがあります');
    result.push({ ...item, slotIds: ids, lastLine: segment.at(-1)!.lastLine });
    index += ids.length - 1;
  }
  file.items = result;
}
