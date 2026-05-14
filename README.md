# Group Calendar (v2)

複数の Google カレンダーをグループ単位で横断表示するための Google Apps Script (GAS) 製 Web アプリです。Google Workspace ドメイン内のメンバー・会議室・チームの予定を、1 画面でまとめて閲覧／編集できます。

- バージョン: `v2.0.0`
- タイムゾーン: Asia/Tokyo
- ランタイム: V8
- 公開範囲: ドメイン内 (`access: DOMAIN`, `executeAs: USER_DEPLOYING`)

---

## 主な機能

### カレンダー横断ビュー
- 自分が購読中のカレンダーを「登録カレンダー」として自動取り込み
- 任意のメンバー／会議室を組み合わせた**カスタムグループ**を作成可能
- 同一画面に複数人の予定を縦に並べて表示
- グループ毎に**ミーティングビュー**／**コンパクトデイビュー**を切替

### 予定の閲覧・編集
- カレンダー REST API (`Calendar.Events.list`) によるフルフェッチ
- イベントの作成・更新・削除 (`createEvent` / `updateEvent` / `deleteEvent`)
- ゲスト追加時は `sendUpdates: 'all'` で招待メール送信
- 非公開予定 (`visibility: 'private'`) は他人のカレンダーでは「非公開」と表示
- 0:00–0:00 の予定を**終日扱い**に自動正規化
- 同タイトル・同日の終日イベントの重複を排除

### メンバー検索・名前解決
- **3 段階の名前解決**: 自分 → ディレクトリ (People API) → 連絡先
- 管理者 API (`AdminDirectory.Users.list`) → 一般ユーザー向け People API へ自動フォールバック
- 解決済みの名前・プロフィール画像は `PropertiesService` にキャッシュ（30 日）
- 未解決ゲストはバッチ解決（最大 10 件）

### 会議室／リソースカレンダー
- `AdminDirectory.Resources.Calendars` から会議室一覧を取得
- 権限がない場合は過去 90 日の予定から `resource.calendar.google.com` 宛のゲストを抽出してフォールバック
- 結果は `CacheService` に 6 時間キャッシュ

### クイック機能
- **クイック予定確認** (`getQuickSchedule`): 指定メールの 7 日分予定を取得
- **チームステータス** (`getTeamStatus`): 指定メンバーの「今の予定／次の予定／終日予定」を一括取得
- URL パラメータ `?view=...&group=...` で初期ビュー指定可能

### 設定・キャッシュ
- ユーザー設定は `PropertiesService.getUserProperties()` に `APP_SETTINGS_V2` として保存
- 区切り線 (`dividerLines`)、モノカラー表示、非表示カレンダー、ヘッダーパディング等を保持
- `clearAllUserCache` / `clearServerCache` / `factoryReset` でキャッシュ／設定を削除

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  index.html (フロントエンド)                            │
│   - React 18 + Tailwind CSS (CDN)                       │
│   - Babel Standalone でブラウザ内変換                   │
│   - lucide アイコン                                     │
│   - IndexedDB (GroupCalendarDB) でクライアントキャッシュ│
│   - localStorage で設定・ビュー状態を保持               │
└───────────────────────┬─────────────────────────────────┘
                        │ google.script.run
┌───────────────────────▼─────────────────────────────────┐
│  code.js (サーバーサイド / GAS)                         │
│   - doGet: HtmlService テンプレートで index.html を返却 │
│   - Calendar Advanced Service (v3)                      │
│   - People API (v1) / AdminDirectory (directory_v1)     │
│   - PropertiesService / CacheService                    │
└─────────────────────────────────────────────────────────┘
```

### 必要な OAuth スコープ
`appsscript.json` で要求しているスコープ：

| スコープ | 用途 |
|---|---|
| `auth/calendar` | 予定の閲覧・編集 |
| `auth/contacts.readonly` | 連絡先からの名前解決 |
| `auth/directory.readonly` | ドメインディレクトリ検索 |
| `auth/admin.directory.resource.calendar.readonly` | 会議室カレンダー一覧 |
| `auth/script.external_request` | 外部リソース (フォント等) |
| `auth/userinfo.email` | 実行ユーザーのメール取得 |

### 有効化が必要な Advanced Service
- Calendar API (v3) — `Calendar`
- People API (v1) — `People`
- Admin SDK / Directory API (directory_v1) — `AdminDirectory`

---

## ファイル構成

| ファイル | 説明 |
|---|---|
| `code.js` | サーバーサイドのエントリポイント。カレンダー取得・名前解決・設定永続化・CRUD を集約 |
| `index.html` | React 製の SPA。サーバー関数を `google.script.run` 経由で呼び出す |
| `appsscript.json` | マニフェスト（スコープ・タイムゾーン・Advanced Service・WebApp 設定） |
| `.gitignore` | `.clasp.json` を除外（ローカルの clasp プロジェクト ID を秘匿） |

---

## セットアップ

### 前提
- Node.js / npm
- [clasp](https://github.com/google/clasp) (推奨)
- Google Workspace アカウント（ドメイン内利用前提のため）

### clasp でデプロイ

```powershell
# 初回ログイン
npx @google/clasp login

# 既存スクリプトに紐付け
npx @google/clasp clone <SCRIPT_ID>

# プッシュ
npx @google/clasp push

# WebApp としてデプロイ
npx @google/clasp deploy --description "v2.0.0"
```

`.clasp.json` は Git 管理外 (`.gitignore` 済) です。各自のローカルで生成してください。

### Advanced Service の有効化
GAS エディタの「サービス +」から以下を追加：
- Calendar API
- People API
- Admin SDK (※ Directory API のリソースカレンダー機能を使う場合は管理者権限のあるアカウントでデプロイ)

---

## 設定の主要キー

`PropertiesService.getUserProperties()` に保存される `APP_SETTINGS_V2` の構造：

```jsonc
{
  "groups": [
    {
      "id": "default_registered",
      "name": "登録カレンダー",
      "members": ["user@example.com"],
      "meetingView": false,
      "isCompactDayView": false
    }
  ],
  "activeGroupId": "default_registered",
  "hiddenCalendars": [],
  "useMonoColor": false,
  "dividerLines": [{ "hour": 12, "label": "午後" }],
  "headerPadding": 0,
  "v1DayLayout": false,
  "teamMembers": []
}
```

---

## アクティベーションフロー

`code.js` 冒頭の `ENABLE_ACTIVATION_FLOW` を `true` にすると、`ScriptProperties` の `ACTIVATED_USER_LIST` に登録されたユーザーのみ利用可能になります（現在は無効）。

---

## 開発メモ

- React コンポーネントは `index.html` 内に `<script type="text/babel">` で記述されています（ビルド不要）
- 大量のメールアドレスに対しては `executeCacheWarmUp` でランダムに最大 3 件だけバックグラウンド解決し、API クォータを節約しています
- People API でエラーが発生したら `SYSTEM_API_ERROR_OCCURRED` を立てて、それ以降の名前解決呼び出しをスキップします
- `NAME_CACHE_V2` は 8500 文字を超えると古い半分を破棄します（PropertiesService の上限対策）

---

## ライセンス

社内利用を想定したプロジェクトです。外部公開する場合はライセンスを明記してください。
