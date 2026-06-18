# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 概要

Google Apps Script (GAS) 製のドメイン内向け Web アプリ。1 つの SPA (`index.html`) と 1 つのサーバーサイドファイル (`code.js`) で構成され、複数の Google カレンダーを横断表示する。詳細な機能・スコープ・データ構造は `README.md` 参照。

## 開発コマンド

ビルドステップは無い。ローカル編集 → `clasp push` → GAS 側にデプロイ、というフロー。

```powershell
# 認証（初回のみ）
npx @google/clasp login

# ローカル → リモートに反映
npx @google/clasp push

# リモート → ローカルに取り込み
npx @google/clasp pull

# WebApp の新バージョンをデプロイ
npx @google/clasp deploy --description "vX.Y.Z"

# GAS エディタを開く
npx @google/clasp open-script

# 実行ログをストリーム
npx @google/clasp logs --watch
```

`.clasp.json` は `.gitignore` 対象（`scriptId` を秘匿）。新規環境では `clasp clone <SCRIPT_ID>` で生成する。

## サーバー / クライアントの境界

クライアント (`index.html`) → サーバー (`code.js`) は **`google.script.run.withSuccessHandler(...).<funcName>(args)`** の 1 経路のみ。`code.js` のトップレベル関数だけが呼び出し可能。

クライアントから呼ばれている主なサーバー関数（追加・改名時は `index.html` 側の呼び出しも合わせて修正）:

| サーバー関数 | 役割 |
|---|---|
| `doGet(e)` | エントリポイント。`?view=&group=` を `index.html` テンプレートに渡す |
| `getCalendarEvents(startStr, endStr, targetEmails, forceRefresh)` | 横断取得のメイン。JSON 文字列を返す |
| `createEvent` / `updateEvent` / `deleteEvent` | CRUD。ゲスト付きは `sendUpdates: 'all'` |
| `saveSettings` / `loadSettings` | `APP_SETTINGS_V2` の読み書き |
| `searchDirectoryUsers` / `getUserProfiles` | 名前・写真の解決 |
| `getSubscribedCalendars` / `getResourceCalendars` | カレンダー一覧 |
| `getQuickSchedule` / `getTeamStatus` | クイック機能 |
| `clearAllUserCache` / `clearServerCache` / `factoryReset` | キャッシュ／設定削除 |

戻り値はクライアントで JSON 化を期待する箇所が多い（`JSON.parse(d)` パターン）。サーバー側で `JSON.stringify` するか、プレーンオブジェクトを返すかは関数ごとに統一されていないので既存呼び出し側に合わせる。

## キャッシュ階層（重要）

3 層あり、`forceRefresh` の伝播ポイントを誤ると古い表示や API クォータ過剰消費を招く。

1. **`MEMORY_CACHE`** (`code.js` グローバル) — 名前解決の実行内メモリ。`getCalendarEvents` 冒頭で `forceRefresh` 時にクリアされる。
2. **`PropertiesService.getUserProperties()`**
   - `NAME_CACHE_V2`: 名前・写真 (30 日 / 8500 文字超で古い半分を破棄)
   - `APP_SETTINGS_V2`: ユーザー設定本体
   - `ST_<calId>`: Calendar API の syncToken
3. **`CacheService.getUserCache()`** — `EV_<calId>_<range>` で 6 時間。1 エントリ 100KB 上限。
4. **クライアント側 IndexedDB (`GroupCalendarDB`) + localStorage** — UI 状態とイベントキャッシュ。

`SYSTEM_API_ERROR_OCCURRED` フラグが立つと以降の People API 呼び出しがスキップされる。リクエスト単位の現象なので関数の入り口で `false` に戻すこと（`getCalendarEvents` がそうしている）。

## イベント正規化規則 (`convertEvent_`)

`code.js` の `convertEvent_` がカレンダー API のイベントをクライアント向けに変換する。以下の挙動は意図的なので変更時は確認:

- `0:00–0:00`（≥1 日）の通常予定は `isAllDay = true` に昇格
- 同タイトル・同開始時刻の終日イベントは `fetchCalendarEventsREST` 内で重複排除
- `visibility === 'private'` かつ他人のカレンダー → タイトル「非公開」、`description`/`location` を空に
- `colorId` → `COLOR_MAP` でカラー解決、未指定は `#4285F4`

## 名前解決の優先順位

`resolvePersonInfo(email, fallbackName, onlyCacheOrFallback)`:
1. 自分のメール → `People.People.get('people/me', ...)`
2. ディレクトリ → `AdminDirectory.Users.list`（権限あれば）→ 失敗時 People API
3. 連絡先

第 3 引数 `true` はキャッシュかフォールバック名のみを返す高速モード（API を叩かない）。大量呼び出しのループ内では `true` を使い、後で `executeCacheWarmUp` で最大 3 件だけ非同期解決するパターンを使う。新規ループ追加時もこの慣習を守ること。

## `index.html` の構造

- ファイル単体に Tailwind / React 18 / Babel Standalone / lucide を CDN 読み込み
- React コンポーネントは `<script type="text/babel">` 内に複数定義
- ビルド不要 = ブラウザ内で Babel が JSX 変換する。ファイルが約 190KB あり、コードは意図的に**圧縮スタイル**（1 行に複数文、極端な短縮変数名）で書かれている。`Edit` する際はこの密なスタイルを保つ（リフォーマットすると差分が膨大になり diff レビュー不可になる）。
- 設定 (`settings`) は `loadSettings` で初期化し、変更は `saveSettings` でサーバーへ即時 push（デバウンスは特定箇所のみ）

## 設定値とリセット

ユーザー設定は `PropertiesService.getUserProperties()` の `APP_SETTINGS_V2` キーに集約（構造は README 参照）。`factoryReset` は user/script の双方の Properties + CacheService を全削除する強い操作。ユーザーから明示要望が無い限り呼ばない。

## 注意事項

- `ENABLE_ACTIVATION_FLOW` は `code.js` 冒頭の定数。`true` にすると `ScriptProperties.ACTIVATED_USER_LIST` でホワイトリスト制御が有効化される。
- Advanced Service (`Calendar` / `People` / `AdminDirectory`) は GAS エディタ側で手動有効化が必要。マニフェスト (`appsscript.json`) には宣言済みだが、初回 push 後に「サービス +」で追加しないと参照エラーになる。
- 会議室一覧は `AdminDirectory.Resources.Calendars` が権限不足のとき、過去 90 日のイベントから `*@resource.calendar.google.com` を抽出するフォールバックを実行する。テスト時は両経路を確認。
- 本コードベースは README に「社内利用想定」とあるため、外部公開向けの変更（ライセンス記載、UI 文言の汎用化、固定ドメイン依存の除去）は明示依頼があるまで行わない。
