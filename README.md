# Tetris TS (TypeScript)

簡易的な TypeScript 製テトリス実装（ブラウザ）。

## 使い方

1. 依存をインストール

```bash
npm install
```

2. ビルドして起動

```bash
npm run build
npm start
```

3. テスト

```bash
npm test
```

`npm start` 実行後、`http-server` がローカルで立ち上がり、ブラウザで `index.html` を開けば動作します。

## ファイル構成（主なもの）

- [docs/design.md](docs/design.md) : 設計仕様書
- [index.html](index.html)
- [src/](src) : TypeScript ソース
  - [src/game.ts](src/game.ts) ゲームコア
  - [src/renderer.ts](src/renderer.ts) 描画
  - [src/tetromino.ts](src/tetromino.ts) 形と袋生成
  - [src/input.ts](src/input.ts) 入力
  - [src/main.ts](src/main.ts) エントリ

## 次の作業案

- 回転の壁キックを SRS 準拠にする
- DAS/ARR や T-Spin 判定の実装
- モバイル操作、サウンド、スコア詳細表示

## データ収集とプロット（自動化ワークフロー）

簡易的に自動収集 → 集約 → プロット生成を行うスクリプトを用意しています。

- **サーバ起動（ビルド含む）**: `npm install` 後に次を実行します。

  ```bash
  npm run start
  ```

- **バッチ収集（30 回の推奨実行）**: サーバが立ち上がった別の端末で次を実行します（引数に回数を指定可）。

  ```bash
  node scripts/batch_record_runs.js 30
  ```

  - スクリプトは `scripts/record_das_timestamps.js` を順次呼び出し、`recordings/` に `timestamps_fast_runNNN.json` / `timestamps_slow_runNNN.json` を保存します。

- **集約（ブートストラップ CI）**: 生成された実行ログを集約します。`BOOTSTRAP_REPS` 環境変数か第1引数で反復回数を指定できます。

  ```bash
  # 例: ブートストラップを 10000 回実行
  node scripts/analyze_timestamps_aggregate.js 10000
  ```

  出力: `recordings/analysis_aggregated.json`

- **プロット生成（PNG）**: 集約結果と生データを使って Chart.js で描画し PNG を出力します。

  ```bash
  node scripts/plot_timestamps.js
  ```

  出力: `recordings/chart-initial.png`, `recordings/chart-arr.png`, `recordings/chart-soft.png` など

- **重要な環境変数（`plot_timestamps.js`）**:
  - `PLOT_WAIT_CHARTSREADY_MS`: `window.chartsReady` の待機タイムアウト（ms）
  - `PLOT_WAIT_CHART_AVAILABLE_MS`: `typeof Chart` の待機タイムアウト（ms）
  - `PLOT_ADD_SCRIPT_TIMEOUT_BASE_MS`: `addScriptTag` のベースタイムアウト（ms）
  - `PLOT_ADD_SCRIPT_ATTEMPT_BACKOFF_MS`: CDN 再試行でのバックオフ（ms）
  - `PLOT_CDN_ATTEMPTS`: CDN 再試行回数
  - `PLOT_WAIT_SELECTOR_MS`: canvas 要素検出のタイムアウト（ms）
  - `PLOT_CANVAS_RETRIES`: canvas の toDataURL チェック再試行回数
  - `PLOT_CANVAS_RETRY_BASE_MS`: canvas 再試行のベース間隔（ms）
  - `PLOT_SAVE_DEBUG`: タイムアウト時にデバッグ用 HTML/スクリーンショットを保存するか（1/0）

詳しくは `scripts/plot_timestamps.js` と `scripts/analyze_timestamps_aggregate.js` を参照してください。

## CI ワークフロー

リポジトリには GitHub Actions ワークフローを追加しています: `.github/workflows/timestamps-ci.yml`。
ワークフローは手動トリガー（workflow_dispatch）または該当ファイル変更時に動作し、ビルド→30-run の自動収集→集約(BOOTSTRAP=10000)→プロット→`recordings/` を成果物としてアップロードします。
