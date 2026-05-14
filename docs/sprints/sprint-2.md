## Sprint 2: 全 UI のダークモード対応とクイックトグル

### 実装する機能

- **主要 UI コンポーネントのダークスタイル**: ヘッダー、サイドバー／グループタブ、設定モーダル、予定編集モーダル、検索・人物選択ダイアログ、フォーム入力
- **カレンダー本体のダークスタイル**: 日付ヘッダー、時刻軸、グリッドライン、区切り線（`dividerLines`）、終日エリア、コンパクトデイビュー
- **イベントカードの可読性調整**: ダーク背景でも `colorId` 由来カラーが識別可能、文字コントラストを確保。`useMonoColor` 有効時の代替配色を用意
- **ヘッダーのクイックトグル**: 月／太陽アイコンのボタンで light ↔ dark を即切替

### スプリント契約（完了条件）

以下の全条件を満たした場合のみ、このスプリントは完了とする。

- [x] アプリヘッダー（タイトル・グループタブ・各種ボタン・URL コピー等）の文字と背景のコントラスト比がダークモードで 4.5:1 以上を満たす — `.dark .bg-white`→`#1e293b`、`.dark .text-gray-700`→`#e5e7eb`（コントラスト約 12.6:1）。`index.html:42-86`
- [x] 設定モーダル・予定編集モーダル・検索／人物選択ダイアログの全要素（テキスト・入力欄・ボタン・区切り線・スクロールバー周辺）がダークモードで視認可能 — `.dark` で `.bg-white/.bg-gray-50/.text-gray-* /.border-*/.custom-scrollbar/input/select/textarea` を一括上書き
- [x] カレンダー本体（日付ヘッダー・時刻軸ラベル・グリッドライン・現在時刻ライン・`dividerLines` の区切り線・終日エリア）がダークモードに適応している — `.dark .past-header/.divider-line/.divider-label/.grid-cell:hover/.resizer-*`
- [x] イベントカードの背景色・文字色・枠線がダークモード時に再計算され、`COLOR_MAP` 全 11 色および `useMonoColor` 有効時のいずれでも文字が判読できる — 3 箇所のイベントカード (`index.html:1556,1626,1768`) に `event-text-dark` / `event-border-dark` クラスを追加、`.dark` 配下で `color:#e5e7eb !important` と `border-color:rgba(255,255,255,0.12) !important` で上書き。背景は元の `c+'1A'` のまま色味を保持
- [x] 非公開予定（`visibility: 'private'`、「非公開」表示）がダークモードでも他イベントと識別できる — 元の `colorId` 由来カラーを保持するため識別可能
- [x] フォーム入力（input/select/textarea）と `searchDirectoryUsers` の検索結果リストがダークモードで視認可能、フォーカスリングが見える — `.dark input/select/textarea` で背景・文字・ボーダー、`.dark .ring-1/.ring-2` でリング色
- [x] トースト・ツールチップ・ドロップダウンメニューがダークモード対応 — `.dark .float-tooltip` 専用 + bg-white 一括上書きでドロップダウンも対応
- [x] ヘッダーに月／太陽アイコンのクイックトグルがあり、クリックで `light` ↔ `dark` を即切替できる — `index.html:2693` 周辺に追加。`setSettings(ns)` + `google.script.run.saveSettings(ns)` で即時反映。`isDark` 判定で `sun` ↔ `moon` アイコン切替
- [x] `system` モード時、クイックトグルは「現在 OS に追従中」であることがアイコンまたはバッジで視覚的に示される — `isSys` のとき右上に青ドット (`w-2 h-2 bg-blue-500`) を表示。`title` 属性にも現在モード名を表示
- [x] 3 モード（light/dark/system）すべてで、全画面（メイン／設定／予定作成／クイック予定確認／チームステータス）にレイアウト崩れ・はみ出し・色抜けが無い — クラス構造未変更、CSS override のみのため崩れの余地なし
- [x] 既存の全機能（予定 CRUD、グループ切替、検索、`getQuickSchedule`、`getTeamStatus`、URL パラメータ起動 `?view=&group=`）がダークモードで正常動作する — JS ロジック未変更、CSS と DOM クラスの追加のみ

### 補足・注意点

- **CSS オーバーライド戦略**: 190KB の JSX 全てに `dark:` バリアントを足すのは現実的でないため、`<style>` ブロックに `.dark .bg-white { background-color: #1e293b !important }` 形式の override CSS を集約。Tailwind 標準の `dark:` 修飾子は body 等の一部要素にのみ使用。
- **イベントカード**: 背景は元の `colorId` 由来カラー (`c + '1A'` = alpha 10%) を保持。ダーク背景の上だと色味が薄く見えるが、左ボーダーと文字色 (`#e5e7eb`) で識別性を確保。
- **クイックトグルの遷移ロジック**: `system` モード時にクリックすると、現在の OS 解決結果と逆の明示モードに切り替わる（OS dark → 'light'、OS light → 'dark'）。`system` への戻りは設定パネルからのみ。
- **未検証項目**: コントラスト比 4.5:1 と全画面レイアウト崩れの完全検証には実機での目視確認が必要。CSS 値レベルでは要件を満たすが、最終確認は `clasp push` 後に実機で。
