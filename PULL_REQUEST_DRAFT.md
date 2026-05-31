# PR草案: colAdds のシフト最適化（プリコンプ + LRU + インデックス化）

ブランチ: feature/default-probe-5

## 概要
- `src/ai_worker.ts` に対し、`colAdds` シフト計算のランタイムコストを削減するための最適化を行いました。
  - プリコンピュート: `colAddsShiftTable` を `PRECOMP_COLADDS_Y_MIN..MAX` 範囲で生成し、標準経路で利用。
  - 動的キャッシュ: `colAddsShiftCache` を導入（LRU風 eviction, 上限=8）して未カバーケースを高速化。
  - インデックス化: `colAddListIndexMap` を追加しループを列順（0..COLS-1）へ変更、予測性を改善。
  - `generatePlacementsForType()` の `apply_build` でプリコンプ優先→キャッシュ→フォールバックの順に処理。

## 変更点（主なファイル）
- `src/ai_worker.ts`: colAdds 関連のデータ構造追加・プリコンプ生成・LRU フォールバック・ループ順変更

## ベンチ概要（要約）
- ベースライン: 既存の `main` 相当の集計（bench_results 内のカットオフ以前ファイル）
- ポスト: 本パッチ適用後の集計（bench_results 内の新しいファイル）

trials=200 の差分（抜粋）:

- `gpf.total`: 328.700 → 93.800 （-71.5%）
- `gpf.apply_build`: 69.100 → 30.600 （-55.7%）
- `gpf.delta_eval`: 51.200 → 13.300 （-74.0%）
- `gpf.apply_build_coladds`: 22.800 → 6.100 （-73.2%）

trials=500 の差分（抜粋）:

- `gpf.total`: 371.200 → 105.600 （-71.6%）
- `gpf.apply_build`: 78.300 → 32.100 （-59.0%）
- `gpf.delta_eval`: 57.000 → 16.200 （-71.6%）
- `gpf.apply_build_coladds`: 27.700 → 5.200 （-81.2%）

フル出力・個別 microprof ファイルは `bench_results/` に保存しています。主要差分集計ファイル:

- [bench_results/microprof_diff_2026-05-31T00-46-18-000Z.json](bench_results/microprof_diff_2026-05-31T00-46-18-000Z.json)
- [bench_results/microprof_diff_2026-05-31T00-47-03-000Z.json](bench_results/microprof_diff_2026-05-31T00-47-03-000Z.json)

（参照用の代表 microprof ファイル例）
- [bench_results/microprof_I_k2_2026-05-31T00-46-18-417Z.json](bench_results/microprof_I_k2_2026-05-31T00-46-18-417Z.json)
- [bench_results/microprof_I_k2_2026-05-31T00-47-03-911Z.json](bench_results/microprof_I_k2_2026-05-31T00-47-03-911Z.json)

## 注意・設計上のトレードオフ
- プリコンプ範囲（Y: PRECOMP_COLADDS_Y_MIN..MAX）を広げるとランタイムがさらに減る可能性があるが、メモリ使用量が増える。
- LRU 上限（現状 8）は経験的な値。ワークロードにより 8→16 などの調整が有効な場合あり。

## 再現手順（ローカル）

```bash
node scripts/run_microbench_sweep.js --trials 200 --mprof --url http://127.0.0.1:8080/ --outDir bench_results
node scripts/run_microbench_sweep.js --trials 500 --mprof --url http://127.0.0.1:8080/ --outDir bench_results
node scripts/aggregate_mprof_split.js 2026-05-31T00-46-18-000Z
node scripts/aggregate_mprof_split.js 2026-05-31T00-47-03-000Z
```

## 添付 & レビューのお願い
- 変更点の差分（`src/ai_worker.ts`）と上記ベンチ結果を PR に添付します。
- レビュー特に確認してほしい点:
  1. プリコンプテーブルの範囲妥当性（メモリ vs カバレッジ）
  2. LRU 上限の調整案（8→16 の影響）
  3. `colAddListIndexMap` によるループ順変更が他コードに与える影響

## 次の推奨アクション
1. この草案を確認後、リモートへ `push` → PR を作成して CI でベンチを自動実行する（推奨）
2. PR マージ前に LRU 上限やプリコンプ範囲の追加実験を自動化（CI）で行う

----
生成: ローカルコミット済み（feature/default-probe-5）
