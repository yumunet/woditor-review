# Pythonツール

Python 3.10以降、標準ライブラリだけで実行できます。各CLIと `woditor_parser.py` を同じフォルダに置いてください。アプリ用の `review_adapter.py` はCLIには不要です。

| ファイル                      | 役割                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `woditor_parser.py`           | TXT・CSV解析、文字列抽出、対象判定、位置情報、特殊文字列検査、安全な書き換え、選択肢検査 |
| `woditor_translation_tool.py` | 新規翻訳の `extract`・`apply`、確認用の `context`・`usage`、選択肢の検査・削除           |
| `woditor_review_tool.py`      | レビューJSONの `build`・`validate`・`apply`。JSONスキーマを内包                          |
| `review_adapter.py`           | 日英の対応付け、アプリ用の項目・警告・周辺情報への変換                                   |

以下はリポジトリからの実行例です。持ち出した場合はスクリプトのパスを置き換えます。

初回レビューも `woditor_review_tool.py` の `build` → `validate` → `apply` を使えます。`suggestions[].reason` に指摘理由、`changes` に `slotId`・`before`・`after` を指定し、修正済みTXTは別フォルダに出力します。指摘だけなら `changes` は省略できます。既に保留案があるSlotの修正はコメント回答モードで依頼してください。

## 選択肢の検査

```powershell
python python/woditor_translation_tool.py inspect-choices source.txt
python python/woditor_translation_tool.py inspect-choices source.txt --out report.json
```

日英の対訳やレビューJSONは不要です。結果には `diagnostics`（`error`・`warning`・`automatic`）、`unused`（未使用の設定と位置）、`counts` を返します。エラーなしは終了コード0、検査エラーありは2、読込み失敗などは1です。

件数はラベル側の `CHOICE_STR_*_NUM`／`CHOICE_NAME_*_NUM` と、内部値側の `CHOICE_VAL_*_NUM` を別々に検証します。`*` は0始まりの引数・項目番号です。

| 対象               | 種類                             | ラベル              | 内部値       |
| ------------------ | -------------------------------- | ------------------- | ------------ |
| コモン数値引数0～4 | `LOADTYPE*=0` 直接入力           | 0件                 | 0件          |
| コモン数値引数0～4 | `LOADTYPE*=1` DB参照             | 0件または3件        | 3件          |
| コモン数値引数0～4 | `LOADTYPE*=2` 選択肢作成         | 内部値と同数        | ラベルと同数 |
| DB項目             | `ITEM_LOADTYPE_*=0` 直接入力     | 0件                 | 0件          |
| DB項目             | `ITEM_LOADTYPE_*=1` ファイル選択 | 既定フォルダパス1件 | 1件          |
| DB項目             | `ITEM_LOADTYPE_*=2` DB参照       | 0件または3件        | 3件          |
| DB項目             | `ITEM_LOADTYPE_*=3` 選択肢作成   | 内部値と同数        | ラベルと同数 |

DBのフォルダパスは既存どおり `CHOICE_NAME_*_0` に格納し、翻訳対象にはしません。コモンにはファイル選択はありません。

- 直接入力、使用対象外の引数・項目、有効件数を超えた設定は未使用として自動補正に分類します。DB参照は最大3件、DBのファイル選択の内部値は最大1件なので、それを超える末尾の設定と件数も補正できます。未使用設定のラベル・内部値は翻訳対象から外します。読込みだけではTXTを変更しません。
- 使用中の設定の欠落・重複、不正な件数、種類ごとの件数不整合はエラーです。件数キーが省略されていて実際の添字から判断できる場合は警告を出し、その添字を使います。
- アプリの日英比較では内部値やフォルダパスの違いは警告です。英語側の値を保持します。

## 未使用の選択肢を削除

```powershell
python python/woditor_translation_tool.py clean-choices source.txt --out cleaned.txt
```

未使用のラベルと内部値を削除し、直接入力などの未使用グループの件数は0にします。コモンの数値引数0～4で、引数番号が `VALINPUT_NUM` 以上なら `LOADTYPE` も0に戻します。選択肢設定が既に空の場合も入力形式を補正します。検査のみでは自動補正として報告し、TXTは変更しません。

使用中の入力形式と選択肢、文字列引数の `LOADTYPE5`～`LOADTYPE9`、他の設定、CSV、コマンド、表示用テキストには触れません。元の文字コード・BOM・改行を保持し、削除後に再検査します。元ファイルと既存ファイルへの上書きは拒否し、使用中の設定にエラーがある場合も出力しません。

## 新規翻訳

```powershell
python python/woditor_translation_tool.py extract source.txt --out translations.json
python python/woditor_translation_tool.py context source.txt --id L00002:TYPENAME
python python/woditor_translation_tool.py usage common.txt --index 0
python python/woditor_translation_tool.py apply source.txt translations.json --out translated.txt
```

`context` のIDは抽出結果に合わせます。`usage` はコモンのセルフ変数0～99の直接参照を確認します。`extract` と `apply` も共通パーサーの対象判定を使用し、未使用選択肢を含めません。CSVは引用符付き設定値と有効なデータ名を扱い、数値や行列構造を保持します。レビューJSONの受け渡しは [development.md](development.md#補助ツールの受け渡し) を参照してください。
