// Exact strings from implementation-plan §4.6. Do not trim or normalize text.
export const commandColors: [string, string, string][] = [
  ['■デバッグ', '■Debug', '60, 165, 120'], ['▼', '▼', '0, 160, 0'],
  ['■条件分岐', '■Condition', '30, 0, 120'], ['■変数操作', '■Set Variable', '130, 0, 0'],
  ['■文字列操作', '■Set String', '130, 0, 0'], ['■DB操作', '■DB Management', '130, 0, 0'],
  ['■DB書込', '■Write to DB', '130, 0, 0'], ['■DB読込', '■Load DB', '130, 0, 0'],
  ['■キー入力：', '■Key Input: ', '130, 0, 0'], ['■サウンド：', '■Sound: ', '150, 150, 0'],
  ['■ﾋﾟｸﾁｬ', '■Picture', '150, 150, 0'], ['■ピクチャエフェクト', '■Effect Picture', '200, 160, 0'],
  ['■キャラエフェクト', '■Effect Character', '200, 160, 0'], ['■マップエフェクト', '■Effect Map', '200, 160, 0'],
  ['■ループ開始', '■Loop Start', '30, 0, 120'], ['■イベント処理中断', '■Exit Event', '205, 110, 70'],
  ['■イベントの一時消去', '■Erase Event', '205, 110, 70'], ['■パーティ画像：', '■Party Sprites: ', '150, 150, 0'],
  ['■色調変更', '■Adjust Color', '160, 170, 30'], ['■イベントの挿入：', '■Call Event:', '100, 120, 205'],
  ['■イベントの挿入[名]：', '■Call Event [Name]: ', '100, 120, 205'], ['■次イベントの予約：', '■Reserve Next Event: ', '160, 170, 30'],
  ['■データのセーブ：', '■Save Data: ', '160, 80, 165'], ['■データのロード：', '■Load Data: ', '160, 80, 165'],
  ['■データのリプレイ：', '■Replay Data: ', '160, 80, 165'], ['■ｾｰﾌﾞﾃﾞｰﾀの内容読込：', '■Read Save Data: ', '160, 80, 165'],
  ['■ｾｰﾌﾞﾃﾞｰﾀに書き込み：', '■Write to Save Data: ', '160, 80, 165'], ['■ﾏｯﾌﾟﾁｯﾌﾟ', '■Map Tile', '160, 170, 30'],
  ['■ﾁｯﾌﾟｾｯﾄ', '■Switch Tileset', '160, 170, 30'], ['●ラベル', '●Label', '255, 70, 70'],
  ['-◇分岐：', '-◇Condition: ', '100, 100, 100'], ['-◇選択肢', '-◇Case', '100, 100, 100'],
  ['-◇上記以外', '-◇Else', '100, 100, 100'], ['◇ループここまで', '◇Loop End', '100, 100, 100'],
  ['◇分岐終了', '◇End', '100, 100, 100'], ['■チェックポイント■', '■ Checkpoint ■', '255, 70, 70'],
  ['■【特】チェックポイント■', '■ [Special] Checkpoint ■', '255, 10, 185'], ['■マスク機能', '■Mask: ', '200, 160, 0'],
  ['■タイトル画面へ戻る', '■Go to Title', '30, 0, 120'], ['■ゲーム終了', '■Game End', '30, 0, 120'],
  ['■ループ開始へ戻る', '■Go to Loop Start', '30, 0, 120'], ['■回数付きループ', '■Repeat Loop', '30, 0, 120'],
];
const prefixes = commandColors.flatMap(([ja, en, color]) => [[ja, color], [en, color]])
  .sort((a, b) => b[0].length - a[0].length);
export const commandColor = (text: string) => `rgb(${prefixes.find(([prefix]) => text.startsWith(prefix))?.[1] ?? '40, 40, 60'})`;
