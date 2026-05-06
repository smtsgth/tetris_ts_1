# 未実装／改善項目（優先順位付き）

このファイルは現在のリポジトリに対する未実装機能・改善候補を優先度付きで記載したものです。各項目に短い説明、労力見積もり、推奨実装ファイルを付記しています。

## 優先度: 高

- CI表示を「帯（シェーディング）」に変更
  - 説明: 現状は平均・CIを縦線で表示している。視認性を高めるため95% CI を縦帯（半透明のシェード）で表示する。
  - 理由: プロットの直感性向上、CI幅の把握が容易。
  - 見積: 1-2時間
  - 変更箇所: `scripts/plot_timestamps.js`

- Chart.js のローカルフォールバック／確実なロード
  - 説明: CDN 依存があるため、ネットワーク障害時に失敗する。`npm install chart.js` を使ったローカル読み込み or page.addScriptTag のリトライを追加する。
  - 見積: 1-2時間
  - 変更箇所: `scripts/plot_timestamps.js`, `package.json`

- Puppeteer の待機ロジック強化
  - 説明: `plot.html` 上でのチャート初期化完了を確実に待つロジック（Chart.js 読み込み＋描画完了）を堅牢にする。
  - 見積: 1時間
  - 変更箇所: `scripts/plot_timestamps.js`

## 優先度: 中

- ブートストラップ並列化／パフォーマンス改善
  - 説明: `analyze_timestamps_aggregate.js` の bootstrap を並列化（Worker Threads / child processes）して高速化する。
  - 見積: 3-6時間
  - 変更箇所: `scripts/analyze_timestamps_aggregate.js`

- UI: DAS/ARR/softdrop のキャリブレーションと保存
  - 説明: ユーザーがDAS/ARR/softdrop間隔をUIで調整できるようにし、`localStorage` に保存する。
  - 見積: 4-8時間
  - 変更箇所: フロントエンド（`index.html` 相当）、`src/input.ts`

- E2E 自動テスト（Puppeteer）整備
  - 説明: ユーザー操作の自動再生、イベントログの検証、プロット生成ワークフローのテスト。
  - 見積: 4-8時間
  - 変更箇所: `scripts/*.js`, CI 設定（後日追加）

## 優先度: 低

- サウンド（落下/ライン/T-Spin）
  - 見積: 2-4時間
  - 変更箇所: フロントエンド

- タッチ操作 / モバイル最適化
  - 見積: 4-8時間
  - 変更箇所: フロントエンド

- ドキュメント整備（README、実行手順）
  - 見積: 1-2時間
  - 変更箇所: `README.md`

---

実装の順番としては「CI帯表示」「Chart.jsの堅牢化」「Puppeteer待機強化」を最初のイテレーションにすることを推奨します。

実装を進める場合はこのファイルを更新していきます。

## 最近適用した UI 改善 (作業済)

- プレイフィールドの表示を可視行数のみに修正（内部の隠し行は非表示に） — `dist/renderer.js`, `index.html` を修正。 (done)
- ページ背景をやや明るくしてプレイフィールドを強調 — `styles.css` を更新。 (done)
- ゲームオーバー時の表現強化: ゲーム停止、見やすい『GAME OVER』表示、再起動ボタン、`Enter`/`R`での再起動を追加 — `index.html`, `dist/renderer.js`, `dist/main.js`, `dist/input.js`, `styles.css` を更新。 (done)
- 入力側のタイマー（DAS/ARR/softdrop）をゲームオーバー時/リスタート時に確実にクリアする機構を追加 — `dist/input.js` に `reset()` を実装。 (done)

## 本日実装した追加項目

- GAME OVER 表示をプレイフィールド中央に配置し、プレイフィールドを暗くするオーバーレイを追加（`index.html`, `styles.css`, `dist/renderer.js`）。 (done)
- Restart ボタンと `Enter`/`R` による再起動を追加（`dist/renderer.js`, `dist/main.js`）。 (done)
- DAS/ARR/SoftDrop 調整 UI を追加し、`localStorage` に保存・反映する仕組みを実装（`index.html`, `dist/main.js`, `dist/input.js`）。 (done)
- アクセシビリティのための aria-live ライブ領域を追加し、通知を読み上げられるようにした（`index.html`, `dist/renderer.js`）。 (done)

## 次の推奨タスク（優先順）

1. 視覚的改善 — GAME OVER のアニメーション強化、通知のトランジション、HUD の整理（見積: 1-2時間）
2. アクセシビリティ改善 — ラベル/role の追加入力、キーボードフォーカス順序、スクリーンリーダ向けの追加説明（見積: 1-2時間）
3. DAS/ARR UI の保存形式改善（プロファイル化）とプリセット（見積: 1時間）
4. E2E テストで再起動／入力クリアの回帰テストを追加（見積: 2-4時間）

進める項目を指定してください。私の方で次のタスクを選んで実装を進めます。

次の推奨タスク:

- UI: DAS/ARR/softdrop キャリブレーション UI を追加して `localStorage` に保存 (中)。
- アクセシビリティ: スクリーンリーダ向けの ARIA ライブリージョンやラベル改善 (低)。
- 視覚: GAME OVER 表示にリトルアニメーションやハイライトを追加（優先度: 低→中）。

上記のうち、どれから取り組みますか？
