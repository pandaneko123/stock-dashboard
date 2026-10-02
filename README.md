# 高値の奪還率ダッシュボード

AI・半導体株と主要指数が、基準期間の高値（例：8月高値）や年初来高値の何%まで戻っているかを一覧にする静的サイトです。

> 現在はダミーデータで動いています。

## ファイル構成

| パス | 役割 |
|---|---|
| `index.html` / `assets/` | サイト本体。奪還率などの計算はブラウザ側で行う |
| `data/universe.json` | 銘柄リストと設定（比較期間など）。ここを編集して銘柄を増減する |
| `data/market.json` | サイトが読み込む株価データ（スクリプトで生成） |
| `scripts/generate-dummy.mjs` | ダミーの株価データを生成する |
| `scripts/serve.mjs` | 手元確認用の簡易サーバー |

## 手元で確認する

```
node scripts/generate-dummy.mjs
node scripts/serve.mjs
```

ブラウザで http://localhost:8080 を開きます。

## データ形式（data/market.json）

```json
{
  "isDummy": true,
  "asOf": "2026-09-30",
  "settings": { "yearStart": "2026-01-01", "refStart": "2026-08-01", "refEnd": "2026-08-31", "refLabel": "8月" },
  "groups": [{ "id": "idx", "label": "主要指数", "kind": "index" }],
  "series": [
    { "symbol": "SPX", "name": "S&P500", "market": "US", "group": "idx", "kind": "index",
      "rows": [["2026-01-02", 5950.1, 5932.4]] }
  ]
}
```

`rows` は `[日付, 日中高値, 終値]`。本物のデータを取得するスクリプトも同じ形式で出力すれば、サイトは変更なしで動きます。

APIキーは `.env`（`.gitignore` 済み）か GitHub の Secrets に置き、リポジトリには含めません。
