import type { Diagnostic, DiagnosticDocument, ReviewFile, Workspace } from './model';
import { escape, icon } from './ui';
import { metadataHeader } from './metadata-text';
import { databaseChoiceMode } from './database-choice-policy';
export type DiagnosticTab = Diagnostic['severity'] | 'automatic';
const tabs: [DiagnosticTab, string][] = [
  ['error', 'エラー'],
  ['warning', '警告'],
  ['automatic', '自動補正'],
  ['skip', '対象外'],
];
export function diagnosticTabFor(diagnostic: Diagnostic): DiagnosticTab {
  if (diagnostic.severity !== 'warning') return diagnostic.severity;
  return /^(?:原文部分の行数差を自動補正|設定キーによる行ずれ補正|コマンド列による行ずれ補正|旧形式の文字列操作の引数形式の違いを吸収|未使用の選択肢設定を無視しました)/.test(
    diagnostic.message,
  )
    ? 'automatic'
    : 'warning';
}
export function diagnosticsView(
  diagnostics: Diagnostic[],
  active: DiagnosticTab,
  workspace?: Workspace,
) {
  const selected = diagnostics
    .map((diagnostic, index) => ({ diagnostic, index }))
    .filter(({ diagnostic }) => diagnosticTabFor(diagnostic) === active);
  const label = tabs.find(([key]) => key === active)![1];
  return `<div class="filters" role="tablist" aria-label="読み込み結果の種類">${tabs.map(([key, name]) => `<button class="pill ${active === key ? 'active' : ''}" role="tab" aria-selected="${active === key}" aria-controls="diagnostic-panel" id="diagnostic-tab-${key}" data-action="diagnostic-tab" data-value="${key}">${name} (${diagnostics.filter((d) => diagnosticTabFor(d) === key).length})</button>`).join('')}</div><div class="sheet-body" id="diagnostic-panel" role="tabpanel" aria-labelledby="diagnostic-tab-${active}">${
    selected
      .map(({ diagnostic: d, index }) => {
        const target = workspace && diagnosticItem(workspace, d);
        const label = target?.exact ? '翻訳項目を開く' : '近くの翻訳項目を開く';
        return `<div class="diagnostic-row ${target ? 'has-item' : ''}" data-action="open-diagnostic" data-value="${index}"><button class="diagnostic ${d.severity}" data-action="open-diagnostic" data-value="${index}"><strong>${escape(d.path)}</strong>${escape(d.message)}<span class="diagnostic-open">テキストを開く ›</span></button>${target ? `<button class="icon diagnostic-item" data-action="diagnostic-item" data-value="${index}" aria-label="${label}" data-tooltip="${label}">${icon('item-jump')}</button>` : ''}</div>`;
      })
      .join('') || `<div class="empty">${label}はありません</div>`
  }</div>`;
}
export function diagnosticLocation(
  file: ReviewFile,
  message: string,
): Pick<Diagnostic, 'line' | 'enLine'> {
  const rawLine = /(?:行\s*|line\s+)(-?\d+)/i.exec(message)?.[1];
  let line = rawLine ? Number(rawLine) : undefined,
    enLine: number | undefined;
  const choiceLanguage =
    /^(?:(日本語|英語)の(?:選択肢|有効な選択肢|データベース参照|ファイル読み込み)|未使用の選択肢設定を無視しました（(日本語|英語)、行)/.exec(
      message,
    );
  if (rawLine && choiceLanguage) {
    const english = (choiceLanguage[1] ?? choiceLanguage[2]) === '英語',
      actual = Number(rawLine);
    const ja = metadataHeader(file.jaText, file.type).split(/\r\n|\r|\n/),
      en = metadataHeader(file.enText, file.type).split(/\r\n|\r|\n/);
    const key = (english ? en : ja)[actual - 1]?.split('=')[0],
      group = key && /^CHOICE_(?:STR|NAME|VAL)_(\d+)_/.exec(key)?.[1];
    const other = english ? ja : en,
      candidates = [
        key,
        key?.replace(/_\d+$/, '_NUM'),
        group === undefined
          ? undefined
          : file.type === 'common'
            ? `LOADTYPE${group}`
            : `ITEM_LOADTYPE_${group}`,
      ];
    const counterpart = candidates
      .map((candidate) =>
        candidate ? other.findIndex((text) => text.startsWith(candidate + '=')) : -1,
      )
      .find((index) => index >= 0);
    const mapped = counterpart === undefined ? undefined : counterpart + 1;
    return { line: english ? mapped : actual, enLine: english ? actual : mapped };
  }
  let slot;
  if (line && message.includes('自動関連付けできません'))
    slot = file.slots.find((s) => s.sourceMissing && s.enLine === line);
  else if (line) slot = file.slots.find((s) => s.line === line);
  else if (message.includes('設定キーによる'))
    slot = file.slots.find((s) => !s.command && s.enLine !== s.line);
  else if (message.includes('コマンド列による'))
    slot = file.slots.find((s) => s.command && s.line > 0 && s.enLine !== s.line);
  else if (message.includes('旧形式'))
    slot = file.slots.find((s) => s.command?.code === 122 && s.command.numbers.length === 2);
  if (slot) {
    line = slot.line > 0 ? slot.line : undefined;
    enLine = slot.enLine;
  }
  if (
    /英語版で使用対象外になった(?:翻訳項目|設定)|英語版に対応する(?:翻訳項目|設定|コマンド)がありません/.test(
      message,
    )
  ) {
    const label = message.split(/[:：]/, 1)[0];
    const setting = file.excluded.find((s) => s.reason === label);
    if (setting?.line && setting.key) {
      line = setting.line;
      const countKey = setting.key
        .replace(/^(VALINPUT|STRINPUT)_NAME_\d+$/, '$1_NUM')
        .replace(/^ITEMNAME\d+$/, 'ITEM_NUM')
        .replace(/_\d+$/, '_NUM');
      const index = file.enText.split(/\r\n|\r|\n/).findIndex((l) => l.startsWith(countKey + '='));
      if (index >= 0) enLine = index + 1;
    }
  }
  if (message.includes('CSV部分')) {
    line = file.jaText.split(/\r\n|\r|\n/).indexOf('<<--CSV_START-->>') + 1;
    enLine = file.enText.split(/\r\n|\r|\n/).indexOf('<<--CSV_START-->>') + 1;
  }
  if (message.includes('英語版だけのコメント') || message.includes('英語版だけのコマンド')) {
    const index = file.commands.findIndex(
      (c) => c.line < 0 && (!message.includes('コメント') || c.code === 103),
    );
    if (index >= 0) {
      enLine = file.commands[index].enLine ?? undefined;
      line = [...file.commands.slice(0, index)].reverse().find((c) => c.line > 0)?.line;
    }
  }
  if (
    file.type === 'database' &&
    message.includes('ファイル読み込みの既定フォルダパスが日英で異なります')
  ) {
    const ja = metadataHeader(file.jaText, 'database'),
      en = metadataHeader(file.enText, 'database');
    const setting = [
      ...ja.matchAll(/^CHOICE_NAME_(\d+)_(\d+)=([^\r\n]*)/gm),
      ...en.matchAll(/^CHOICE_NAME_(\d+)_(\d+)=([^\r\n]*)/gm),
    ].find((match) => {
      const field = Number(match[1]),
        key = `CHOICE_NAME_${field}_${match[2]}`;
      const value = (text: string) => new RegExp(`^${key}=([^\\r\\n]*)`, 'm').exec(text)?.[1];
      return (
        databaseChoiceMode(ja, field) === 1 &&
        databaseChoiceMode(en, field) === 1 &&
        value(ja) !== value(en)
      );
    });
    if (setting) {
      const key = `CHOICE_NAME_${setting[1]}_${setting[2]}`,
        fallback = `ITEM_LOADTYPE_${setting[1]}`;
      const locate = (text: string) => {
        const lines = text.split(/\r\n|\r|\n/);
        const index = lines.findIndex((line) => line.startsWith(key + '=')),
          backup = lines.findIndex((line) => line.startsWith(fallback + '='));
        return index >= 0 ? index + 1 : backup >= 0 ? backup + 1 : undefined;
      };
      line = locate(ja);
      enLine = locate(en);
    }
  }
  if (line && !enLine) {
    const nearest = file.commands
      .filter((c) => c.line > 0 && c.enLine)
      .sort((a, b) => Math.abs(a.line - line!) - Math.abs(b.line - line!))[0];
    enLine = nearest?.enLine ?? undefined;
  }
  return {
    line: line && line > 0 ? line : undefined,
    enLine: enLine && enLine > 0 ? enLine : undefined,
  };
}
export function diagnosticDocument(
  workspace: Workspace,
  path: string,
): DiagnosticDocument | undefined {
  const file = workspace.files.find((f) => f.path === path);
  return file
    ? { path, jaText: file.jaText, enText: file.enText }
    : workspace.diagnosticDocuments?.find((d) => d.path === path);
}
export function diagnosticItem(workspace: Workspace, diagnostic: Diagnostic) {
  if (diagnostic.severity === 'skip') return;
  const file = workspace.files.find((f) => f.path === diagnostic.path);
  if (!file) return;
  const { line, enLine } = diagnostic.message.includes('自動関連付けできません')
    ? diagnosticLocation(file, diagnostic.message)
    : diagnostic;
  if (line === undefined && enLine === undefined) return;
  const score = (slot: ReviewFile['slots'][number]) =>
    line !== undefined && slot.line > 0
      ? Math.abs(slot.line - line)
      : enLine !== undefined && slot.enLine !== undefined
        ? Math.abs(slot.enLine - enLine)
        : Infinity;
  const slot = file.slots.reduce<ReviewFile['slots'][number] | undefined>(
    (best, s) => (score(s) < (best ? score(best) : Infinity) ? s : best),
    undefined,
  );
  const item = slot && file.items.find((i) => i.slotIds.includes(slot.id));
  if (item && slot) return { file, item, exact: score(slot) === 0 };
}
export function replaceDiagnosticDocuments(
  current: DiagnosticDocument[] | undefined,
  incoming: DiagnosticDocument[],
  paths: string[],
): DiagnosticDocument[] {
  const replaced = new Set(paths);
  return [...(current ?? []).filter((d) => !replaced.has(d.path)), ...incoming];
}
export function withoutReplacedDiagnostics(
  diagnostics: Diagnostic[],
  paths: string[],
): Diagnostic[] {
  const attempted = new Set(paths);
  return diagnostics.filter((d) => !attempted.has(d.path));
}
