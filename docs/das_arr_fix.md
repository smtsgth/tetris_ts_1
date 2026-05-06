# DAS/ARR 修正の記録

## 要約
`src/input.ts` のデフォルト値をユニットテストの期待値に合わせて調整しました。

- 変更前: `DAS` = 5 (ms?), `ARR` = 25
- 変更後: `DAS` = 170, `ARR` = 30

目的: `src/__tests__/das_runtime.test.ts` のタイミング検証に合致させ、Vitest による単発実行での失敗を解消するため。

## 検証
- `npm run build` が成功しました。
- `npm run test:ci`（`node ./scripts/test-ci.js` の単発実行ラッパー）で全ユニットテストが合格しました。
- 短時間自動検証 (`scripts/auto-test-ci.js`) を実行し、`recordings/auto_test_early_fallback_*.json` が生成されました。

## 影響と注意点
- 操作感（キー反復の応答性）に影響が出る可能性があります。実際のゲームプレイでの差分検証を推奨します。
- 長時間の自動検証やユーザーテストで回帰がないか確認してください。

## 関連
- PR: https://github.com/smtsgth/tetris_ts_1/pull/3
- ドキュメント: https://github.com/smtsgth/tetris_ts_1/issues/10

