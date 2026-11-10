import type { Diagnostic, DiagnosticDocument, ReviewFile, Workspace } from './model';
import { escape } from './ui';
const tabs: [Diagnostic['severity'], string][] = [['error', 'エラー'], ['warning', '警告'], ['skip', '対象外']];
export function diagnosticsView(diagnostics: Diagnostic[], active: Diagnostic['severity'],workspace?:Workspace) {
  const selected = diagnostics.map((diagnostic,index)=>({diagnostic,index})).filter(({diagnostic}) => diagnostic.severity === active);
  const label = tabs.find(([key]) => key === active)![1];
  return `<div class="filters" role="tablist" aria-label="読み込み結果の種類">${tabs.map(([key, name]) => `<button class="pill ${active === key ? 'active' : ''}" role="tab" aria-selected="${active === key}" aria-controls="diagnostic-panel" id="diagnostic-tab-${key}" data-action="diagnostic-tab" data-value="${key}">${name} (${diagnostics.filter(d => d.severity === key).length})</button>`).join('')}</div><div class="sheet-body" id="diagnostic-panel" role="tabpanel" aria-labelledby="diagnostic-tab-${active}">${selected.map(({diagnostic:d,index}) => {const target=workspace && diagnosticItem(workspace,d);return `<div class="diagnostic-row"><button class="diagnostic ${d.severity}" data-action="open-diagnostic" data-value="${index}"><strong>${escape(d.path)}</strong>${escape(d.message)}<span class="diagnostic-open">テキストを開く ›</span></button>${target?`<button class="text-act diagnostic-item" data-action="diagnostic-item" data-value="${index}">${target.exact?'':'近くの'}翻訳項目を開く</button>`:''}</div>`;}).join('') || `<div class="empty">${label}はありません</div>`}</div>`;
}
export function diagnosticLocation(file:ReviewFile,message:string):Pick<Diagnostic,'line'|'enLine'> {
  const rawLine=/(?:行\s*|line\s+)(-?\d+)/i.exec(message)?.[1];
  let line=rawLine?Number(rawLine):undefined, enLine:number|undefined;
  let slot;
  if(line && message.includes('自動関連付けできません')) slot=file.slots.find(s=>s.sourceMissing && s.enLine===line);
  else if(line) slot=file.slots.find(s=>s.line===line);
  else if(message.includes('設定キーによる')) slot=file.slots.find(s=>!s.command && s.enLine!==s.line);
  else if(message.includes('コマンド列による')) slot=file.slots.find(s=>s.command && s.line>0 && s.enLine!==s.line);
  else if(message.includes('旧形式')) slot=file.slots.find(s=>s.command?.code===122 && s.command.numbers.length===2);
  if(slot) {line=slot.line>0?slot.line:undefined;enLine=slot.enLine;}
  if(message.includes('無効化された設定')) {
    const setting=file.excluded.find(s=>s.reason==='英語版で無効化された設定');
    if(setting?.line && setting.key) {
      line=setting.line;
      const countKey=setting.key.replace(/_\d+$/,'_NUM');
      const index=file.enText.split(/\r\n|\r|\n/).findIndex(l=>l.startsWith(countKey+'='));
      if(index>=0) enLine=index+1;
    }
  }
  if(message.includes('CSV部分')) {
    line=file.jaText.split(/\r\n|\r|\n/).indexOf('<<--CSV_START-->>')+1;
    enLine=file.enText.split(/\r\n|\r|\n/).indexOf('<<--CSV_START-->>')+1;
  }
  if(message.includes('英語版だけのコメント') || message.includes('英語版だけのコマンド')) {
    const index=file.commands.findIndex(c=>c.line<0 && (!message.includes('コメント') || c.code===103));
    if(index>=0) {enLine=file.commands[index].enLine??undefined;line=[...file.commands.slice(0,index)].reverse().find(c=>c.line>0)?.line;}
  }
  if(line && !enLine) {
    const nearest=file.commands.filter(c=>c.line>0 && c.enLine).sort((a,b)=>Math.abs(a.line-line!)-Math.abs(b.line-line!))[0];
    enLine=nearest?.enLine??undefined;
  }
  return {line:line && line>0?line:undefined,enLine:enLine && enLine>0?enLine:undefined};
}
export function diagnosticDocument(workspace:Workspace,path:string):DiagnosticDocument|undefined {
  const file=workspace.files.find(f=>f.path===path);
  return file?{path,jaText:file.jaText,enText:file.enText}:workspace.diagnosticDocuments?.find(d=>d.path===path);
}
export function diagnosticItem(workspace:Workspace,diagnostic:Diagnostic) {
  if(diagnostic.severity==='skip') return;
  const file=workspace.files.find(f=>f.path===diagnostic.path);if(!file) return;
  const {line,enLine}=diagnostic.message.includes('自動関連付けできません')?diagnosticLocation(file,diagnostic.message):diagnostic;
  if(line===undefined && enLine===undefined) return;
  const score=(slot:ReviewFile['slots'][number])=>line!==undefined && slot.line>0?Math.abs(slot.line-line):enLine!==undefined && slot.enLine!==undefined?Math.abs(slot.enLine-enLine):Infinity;
  const slot=file.slots.reduce<ReviewFile['slots'][number]|undefined>((best,s)=>score(s)<(best?score(best):Infinity)?s:best,undefined);
  const item=slot && file.items.find(i=>i.slotIds.includes(slot.id));
  if(item && slot) return {file,item,exact:score(slot)===0};
}
export function replaceDiagnosticDocuments(current:DiagnosticDocument[]|undefined,incoming:DiagnosticDocument[],paths:string[]):DiagnosticDocument[] {
  const replaced=new Set(paths);
  return [...(current??[]).filter(d=>!replaced.has(d.path)),...incoming];
}
export function withoutReplacedDiagnostics(diagnostics: Diagnostic[], paths: string[]): Diagnostic[] {
  const attempted = new Set(paths);
  return diagnostics.filter(d => !attempted.has(d.path));
}
