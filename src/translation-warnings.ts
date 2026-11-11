import {sourceText, type Slot,type ReviewFile} from './model';
import {isDatabaseMemo} from './display-text';
// Equivalent to the original Python translator's SPECIAL regex. Ruby is
// translatable; the remaining controls are compared without altering text.
const special = /<<\\n>>|<\\n>|\\r\\n|\\n|\\r(?!\[)|\\(?!r\[)[a-zA-Z][a-zA-Z0-9_]*\[[^\]\r\n]*\]|<<[A-Z][A-Z0-9_]*>>|<DIR>|<(?!dqrt>)[A-Za-z][A-Za-z0-9_:-]*>|%(?:\d+\$)?[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[diuoxXfFeEgGaAcsp]|@\d+/g;
const newlines = new Set([String.raw`<\n>`,String.raw`<<\n>>`,String.raw`\n`,String.raw`\r`,String.raw`\r\n`]);
export const controlWarning='制御文字・置換文字列が原文と異なります';
export const newlineWarning='改行が異なります';
export function translationWarnings(source:string,translation:string):string[] {
  const before=source.match(special)??[],after=translation.match(special)??[];
  if(JSON.stringify(before)===JSON.stringify(after)) return [];
  return [JSON.stringify(before.filter(t=>!newlines.has(t)))===JSON.stringify(after.filter(t=>!newlines.has(t)))?newlineWarning:controlWarning];
}
export function slotWarnings(slot:Slot,file?:Pick<ReviewFile,'type'>):string[] {
  const other=slot.warnings.filter(w=>w!==controlWarning && w!==newlineWarning);
  if(slot.sourceMissing && !sourceText(slot)) return other;
  return [...other,...translationWarnings(sourceText(slot),slot.translation).filter(w=>!isDatabaseMemo(file,slot)||w!==newlineWarning)];
}
