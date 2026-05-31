# Global-cache sweep summary (2026-05-31)

軽いグリッド探索を実行し、`GLOBAL_COLADDS_RUNTIME_CACHE_MIN_HITS_TO_PROMOTE` と `GLOBAL_COLADDS_RUNTIME_CACHE_LIMIT` の組合せを評価しました。

- 環境: Windows, ローカルブラウザベンチ (Puppeteer)
- テスト: pieces=`L`, topK=2
- グリッド: `MIN_HITS` ∈ {1,2,4}, `LIMIT` ∈ {1024,4096}
- 初期スイープ: `trials=100`（各組合せで precomp / noprecomp の両条件）
- 上位候補の確認: `trials=300`

## 結果（要約）

| MIN_HITS | LIMIT | precomp avgMs | precomp gpf.delta_eval | noprecomp avgMs | noprecomp gpf.delta_eval |
|---:|---:|---:|---:|---:|---:|
| 1 | 1024 | 0.103 | 0.30 | 0.062 | 0.00 |
| 1 | 4096 | 0.086 | 0.30 | 0.147 | 0.10 |
| 2 | 1024 | 0.183 | 0.20 | 0.094 | 0.30 |
| 2 | 4096 | 0.136 | 0.30 | 0.063 | 0.00 |
| 4 | 1024 | 0.059 | 0.20 | 0.087 | 0.20 |
| 4 | 4096 | 0.087 | 0.20 | 0.131 | 0.00 |

## 確認 (trials=300)

- precomp candidate: `MIN_HITS=4, LIMIT=1024` → avgMs = **0.04933 ms** (確認実行)
- noprecomp candidate: `MIN_HITS=1, LIMIT=1024` → avgMs = **0.06433 ms** (確認実行)

## 考察 / 推奨

- `precomp` 有効時は `MIN_HITS=4, LIMIT=1024` が最速（今回の条件下）。
- `precomp` 無効時は `MIN_HITS=1, LIMIT=1024` が安定して良好。
- 現在のデフォルトは `MIN_HITS=1, LIMIT=4096`（ローカルで維持）。変更はコード上のデフォルト値を上書きする必要があり、作業ブランチでのレビューが望ましい。

## 再現コマンド

```bash
# grid (既存スクリプト)
node scripts/sweep_global_cache.js L 2

# 単一組合せの検証例（precomp有効）
npm run build
node scripts/run_microbench_sweep.js --pieces L --topKs 2 --trials 300 --outDir bench_results/confirm_mh4_lim1024_t300 --mprof
node scripts/aggregate_mprof_fields_dir.js --dir bench_results/confirm_mh4_lim1024_t300 --out bench_results/confirm_mh4_lim1024_t300/mprof_agg
```

---

作業済み: スイープスクリプトを追加し、上記サマリーをこのブランチにコミットしました。次に `ai_worker.ts` のデフォルト値を変更して PR を作成しますか？（自動で行います）
