import type {Change,Item,ReviewFile,Workspace} from './model';
import type {ReviewResponse} from './exchange';
import {now,uid} from './review-state';

export interface Edit {slotId:string;before:string;after:string}

export function applyRevisedFiles(next:Workspace,response:ReviewResponse,revised:ReviewFile[],touched:Set<string>,strict=false) {
  for(const updated of revised) {
    const file=next.files.find(f=>f.path===updated.path);
    if(!file || file.sourceVersion!==updated.sourceVersion) throw new Error('修正TXTの原文バージョンが一致しません');
    const matched=new Set<string>();
    const declared=new Map(response.suggestions.filter(s=>s.path===file.path).flatMap(s=>s.changes.map(edit=>[edit.slotId,edit] as const)));
    for(const slot of updated.slots) {
      const same=(s:ReviewFile['slots'][number])=>s.source===slot.source && s.fingerprint===slot.fingerprint;
      const exact=file.slots.filter(s=>s.id===slot.id && same(s));
      const options=exact.length?exact:file.slots.filter(s=>same(s) && s.key===slot.key && s.kind===slot.kind && (s.kind==='database_csv'||s.line===slot.line));
      if(options.length!==1 || matched.has(options[0].id)) throw new Error('修正TXTの翻訳単位が一致しません');
      const old=options[0];matched.add(old.id);old.enLine=slot.enLine;
      const item=file.items.find(i=>i.slotIds.includes(old.id))!;
      if(strict) {
        if(slot.translation!==(declared.get(old.id)?.after??old.translation)) throw new Error('回答JSONと修正TXTの新訳が一致しません');
        continue;
      }
      const pending=item.changes.filter(c=>c.slotId===old.id && c.status==='pending').at(-1);
      if(pending) {
        if((pending.rejectedBy?old.translation:pending.after)!==slot.translation) throw new Error('回答JSONと修正TXTの新訳が一致しません');
      } else if(old.translation!==slot.translation) {
        const answers=response.responses.filter(a=>a.path===file.path && a.itemId===item.id);
        const threadId=answers.length===1?answers[0].commentId:uid();
        let thread=item.threads.find(t=>t.id===threadId);
        if(!thread) {thread={id:threadId,resolved:false,posts:[{id:uid(),author:'ai',text:'修正TXTに回答JSONで説明されていない変更があります。新訳を確認してください。',createdAt:now(),decision:'needs_review'}]};item.threads.push(thread);}
        propose(file,item,{slotId:old.id,before:old.translation,after:slot.translation},threadId,'ai',thread.posts.at(-1)!.id);
      }
    }
    if(matched.size!==file.slots.length) throw new Error('修正TXTの翻訳単位が不足しています');
    file.enText=updated.enText;file.enBom=updated.enBom;file.version=updated.version;file.commands=updated.commands;
  }
  for(const path of touched) if(!revised.some(file=>file.path===path)) throw new Error(`修正TXTが不足しています: ${path}`);
}

export function propose(file: ReviewFile, item: Item, edit: Edit, threadId: string | null, origin: 'ai' | 'reload', aiPostId?: string) {
  const slot = file.slots.find(s => s.id === edit.slotId);
  if (!slot || !item.slotIds.includes(edit.slotId) || slot.translation !== edit.before) throw new Error(`翻訳単位・変更前の英訳が一致しません: ${edit.slotId}`);
  if((slot.kind!=='database_csv'||/^CSV_D\d+_NAME$/.test(slot.key)) && /[\r\n]/.test(edit.after)) throw new Error('引用符付きCSV設定値以外はエンコードされた改行を使用してください');
  if (edit.before === edit.after) return;
  if (item.changes.some(c => c.slotId === edit.slotId && c.status === 'pending')) throw new Error(`既に保留中の変更があります: ${edit.slotId}`);
  if (slot.kind === 'command_string' && /(?<!\\)"/.test(edit.after)) throw new Error('コマンド内の引用符は <dqrt> を使用してください');
  const change: Change = {id: uid(), ...edit, threadId, origin, aiPostId, status: 'pending', createdAt: now()};
  item.changes.push(change); item.approved = false;
}
