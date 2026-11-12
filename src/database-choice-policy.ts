export function databaseChoiceMode(header: string, field: number): number {
  const value = new RegExp(`^ITEM_LOADTYPE_${field}=([^\\r\\n]*)`, 'm').exec(header)?.[1];
  if (value === undefined || !/^\d+$/.test(value)) return 0;
  const mode = Number(value);
  return mode === 1 || mode === 2 || mode === 3 ? mode : 0;
}

export function databaseChoicesEnabled(header: string, field: number): boolean {
  const count = /^ITEM_NUM=(\d+)\r?$/m.exec(header)?.[1];
  const mode = databaseChoiceMode(header, field);
  return (count === undefined || field < Number(count)) && (mode === 2 || mode === 3);
}

export function commonChoicesEnabled(header: string, argument: number): boolean {
  if (argument < 0 || argument >= 5) return false;
  const count = /^VALINPUT_NUM=(\d+)\r?$/m.exec(header)?.[1];
  const mode = new RegExp(`^LOADTYPE${argument}=([12])\\r?$`, 'm').test(header);
  return (count === undefined || argument < Number(count)) && mode;
}
