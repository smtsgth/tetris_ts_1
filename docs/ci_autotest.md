**CI 実行手順（auto-test: early-fallback）**

目的：`EARLY_FALLBACK_MS` の設定による AI の早期フォールバック挙動を自動で評価し、致命的エラーやタイムアウト原因をログ収集して解析するための手順をまとめます。

**重要ファイル**
- `scripts/auto_test_early_fallback.js` — テスト本体（ai.ts 差替え、ビルド、http-server、Puppeteer キャプチャ、ログ書出し）。
- `scripts/run_auto_test_and_capture_exit.ps1` — PowerShell ラッパー（stdout/stderr 保存、`recordings/cli_exitcode_run.txt` に exit code を書込）。
- `scripts/analyze_recordings_diff.js` — `recordings/` を解析して差分レポート（JSON/TXT/CSV）を生成。
- `.github/workflows/auto-test.yml` — GitHub Actions ワークフロー（`npm run auto-test:ci` を実行して `recordings/` をアーティファクト化）。

**前提 / 推奨環境**
- Node.js（推奨 v18+、Actions では `node-version: '20'` を指定）。
- `npm ci` 実行済みであること。`puppeteer` を使用するためネットワーク/ライブラリが必要。

## ローカル実行（短いドライラン）

1) 依存インストール

```bash
npm ci
```

2) CI 相当の短い実行（package.json の `auto-test:ci`）

```bash
npm run auto-test:ci
```

3) PowerShell ラッパー（Windows）

```powershell
.\scripts\run_auto_test_and_capture_exit.ps1 50
# 引数は early-fallback ms を指定（例: 50）
```

4) ビルドをスキップして素早く実行する例

POSIX:
```bash
SKIP_BUILD=1 TEST_DURATION_MS=3000 node scripts/auto_test_early_fallback.js 50
```
Windows PowerShell:
```powershell
$env:SKIP_BUILD='1'
$env:TEST_DURATION_MS='3000'
node scripts/auto_test_early_fallback.js 50
```

## 主要な環境変数
- `SKIP_BUILD` = `1` : `npm run build` をスキップ（既存の `dist/` を利用）。
- `TEST_DURATION_MS` : ページ上のログ収集時間（ミリ秒）。
- `CI` : CI 実行時に `true` を設定。
- `SKIP_AUTOTEST_RESTORE` : `ai.ts` のバックアップ復元をスキップ（デバッグ用）。

## 出力 / 収集ファイル（`recordings/`）
- `auto_test_early_fallback_{ms}_{ts}.json` — 各試行の詳細ログ（sample, counts）。
- `auto_test_summary_{ts}.json` — まとめ（全テストの配列）。
- `auto_test_run_events_{ts}.json` — イベントログ（run-start、server-exit、fatal 等）。
- `server_{port}_{ts}.log` / `.err` — `http-server` の stdout/stderr。
- `cli_exitcode_run.txt` — スクリプトの最終 exit code。
- `run_fatal_*.log`, `run_uncaught_exception_*.log` — 致命エラーや未捕捉例外のスタック。
- `diff_report_*.{json,txt,csv}` — `scripts/analyze_recordings_diff.js` による差分レポート。

## GitHub Actions の確認方法
1. リポジトリを push するか、Actions の手動実行（workflow_dispatch）を使ってワークフローを開始します。
2. 実行完了後、Actions → 該当ワークフロー → ジョブ → 「Artifacts」から `recordings` をダウンロードします。
3. ダウンロードした `recordings/` を展開して、ローカルで `node scripts/analyze_recordings_diff.js` を実行すると差分レポートが作成されます。

例：差分解析実行

```bash
node scripts/analyze_recordings_diff.js --csv --excerpt=20 --window=300000 --prefix=diff_report
```

## よくあるトラブルと対処
- Node が見つからない: Node をインストールし、PATH を再読み込みしてください。
- Puppeteer/Chromium の起動失敗: Actions の `ubuntu-latest` では通常動作しますが、カスタム環境では必要パッケージ（libnss3 等）を追加してください。
- `cli_exitcode_run.txt` が更新されない: `run_auto_test_and_capture_exit.ps1` を使用するか、`auto_test_early_fallback.js` の終了ハンドラ（process.on('exit')）を確認してください。

---
ファイル: `docs/ci_autotest.md`
