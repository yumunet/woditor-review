import {sourceText, type Slot} from './model';

const bare=[String.raw`\\`,String.raw`\!`,String.raw`\.`,String.raw`\^`,String.raw`\>`,String.raw`\<`,String.raw`\E`,String.raw`\N`,String.raw`\A+`,String.raw`\A-`];
export const controlWarning='特殊文字列が原文と異なります';
export function specialStrings(value:string):string[] {
  const ends=new Map<number,number>(),stack:number[]=[],tokens:string[]=[];
  // Pair all brackets once, so nested arguments and malformed input stay linear.
  for(let i=0;i<value.length;i++) {
    if(value[i]==='[') stack.push(i);
    else if(value[i]===']' && stack.length) ends.set(stack.pop()!,i+1);
  }
  const name=/[\p{L}\p{N}_+\-]+/uy;
  for(let i=0;i<value.length;) {
    if(value[i]==='\\') {
      name.lastIndex=i+1;const match=name.exec(value),open=match?i+1+match[0].length:-1,end=ends.get(open);
      if(match && value[open]==='[' && end!==undefined) {
        if(match[0]!=='r') tokens.push(value.slice(i,end));
        i=end;continue;
      }
      const token=bare.find(token=>value.startsWith(token,i));
      if(token) {tokens.push(token);i+=token.length;continue;}
    } else if(value[i]==='<' && ['<L>','<C>','<R>'].some(token=>value.startsWith(token,i))) {
      tokens.push(value.slice(i,i+3));i+=3;continue;
    } else if(value[i]==='@' && /[0-9]/.test(value[i+1]??'')) {
      let end=i+2;while(end<value.length && /[0-9]/.test(value[end])) end++;
      tokens.push(value.slice(i,end));i=end;continue;
    }
    i++;
  }
  return tokens;
}
export function translationWarnings(source:string,translation:string):string[] {
  return JSON.stringify(specialStrings(source))===JSON.stringify(specialStrings(translation))?[]:[controlWarning];
}
export function slotWarnings(slot:Slot):string[] {
  const other=slot.warnings.filter(w=>![controlWarning,'制御文字・置換文字列が原文と異なります','改行が異なります'].includes(w));
  if(slot.sourceMissing && !sourceText(slot)) return other;
  return [...other,...translationWarnings(sourceText(slot),slot.translation)];
}
