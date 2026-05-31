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

## 最新 CI 実行結果（2026-05-31）

- 実行: `Microbench` ワークフロー（ブランチ: `feature/default-probe-5`）
- ベースラインファイル数: 193、ポストファイル数: 39
- 差分ファイル: `microprof_diff_2026-05-31T00-47-03-000Z.json`
- 主要な改善（上位）:
  - gpf.total: -265.600 (-71.6%)
  - gpf.apply_build: -46.200 (-59.0%)
  - gpf.delta_eval: -40.800 (-71.6%)
  - gpf.apply_build_coladds: -22.500 (-81.2%)
  - gpf.heap: -19.200 (-64.4%)
  - gpf.restore: -19.100 (-89.3%)
  - gpf.drop_adjust_up: -18.400 (-76.7%)
  - gpf.drop_calc: -18.400 (-77.0%)
  - gpf.drop_adjust_down: -14.200 (-80.7%)
  - gpf.delta_eval_cols: -0.800 (-80.0%)
  - gpf.delta_eval_bump: -0.500 (-71.4%)
  - gpf.place_drop: +0.700 (N/A)
- CSV サマリ: [bench_reports/microprof_diff_summary_1780192316839.csv](bench_reports/microprof_diff_summary_1780192316839.csv)
- フルアーティファクト: branch `bench-results-archive` / Actions run artifacts に保存

注: この結果は `colAdds` のプリコンプ + LRU キャッシュ等の最適化により、`gpf.apply_build_coladds` を中心に大幅な改善が出ていることを示します。さらなるパラメータスイープ（LRU 上限、プリコンプ範囲）で収束を確認します。
