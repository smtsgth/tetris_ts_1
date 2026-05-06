# 会話の要約

## 概要

この会話は、Tetris AI における「ホールド交換がループして積まない」問題を解消するための設計・実装・検証の記録です。主な方針は「メイン側でデバウンスと中間結果制御を入れる」ことと「ワーカー側のホールド選好を下げる（HOLD_PENALTY を上げる）」ことです。

## 目的

- ホールドループ（同一ピースの連続ホールド）を解消する
- ワーカーとメインの結果競合を抑え、安定して直感的な動作にする
- 自動化されたキャプチャ／パラメータスイープで再現性ある評価を行う

## 実施した変更（要点）

- `worker_planner.js`: `HOLD_PENALTY` を 80 → 320 に恒久更新（バックアップあり）
- `src/ai.ts` / `dist/ai.js`: 
  - reqId 単位のデバウンス実装（`DEBOUNCE_MS`）
  - ホールド専用長めデバウンス（`DEBOUNCE_HOLD_MS`）
  - 中間結果適用回数制限（`MAX_INTERMEDIATE_APPLIES_PER_REQ`）
  - 早期フォールバックと TTL（`EARLY_FALLBACK_MS` / `APPLIED_FALLBACK_TTL_MS`）
  - フォールバック中は `game.setAllowHold1(false)` / `game.setAllowHold2(false)` でホールド抑止
- 自動検証スクリプトを追加: `scripts/capture_one_run.js`, `scripts/param_sweep.js`, `scripts/long_verify.js`, `scripts/extended_verify_top.js`, `scripts/worker_penalty_sweep.js`
- 変更をコミット済み（コミット: b5ba55c）

## テストと主な結果

- ワーカー側の `HOLD_PENALTY` スイープにより `320` がホールド頻度を最も抑えた（`worker_penalty_sweep` の集計結果）。
- 短時間キャプチャでデバッグログ確認、メイン側のデバウンス・中間制御は期待通りに動作。
- 長時間検証（30秒 × 30回）を実施し集計結果を保存済み:
  - サマリファイル: [recordings/long_verify_summary_1777897029981.json](recordings/long_verify_summary_1777897029981.json#L1)
  - 比較した候補:
    - 候補 A: `DEBOUNCE_MS=300`, `DEBOUNCE_HOLD_MS=800`, `MAX_INTERMEDIATE_APPLIES_PER_REQ=3`
      - 合計適用: 46882、合計 hold: 4831（平均 ~161.0 / run）
    - 候補 B: `DEBOUNCE_MS=200`, `DEBOUNCE_HOLD_MS=800`, `MAX_INTERMEDIATE_APPLIES_PER_REQ=1`
      - 合計適用: 47225、合計 hold: 5269（平均 ~175.6 / run）
  - 結論: 候補 A の方が hold を少なく安定している

## 結論と推奨

- 当面は `HOLD_PENALTY=320` を維持し、メイン側設定は候補 A（`DEBOUNCE_MS=300`, `DEBOUNCE_HOLD_MS=800`, `MAX_INTERMEDIATE_APPLIES_PER_REQ=3`）をデフォルト候補とするのが良さそうです。
- 次の推奨アクション:
  1. 変更をリモートへ push して PR を作成（レビュー・デプロイ）
  2. `DEBOUNCE_*` と TTL の広域自動スイープで最適値を確定
  3. 個別のキャプチャファイルを解析して外れ値原因（タイミング・GC・負荷）を調査

## 付録: 主要ファイル

- `worker_planner.js`（HOLD_PENALTY=320）
- `dist/ai.js`（ブラウザ用バンドル、デフォルトを同期）
- `src/ai.ts`（実装ソース）
- 検証スクリプト: `scripts/*`

---

作成日時: 2026-05-04

## 追加の考察

- 実行環境依存の動作差が観測されるため、異なるマシンやブラウザでの再現確認が必要。
- ホールド抑止はユーザ体験に影響するため、状況に応じてUI上に「AIホールド抑止」フラグを表示する案を検討する。

## 追跡すべき次の作業

1. `HOLD_PENALTY` を現在の `320` のまましばらく運用し、実運用データを収集する。
2. `DEBOUNCE_*` 設定の自動スイープを行い、最適値を探索する（負荷・GC影響も考慮）。
3. キャプチャの外れ値を特定するため、より詳細なタイムスタンプとメモリプロファイリングを有効にする。

## 変更履歴

- 2026-05-04: デフォルト設定を `HOLD_PENALTY=320` に更新。メイン側でデバウンスと中間制御を導入。

---
