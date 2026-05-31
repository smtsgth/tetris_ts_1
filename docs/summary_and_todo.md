# 要約と TODO

## 要約

- 目的: `decideWithBudget(budgetMs, options)` を短時間（目標: 250ms）で有用な結果を返すよう最適化
- 主な改善:
  - ワーカープール と `cachedWorkerBlobUrl` によるワーカー生成オーバーヘッド削減
  - `sharedTranspositionCache`（main-thread の Map）でワーカー間共有
  - pre-warm / probe モード導入（`probeRounds=5` をデフォルトで採用）
  - 早期フォールバック `EARLY_FALLBACK_MS`（例: 30ms）を導入
  - Puppeteer によるベンチ自動化と集計スクリプトで実験を反復

## 実験・集計結果（抜粋）

- 実行: pool=[2,4] × early=[30,40,60] × 10 runs（計60ラン）
- meanOfMeans:
  - pool=2, early=30: 51.638 ms
  - pool=2, early=40: 48.728 ms
  - pool=2, early=60: 60.420 ms
  - pool=4, early=30: 55.646 ms
  - pool=4, early=40: 49.404 ms
  - pool=4, early=60: 53.320 ms
- 以前のベスト: `probeRounds=5` 系で meanOfMeans ≈ 49.30 ms（別集計）

## 既に完了した作業

- `decideWithBudget` 実装、ワーカープール、shared transposition キャッシュ、cached worker Blob の導入
- `scripts/run_tuned_250ms_bench.js` に probe モードと `--earlyFallbackMs` を追加
- 自動ベンチ実行、集計ファイルを `bench_results/` に生成

## TODO（優先順）

- [高] `bench_results/` を `.gitignore` に追加し PR #11 から除外（履歴整理）
- [高] PR #11 をレビューして差分を分割（コードの PR と bench_results を分離）
 - [高] `bench_results/` を `.gitignore` に追加し PR #11 から除外（履歴整理） — 完了
 - [高] PR #11 をレビューして差分を分割（コードの PR と bench_results を分離） — 完了（bench-results-archive ブランチへ移動）
- [中] ドキュメント更新（`scripts/run_tuned_250ms_bench.js` の使い方、probe の説明）
- [中] 追加チューニング（`EARLY_FALLBACK_MS` / `probeRounds` / `probeBudget` のグリッド）
- [低] 集計結果を Markdown/CSV 化して PR に添付

---

作成日: 2026-05-24

## 進捗

- 2026-05-24: bench_results/ を .gitignore に追加（完了）。
 - 次: PR #11 をコードと bench_results に分割して PR を分離する（完了）。
