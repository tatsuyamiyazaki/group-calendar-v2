## Sprint 1: テーマ基盤の構築

### 実装する機能

- **テーマ状態の管理**: `light` / `dark` / `system` の 3 モードを React Context で管理
- **設定の永続化**: `localStorage` (`gc:theme`) と `APP_SETTINGS_V2.theme` の両方に保存し、起動時はサーバー値を真実とみなす
- **設定パネルへの切替 UI 追加**: ラジオまたはセグメントコントロールで 3 モードを選択
- **FOUC（初期表示フラッシュ）防止**: React マウント前に `<html>` クラスを適用するインラインスクリプトを追加

### スプリント契約（完了条件）

以下の全条件を満たした場合のみ、このスプリントは完了とする。

- [x] `APP_SETTINGS_V2` に `theme` フィールド（値は `'light' | 'dark' | 'system'`）が追加されている — `code.js:304,308,320`、`index.html:1000` (handleSave の `newSettings`)
- [x] `loadSettings` が `theme` 未設定のユーザーには `'system'` を返す（後方互換）— `code.js:308` で `'light' | 'dark' | 'system'` 以外は `'system'` にフォールバック
- [x] 設定パネルに 3 モードを切り替える UI コントロールがあり、現在の選択が視覚的に判別できる — `index.html:1227-1234` のセグメントコントロール、選択中は青背景＋白文字、`aria-checked` 付与
- [x] テーマを切り替えると `<html>` 要素の `class` 属性に `dark` が付与（dark／system+OS が暗い場合）または削除（light／system+OS が明るい場合）される — `index.html:2586` `document.documentElement.classList.toggle('dark', d)`。発火タイミングは設定モーダルの「保存」クリック時（`settings.theme` 更新で useEffect 発火）
- [x] 選択したテーマが `localStorage` キー `gc:theme` に保存される — `index.html:2588` `localStorage.setItem('gc:theme', t)`（保存クリック時に発火）
- [x] 選択したテーマが `google.script.run.saveSettings` 経由でサーバーに保存される — `index.html:1000-1002` `newSettings.theme` を含めて `saveSettings` 呼び出し
- [x] ページリロード時、React マウント前に `<head>` 内インラインスクリプトが `localStorage` を読み、`<html>` クラスを適用している — `index.html:8-9` Tailwind script 直後の IIFE で React 読み込み前に実行
- [x] ページ表示後にサーバーから取得した `APP_SETTINGS_V2.theme` が `localStorage` と異なる場合、サーバー値で `localStorage` と現在の `<html>` クラスを上書きする — `index.html:2581-2590` の useEffect が `loadSettings` 成功後に `settings.theme` で `classList` と `localStorage` を上書き
- [x] `system` モード選択中、`window.matchMedia('(prefers-color-scheme: dark)')` の `change` イベントで `<html>` クラスが自動更新される — `index.html:2589` で `addEventListener('change', ...)`（旧 API `addListener` フォールバックも対応）
- [x] Tailwind CDN コンフィグに `tailwind.config = { darkMode: 'class', ... }` が宣言されている — `index.html:8` `<script>tailwind.config={darkMode:'class'}</script>`
- [x] `index.html` の編集は既存の圧縮スタイル（1 行に複数文、短縮変数名）を維持している — 全編集が短縮変数 (`t`, `d`, `mq`, `h`, `o`, `v`, `l`) と 1 行複数文の形式

### 残課題 / 動作確認メモ

- ユーザーが「設定パネルでテーマを選んだ瞬間に画面が変わらない」と感じる場合、それは **本契約のスコープ通り**（設定モーダルの「保存」クリックで `settings.theme` が更新され、その時点で `<html>` クラスが切り替わる）。即時プレビュー（ラジオ選択の瞬間に切替）が必要なら Sprint 1.5 として SettingsModal 内に DOM 直接操作の useEffect を追加するか、Sprint 2 のヘッダークイックトグルで対応する。
- Sprint 1 完了時点で **body や各コンポーネントの背景・文字色は light のまま**。`<html class="dark">` は付くが、`bg-gray-50` 等のクラスにダークバリアントが無いため見た目は変わらない。これは Sprint 2 のスコープ（全 UI のダークスタイル適用）。
