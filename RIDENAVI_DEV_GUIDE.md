# RideNavi 開発仕様書

> 調査基準日: 2026-08-28  
> 調査時点: `main` / `965ce81`  
> 対象: リポジトリに存在する追跡対象ファイル一式  
> 方針: 現行ソースで確認できた事実を記録し、確認できない事項は「要確認」とする。APIキー等の値は記載しない。

## 1. Rideナビの目的

RideNaviは、Android・iPhone等のブラウザで動作する、バイク・ツーリング用途を想定したWebナビゲーションアプリである。一般的な地図表示だけでなく、目的地検索、道路タイプ別の経路候補、GPS追従、進行方向表示、交差点案内、音声案内、自動リルート、URL共有を一つの全画面地図UI上で提供する。

開発方針は `DEVELOPMENT_RULES.md` に定義されており、機能数よりも次を優先する。

- 迷わないこと
- 見やすいこと
- 操作が少ないこと
- 走行中でも状況を把握しやすいこと
- スマートフォンやバイク用端末で使いやすいこと

本アプリはビルド工程を持たない静的Webアプリである。`index.html` が `config.js`、`src/map.js`、`app.js` を順に読み込み、`app.js` がGoogle Maps JavaScript APIを動的に読み込んで起動する。

## 2. 現在のファイル構成と役割

### 2.1 実行時に関係するファイル

| ファイル | 現在の役割 | 実行時の使用状況 |
| --- | --- | --- |
| `index.html` | 全画面地図、検索バー、検索候補、目的地シート、経路サマリー、ナビ案内、ナビ情報、現在地ボタン、状態表示、互換用の非表示DOMを定義する。スクリプトとCSSの読込順もここで決まる。 | 使用中 |
| `style.css` | 全画面地図上の固定オーバーレイ、検索候補、ボトムシート、経路ラベル、ナビ案内、セーフエリア、狭幅・横画面レイアウトを定義する。 | 使用中 |
| `app.js` | アプリ本体。地図、Places検索、目的地、施設情報、Directions経路、候補選定、GPS、現在地マーカー、ナビ、音声、自動リルート、共有、初期化を単一IIFE内に実装する。 | 使用中・実装の中心 |
| `config.js` | `window.RIDE_NAVI_CONFIG` を定義し、Google Maps APIキーを `app.js` へ渡す。値そのものは本書に記載しない。 | 使用中 |
| `src/map.js` | `window.RideNaviMap` と `init()` を定義する最小モジュール。読込時ログは出るが、`app.js` から `RideNaviMap.init()` は呼ばれていない。地図本体は `app.js` にある。 | 読み込まれるが、本体機能からは未使用 |
| `manifest.json` | PWA表示名、開始URL、standalone表示、テーマ色、画面方向、アイコン参照を定義する。 | `<link rel="manifest">` で参照中 |
| `icons/ridenavi-bike-marker-v2.png` | 1254×1254、32bit ARGBの画像アセット。 | 現行HTML/CSS/JSからの参照なし |

### 2.2 現時点でプレースホルダーのファイル

次のファイルはコメントのみで、対応機能の実装は入っていない。ファイル名だけを根拠に、機能が分割済みとは判断しないこと。

| ファイル | 内容 |
| --- | --- |
| `src/gps.js` | `// RideNavi GPS Module` のみ。GPS実装は `app.js`。 |
| `src/route.js` | `// RideNavi Route Module` のみ。経路実装は `app.js`。 |
| `src/share.js` | `// RideNavi Share Module` のみ。共有実装は `app.js`。 |
| `src/storage.js` | `// RideNavi Storage Module` のみ。永続保存機能は確認できない。 |
| `src/voice.js` | `// RideNavi Voice Module` のみ。音声実装は `app.js`。 |

### 2.3 開発・説明用ファイル

| ファイル | 役割と注意 |
| --- | --- |
| `DEVELOPMENT_RULES.md` | RideNaviの開発基本ルール。調査・修正前に必ず全文確認する。 |
| `COMPETITOR_RESEARCH_RULES.md` | 競合調査の目的、対象、評価方法、優先度を定義する。競合調査時に使用する。 |
| `README.md` | v1.5.1時点のGPS確認手順。現行画面のバージョンとは一致していない。 |
| `README.txt` | v2.3時点のURL共有説明。現行の共有読込実装とは一部一致しない。 |
| `CHANGELOG.md` | v1.5.1のGPS修正履歴。 |
| `docs/CHANGELOG.md` | v0.1.0 βの開始履歴のみ。 |
| `docs/ROADMAP.md` | v1.4 β時点の計画。URL共有・音声案内が未完了扱いだが、現行 `app.js` には実装があるため古い。 |
| `icons/README.md` | アイコンディレクトリの短い説明のみ。 |
| `RIDENAVI_DEV_GUIDE.md` | 本書。現行実装を調査するときの起点として使用し、変更後は事実に合わせて更新する。 |

### 2.4 存在しない開発基盤

調査時点では `package.json`、自動テスト、サービスワーカー、`.gitignore` は存在しない。外部パッケージのインストールやバンドルは行わず、ブラウザから直接実行する構成である。

## 3. 現在実装されている主要機能

### 3.1 地図表示

- Google Maps JavaScript APIのベクターマップを全画面表示する。
- 初期中心は京都付近、初期ズームは12、最小ズームは7。
- 標準のズーム、地図タイプ、ストリートビュー、全画面ボタンは非表示。
- `gestureHandling: "greedy"` により地図上の直接ジェスチャーを優先する。
- 傾きは0、初期方位は北。ユーザーによる方位・傾き操作は無効。
- 地図ドラッグ時はGPS追従を解除する。
- 地図上のPOIクリック、長押し、互換用の地図選択モードを目的地・経由地設定に利用する。

### 3.2 目的地検索と検索候補

- 入力中は250msのデバウンス後、Places API（New）の `AutocompleteSuggestion.fetchAutocompleteSuggestions()` を呼ぶ。
- 日本語・日本地域に限定し、現在の地図中心または現在地を基準にする。
- 地図範囲を使った `locationRestriction` と `locationBias` の2要求を並行実行し、結果を重複排除する。
- 完全一致、部分一致、距離、元の順位で並べ、最大8件を候補表示する。
- 候補の先頭に「場所を表示」を置き、テキスト検索へ進める。
- キーボードの上下矢印、Enter、Escapeに対応し、ARIAのlistbox/option状態を更新する。
- Enterによるテキスト検索は `Place.searchByText()` を使い、最大10件を取得する。
- テキスト検索結果は候補一覧に出すほか、最大8件を赤いマーカーと名称ラベルで地図上に表示できる。
- 非同期応答は `autocompleteRequestId` で順序を保護し、古い応答が新しい入力を上書きしない。

### 3.3 目的地設定

目的地は次の入口から設定できる。

- オートコンプリート候補の選択
- テキスト検索結果の選択
- 地図上のGoogle POIクリック
- 地図の550ms長押し
- 互換用の地図選択モード（現行の可視UIから操作するボタンはない）

設定時は経路検索をキャンセルし、既存経路を消去して、目的地マーカーと目的地ボトムシートを表示する。検索結果にPlace IDがある場合はPlace IDを経路要求に使用し、座標だけの場合は緯度経度文字列を使用する。

`destinationSelectionId` が、遅れて返った逆ジオコード・施設詳細で新しい目的地を上書きしないための重要な保護となっている。

### 3.4 施設情報表示

Place IDがある目的地では、Places APIから次を取得・表示する。

- 施設名
- 住所
- 主カテゴリ
- 営業状態（閉業、臨時休業、開業前）
- 現在または通常の営業時間から算出した営業中／営業時間外／営業終了
- Google Maps等の帰属表示

営業情報取得に失敗しても、先に取得した施設名・住所・カテゴリは維持する。Place IDのない長押し地点等ではGeocoderによる住所取得のみで、営業時間等は表示しない。

### 3.5 現在地取得と現在地マーカー

- 地図初期化直後に `navigator.geolocation.watchPosition()` を開始する。
- 高精度を要求し、`maximumAge: 3000`、`timeout: 15000` を指定する。
- 初回測位で現在地マーカーと精度円を作成する。
- 現在地マーカーはCanvasで生成した青い矢印で、端末のheadingを優先し、なければ前回位置から方位を算出する。
- 停止中・低速時は方位の微小変化を抑制する。
- 非ナビ時は追従ONなら現在地へパンする。ナビ時は位置と方位を補間アニメーションし、車両位置を画面下寄りに保つ。
- 位置情報拒否、取得不能、タイムアウトを画面状態に表示する。
- 追跡を停止する処理、`watchPosition()` のwatch ID保持・解除処理は確認できない。

### 3.6 地図ズームと方位

- 初期表示: ズーム12、最小7。
- 検索結果1件: ズーム15。
- 複数検索結果: `fitBounds()` 後、最大15に制限。
- 目的地選択: ズーム16。
- 現在地へ移動: ズーム16。
- ナビ開始: スマホ17.5、PC17へアニメーション。
- ルート候補選択: 選択ルートのboundsへ `fitBounds()`。
- ルート全体表示: boundsへ余白28で `fitBounds()`。
- ナビ中のズーム変更時は、現在地を画面下寄りに保つカメラ中心を再計算する。
- 方位ボタンで北上固定と進行方向上を切り替える。ナビ開始時は進行方向上を有効にする。

### 3.7 経路検索と複数経路候補

- Google Directions Serviceを `DRIVING` で利用する。
- 出発地は現行の可視UIでは「現在地」に固定される。
- 互換用DOMと関数には最大5件の経由地処理が残るが、追加・編集UIは `.legacy-controls` 内で非表示。
- 経由地がない場合だけ `provideRouteAlternatives: true` を指定する。
- 交通状況は `departureTime: new Date()` と `BEST_GUESS` を指定し、所要時間は `duration_in_traffic` を優先する。
- 同条件の実行中検索を抑止し、`latestRouteSearchId` で古い応答を破棄する。
- 条件別に最大12件のメモリ内LRU風キャッシュを持つ。永続保存ではなく、再読込で消える。
- API結果を、道路モード適合、簡易署名重複、形状重複、距離倍率、逆方向、基準経路からの乖離、ループ、時間倍率で評価する。
- ほぼ同じ形状は、距離差10%以内かつ相互の経路カバー率90%以上を目安に除外する。
- 基準ルートの1.5倍を超える距離の候補を除外する。
- 採用候補を決定的な順序で並べ、地図上に複数ポリラインと時間・距離ラベルを表示する。
- 選択経路は白縁付き濃紺・太線、未選択経路は青・細線、高速と判定した区間は赤で重ねる。
- 経路線またはラベルを押すと `applyRouteCandidate()` で候補を切り替える。
- 自動通過点を生成する関数群は存在するが、現行 `searchRoute()` は「自動通過点による追加検索は停止中」としており実行しない。実装済み機能として扱わない。

### 3.8 道路モード

道路モードは `local`、`partial`、`highway` の3値で、目的地シート、経路サマリー、非表示の旧selectを同期する。

| モード | API要求と採用条件 |
| --- | --- |
| `local`（一般道／無料ルート） | `avoidTolls: true`。案内文・道路名・警告から有料区間を検出した候補は除外する。無料の高速道路・バイパスは許容し得る。 |
| `partial`（一部有料） | 有料回避なし。有料区間が特定でき、全体の50%以下で、原則として無料ルートより短時間の候補を採用する。琵琶湖大橋を使う候補には例外条件がある。 |
| `highway`（高速道路） | 有料回避なし。有料高速道路の証拠を検出し、最短時間となる候補を高速優先として扱う。その他の適合候補を一部有料へ分類する場合がある。 |

有料／高速の判定はDirectionsの専用料金データではなく、warnings、案内文、強調された道路名、正規表現による推定である。二輪料金も距離ベースの概算で、実料金ではない。

### 3.9 ナビ開始、ナビ中表示、音声案内、自動リルート

- 経路、現在地、案内stepが揃った場合だけナビを開始する。
- ナビ開始時に `body.is-navigating` を付け、検索・目的地・経路サマリーを隠す。
- 進行方向上を有効にし、現在地へのパン、ズーム、方位、追従ONを段階的にアニメーションする。
- Directionsの各stepを `navigationSteps` に変換し、HTML案内文を平文化・日本語調整する。
- 次の操作種別をstraight/left/right/Uターン/roundaboutへ分類し、SVGパスで案内矢印を表示する。
- 案内文から交差点・JCT名を抽出できた場合のみ表示する。
- GPS更新ごとに次案内までの距離、残距離、残時間、到着予定を再計算する。
- step終点35m以内で次stepへ進む。300m以内と80m以内で各1回、Web Speech APIにより日本語音声を読み上げる。
- 目的地周辺では終了音声を読み上げ、ナビを停止する。
- GPS精度50m以下で経路から80m超の状態が2回続き、前回から20秒以上経過すると自動リルートする。
- 自動リルートでは現在地を出発地にし、残っている経由地と選択道路モードを使う。成功時に経路・step・残量表示を置き換える。
- 「ルート全体」は追従を解除してbounds表示にし、「現在地に戻る」で追従とカメラ位置を復元する。
- ナビ終了時はアニメーションを解除し、ナビUIだけでなく表示経路も消去する。

### 3.10 共有機能

- `buildShareUrl()` は出発地 `o`、目的地 `d`、道路モード `mode`、各経由地 `w`、`shared=1` をURLへ格納する。
- 出発地が「現在地」の場合は共有時点の緯度経度へ変換する。
- `navigator.share()` を優先し、非対応時はClipboard API、さらに非対応ならpromptへフォールバックする。
- 起動時の `loadRouteFromUrl()` がURLを読み、`shared=1` の場合は地図初期化後500msで経路検索を試みる。
- ただし現行の読込処理が実際に復元するのは目的地 `d` と道路モード `mode` のみ。出発地 `o` は無視して「現在地」に置換し、経由地 `w` は読み込まず全削除する。共有URLの完全復元は未実装である。

### 3.11 現時点で確認できない／未実装の機能

- ルートや設定の永続保存（`src/storage.js` は空、Storage APIの使用なし）
- オフライン地図・サービスワーカーによるオフライン動作
- 雨雲レーダー、天気情報、ツーリング管理
- 自動生成した通過点による追加ルート探索（関数はあるが停止中）
- 共有URLからの出発地・経由地の復元
- ネイティブGPS・バックグラウンド位置取得・画面ロック制御
- Directions結果以外の専用ナビSDKによる車線案内、速度制限表示等
- 実機走行での精度・安全性。本調査は静的コード調査であり、要確認。

## 4. 各主要機能に関係するファイル・関数

### 4.1 機能依存表

| 機能 | 主なファイル | 主な関数・状態 | 依存先／出力 |
| --- | --- | --- | --- |
| 起動 | `index.html`, `config.js`, `app.js` | `loadGoogleMaps()`, `initMap()` | `window.RIDE_NAVI_CONFIG`, Google Maps JS API |
| 地図 | `index.html`, `style.css`, `app.js` | `initMap()`, `showRouteOverview()`, `centerOnCurrentLocation()` | `google.maps.Map`, `#map` |
| 検索候補 | `index.html`, `style.css`, `app.js` | `scheduleDestinationSuggestions()`, `requestDestinationSuggestions()`, `rankedAutocompleteItems()`, `renderDestinationSuggestions()` | Places Autocomplete、`#destinationSuggestions`、`autocompleteRequestId` |
| テキスト検索 | `app.js` | `searchDestinationByText()`, `textSearchResultItems()`, `showTextSearchResultsOnMap()` | Places Text Search、検索結果Marker/OverlayView |
| 目的地設定 | `app.js` | `selectAutocompletePrediction()`, `selectTextSearchPlace()`, `updateDestinationDetails()`, `clearDestination()` | Place ID/座標、Geocoder、目的地Marker、目的地シート |
| 施設情報 | `app.js` | `loadDestinationPlaceDetails()`, `formatPlaceOpeningStatus()`, `resetDestinationPlaceDetails()` | Places fields、`destinationSelectionId`、施設表示DOM |
| 現在地 | `app.js` | `startGps()`, `updateGps()`, `gpsError()`, `getCurrentLatLng()` | Geolocation API、`currentPosition`、`gpsInfo` |
| 現在地マーカー | `app.js` | `createNavigationArrowIcon()`, `updateLocationMarkerHeading()`, `animateNavigationVisual()` | Canvas、Google Marker/Circle、heading状態 |
| ズーム・追従 | `style.css`, `app.js` | `animateNavigationStartZoom()`, `panToNavigationLocation()`, `setNavigationCameraLocation()`, `showRouteOverview()` | Map camera、`followToggle`、`navigationOverviewActive` |
| 経路要求 | `app.js` | `routeRequest()`, `directionsPromise()`, `searchRoute()` | Directions Service、`latestRouteSearchId`、キャッシュ |
| 道路モード | `index.html`, `app.js` | `syncRouteModeControls()`, `routeTollUsage()`, `routeModeAssessment()` | radio/select、Directions案内文、`selectedRouteMode` |
| 候補評価 | `app.js` | `evaluateRoutePracticality()`, `compareRouteShapes()`, `routeSignature()`, `sortedRouteEntries()` | 候補リスト、診断ログ |
| 候補表示・選択 | `style.css`, `app.js` | `showRouteChoices()`, `applyRouteCandidate()`, `drawRouteOverlays()`, `createRouteLabelsOverlay()` | Polyline/OverlayView、経路サマリー |
| ナビ開始・終了 | `index.html`, `style.css`, `app.js` | `startNavigation()`, `stopNavigation()`, `toggleNavigation()` | `navigationActive`、body class、案内・情報UI |
| 案内表示 | `app.js` | `buildNavigationSteps()`, `updateNavigationGuidance()`, `updateNavigationProgress()` | Directions steps、案内DOM、残量DOM |
| 音声 | `app.js` | `updateVoiceNavigation()`, `speakNavigation()`, `voiceTest()` | Web Speech API、300m/80m通知状態 |
| 自動リルート | `app.js` | `distanceFromRouteMeters()`, `checkAutomaticReroute()`, `rerouteFromCurrentLocation()` | GPS精度、overview path、Directions Service |
| 共有 | `app.js` | `buildShareUrl()`, `shareRouteUrl()`, `loadRouteFromUrl()` | Web Share、Clipboard、URLSearchParams |
| レスポンシブ | `style.css`, `app.js` | CSS media query、`isLandscapeNavigationLayout()`, `syncFloatingLocationButton()` | viewport、orientation、safe-area、body class |

### 4.2 変更時にセットで追うべき状態

- 目的地: `destinationSelectionId`、`destinationInput.dataset.*`、`destinationMarker`、目的地表示DOM、経路状態。
- 検索: `autocompleteRequestId`、`autocompleteTimer`、`autocompleteSessionToken`、候補配列、検索結果Marker/Overlay。
- 経路: `latestRouteSearchId`、`displayedRouteSearchId`、`routeSearching`、`activeRouteSearchKey`、`routeCandidates`、`selectedRouteIndex`、`lastRouteResult`。
- ナビ: `navigationActive`、`navigationSteps`、`currentNavigationStepIndex`、音声通知フラグ、`routePathPoints`、off-route状態、heading状態、追従・overview状態、アニメーションtimer/frame。
- UI: `hidden` 属性、`.visible`、`.active`、`.is-selected`、`body.is-navigating`、`body.is-overview`、ARIA属性。

## 5. 画面構成

画面は `#map` を全面に敷き、固定要素を重ねる構成である。

### 通常時

1. 上部: `#searchBar`
   - 検索アイコン
   - `#destinationInput`
   - クリアボタン
   - 検索候補リスト
2. 中央全面: `#map`
   - 現在地マーカー、精度円
   - 目的地マーカー
   - 検索結果マーカー・名称ラベル
   - 複数経路ポリライン・時間距離ラベル
3. 下部: 状態に応じてどちらか
   - `#destinationPanel`: 施設情報、道路タイプ、経路・ナビ・共有
   - `#routeSummaryPanel`: 選択候補、道路タイプ、料金概算、時間・距離、共有・ナビ
4. 右下: 現在地ボタンと方位ボタン
5. 下部付近: `#status` のトースト表示

### ナビ中

1. 上部: `#navigationGuidance`
   - 方向アイコン
   - 次の操作までの距離
   - 操作種別
   - 抽出できた場合のみ交差点名
2. 左下: `#rideNaviInfoPanel`
   - 残り距離、到着予定、残り時間
   - HTMLに既存要素があるため、`createNavigationInfoPanel()` の動的生成は通常スキップされる
3. 下部: `.navigation-bottom`
   - 目的地名、残量、ルート全体、ナビ終了
4. 右下付近: 方位ボタン、横画面時は現在地／ルート全体切替ボタン
5. 通常時の検索、目的地シート、経路サマリーは非表示

### 非表示の互換DOM

`index.html` の `.legacy-controls` はCSSで非表示だが、`app.js` が多数のIDを直接参照する。出発地、経由地、旧道路モード、交通量、音声テスト等の状態源として残っているため、未使用と判断して削除してはいけない。ID変更も同様に危険である。

## 6. 地図・検索・経路・ナビの処理の流れ

### 6.1 起動から地図表示

1. `config.js` が設定オブジェクトを定義する。
2. `src/map.js` が最小のグローバルを定義するが、本体初期化には使われない。
3. `app.js` がDOM参照・イベントを登録し、共有URLを先に解析する。
4. `loadGoogleMaps()` がAPIキーの存在を確認し、Google Maps JavaScript APIを `v=weekly`、日本語・日本地域で動的読込する。
5. callbackの `initMap()` がMap、DirectionsService、DirectionsRenderer、Geocoder、TrafficLayerを生成する。
6. 地図イベント、ナビ情報、方位ボタンを初期化し、GPS監視を開始する。
7. 共有フラグがあれば500ms後に経路検索を試みる。

### 6.2 検索から目的地設定

1. 入力イベントで過去の選択データを消し、候補要求を予約する。
2. Places候補を地図中心／現在地周辺から取得し、順位付けして表示する。
3. 候補選択時はPlace fieldsを取得する。Enter検索時はText Search結果を一覧または地図へ出す。
4. `updateDestinationDetails()` が古い経路を消し、座標・Place ID・表示名をdatasetへ保存してMarkerとシートを表示する。
5. Place IDありなら施設詳細、なしなら逆ジオコードを非同期取得する。
6. `destinationSelectionId` が一致する応答だけを反映する。

### 6.3 経路検索から候補選択

1. 現在地、目的地、非表示DOM内の経由地、道路モードを読み取る。
2. 同一条件の実行中検索を抑止し、検索IDを更新する。
3. キャッシュがあればAPIを呼ばず候補を復元する。
4. モードに応じて無料ルートと有料利用可能ルートをDirectionsへ並行要求する。
5. 道路モード適合性を判定し、重複・極端な候補を除外する。
6. 優先モード、通常候補優先、時間・距離・形状で並べる。
7. `showRouteChoices()` が候補配列を設定し、先頭を選択する。
8. `applyRouteCandidate()` がDirectionsRenderer、案内step、経路path、サマリー、残量を更新する。
9. `drawRouteOverlays()` が候補線と選択可能なラベルを描く。

### 6.4 ナビ開始から終了

1. `startNavigation()` が経路、現在地、案内stepを検証する。
2. ナビ状態へ切り替え、通常UIを隠し、進行方向上・カメラアニメーション・追従を開始する。
3. GPS更新のたびに次を実行する。
   - headingの取得・補正
   - 現在地Markerと精度円の更新
   - ナビカメラの追従
   - 次案内表示
   - 残距離・残時間・到着予定の更新
   - 300m／80m音声案内とstep進行
   - 経路逸脱判定と必要時の自動リルート
4. 目的地周辺、または終了ボタンで `stopNavigation()` を呼ぶ。
5. アニメーション、ナビ状態、案内UI、表示中経路を解除する。

## 7. 外部API・ライブラリ

### 7.1 Google Maps Platform

| API／機能 | 使用箇所 | 用途 |
| --- | --- | --- |
| Maps JavaScript API | `loadGoogleMaps()`, `initMap()` | 地図、Marker、Circle、Polyline、OverlayView、bounds、カメラ |
| Places API（New） | `autocompletePlacesLibrary()` 以降 | AutocompleteSuggestion、Text Search、Place fields、施設情報 |
| Directions Service | `searchRoute()`, `rerouteFromCurrentLocation()` | 経路、代替候補、steps、時間・距離 |
| Geocoder | `updateDestinationDetails()` | Place IDのない地点の逆ジオコード |
| TrafficLayer | `toggleTrafficLayer()` | 交通量表示。操作UIは現行では非表示 |

APIスクリプトは `v=weekly` を指定しており、固定バージョンではない。API仕様変更の影響を受ける可能性がある。Google Cloud側で必要API、有効な参照元、利用上限、請求設定が正しいかはリポジトリだけでは確認できず、要確認。

### 7.2 ブラウザ標準API

- Geolocation API: 現在地監視
- Web Speech API: 音声案内
- Web Share API: 共有シート
- Clipboard API: 共有URLコピー
- URL / URLSearchParams: 共有URL生成・読込
- Canvas 2D: 現在地矢印画像の生成
- MutationObserver / ResizeObserver: 目的地シートに合わせた現在地ボタン位置調整
- requestAnimationFrame: 現在地・ズーム・パンの補間
- matchMedia: 画面幅、横画面、reduced motion判定

React、Vue、地図ラッパー、CSSフレームワーク、npmライブラリは使用していない。

### 7.3 `config.js` の扱い

- `window.RIDE_NAVI_CONFIG.GOOGLE_MAPS_API_KEY` を定義する。
- `app.js` は未設定・プレースホルダー値を検出すると地図を起動しない。
- 調査時点の `config.js` はGit追跡対象で、非空の値を含む。値は本書へ転載しない。
- ブラウザで使うキーは利用APIと許可ドメインをGoogle Cloud側で必ず制限する。
- キー変更、Cloud設定、請求設定はリポジトリ外の作業であり、本書だけでは確認できない。

## 8. PC/スマホ対応の仕組み

### 8.1 共通

- `meta viewport` は幅を端末幅に合わせ、拡大操作を抑止する設定。
- 地図とアプリ領域は常に幅・高さ100%。bodyスクロールを禁止する。
- UIは固定配置し、`env(safe-area-inset-*)` でノッチ・ホームインジケータを避ける。
- ボタンはタッチ操作を前提に概ね42〜52pxの高さ・幅を確保する。
- 目的地シートの実高さを監視し、右下の現在地ボタンをシート上へ逃がす。

### 8.2 PC／広幅

- `min-width: 700px` で検索バー、ナビ案内、ナビ下部パネルを中央寄せし、最大幅を制限する。
- ナビ開始ズームは17。

### 8.3 スマホ縦画面

- `max-width: 699px` で目的地シートを左右・下端いっぱいのボトムシートにする。
- `max-width: 380px` で文字、余白、候補ラベル、案内アイコン等を縮小する。
- ナビ開始ズームは17.5。

### 8.4 スマホ横画面

- `orientation: landscape` かつ `max-height: 500px` を専用の短辺条件として使う。
- 目的地シートを3列、経路サマリーを4列へ変更し、高さを抑える。
- ナビ案内アイコンと文字を縮小し、ナビ下部を横一列へ近づける。
- 到着予定の3列目と「ルート全体」ボタンを隠す。
- 通常は隠す現在地フローティングボタンを表示し、初回は現在地へ移動、その後は現在地表示とルート全体表示の切替に使う。
- safe-areaの左右も考慮する。

`manifest.json` のorientationは `any` であり、縦・横の両方を許可する。実機のブラウザUI高さ、ソフトキーボード、端末固有safe-areaでの表示は静的調査では確認できず、要確認。

## 9. 修正時に影響を受けやすい箇所

### 9.1 `app.js` の単一ファイル結合

ほぼ全機能が同じIIFE内の共有変数を使う。目的地変更が経路を消し、GPS更新が表示・音声・リルートを同時に動かすため、局所的に見える変更でも下流へ影響しやすい。プレースホルダーの `src/*.js` へ安易に移動してはいけない。

### 9.2 DOM IDと非表示互換要素

`app.js` は起動時にIDで多数の要素を取得する。`.legacy-controls` 内も状態源・イベント対象であり、非表示だからと削除すると経路、共有、経由地、GPS表示等が壊れ得る。HTML変更時はIDの全参照を検索する。

### 9.3 非同期結果の順序保護

- 検索候補: `autocompleteRequestId`
- 施設詳細: `destinationSelectionId`
- 経路: `latestRouteSearchId` / `displayedRouteSearchId` / `activeRouteSearchKey`

これらを外すと、遅い古い応答が新しい目的地・候補・経路を上書きする。

### 9.4 道路モードと経路判定

道路名・案内文の正規表現、料金区間比率、距離倍率、実用性フィルタ、候補順、色分けが結合している。変更時は通常検索だけでなく、候補分類、描画色、料金概算、自動リルートの `avoidTolls` まで追う。

### 9.5 ナビ状態とカメラ

`navigationActive`、追従checkbox、overview状態、heading状態、body class、timer、animation frameが相互依存する。開始、手動地図操作、ルート全体、現在地復帰、終了、目的地到着の全経路で解除漏れを確認する。

### 9.6 CSSと動的注入CSS

主スタイルは `style.css` だが、`createNavigationInfoPanel()` と `createHeadingButton()` は `app.js` 内でstyle要素を生成する。さらに `style.css` が同じIDへ `!important` を指定するため、片方だけの確認では不十分。

### 9.7 共有URL契約

生成側と読込側のパラメータ契約が現在一致していない。共有処理を変更するときは `buildShareUrl()`、`loadRouteFromUrl()`、地図初期化後の自動検索、GPS取得タイミングを一体で確認する。

### 9.8 バージョンとキャッシュ

`index.html` に画面タイトル、CSSクエリ、JSクエリの複数バージョン表記がある。変更時は意図を確認し、通常修正で不要に更新しない。READMEやCHANGELOGの版は現行画面と一致していない。

## 10. 開発時の注意事項

1. 作業前に `DEVELOPMENT_RULES.md` と本書を読む。競合調査なら `COMPETITOR_RESEARCH_RULES.md` も読む。
2. `git status --short --branch` で既存差分を確認し、ユーザーの変更を上書きしない。
3. 対象機能について、入力、イベント、共有状態、非同期処理、Map/UI出力、解除、エラー、下流利用まで追う。
4. `app.js` の関数・状態と `index.html` のID、`style.css` と動的styleをセットで調べる。
5. 目的地・検索・経路の非同期IDガードを維持する。
6. 道路モード、料金判定、ルート選定、ナビ閾値、音声タイミング、自動リルート条件は走行結果へ直結するため、明示依頼なしに変更しない。
7. APIキー、認証情報、個人情報をコード・ログ・文書・回答へ複製しない。
8. 位置情報権限、API拒否、ZERO_RESULTS、候補なし、施設情報失敗、共有キャンセル等の失敗経路を残す。
9. UI変更時はPC、スマホ縦、スマホ横（高さ500px以下）、幅380px以下、safe-area、長い日本語名称を確認する。
10. ナビ変更時は開始、GPS追従、手動ドラッグ、方位切替、ルート全体、現在地復帰、音声、逸脱、リルート失敗、終了を確認する。
11. JavaScript変更時は少なくとも `node --check` を行う。自動テストはないため、ブラウザでの実動作確認が必要。
12. Google Maps、GPS、音声、共有、端末方向はHTTPS・権限・端末差の影響を受ける。未実施の実機確認を完了扱いにしない。
13. コミット、push、デプロイ、Cloud設定変更は明示依頼がある場合だけ行う。
14. 実装を変更した場合、本書の機能状態、依存表、既知問題も事実に合わせて更新する。

## 付録A. 現在のコードで確認した問題・不整合（本調査では未修正）

1. **共有URLの復元が不完全**  
   `buildShareUrl()` は `o` と `w` を生成するが、`loadRouteFromUrl()` は読まず、出発地を現在地へ固定し経由地を削除する。README.txtの「出発地、経由地、目的地を復元」と一致しない。

2. **共有URLの自動検索がGPS取得タイミングに依存**  
   `shared=1` では地図初期化500ms後に1回だけ検索する。読込側が出発地を現在地へ置換するため、その時点でGPS未取得なら検索できず、自動再試行も確認できない。

3. **manifestのアイコン参照先がない**  
   `manifest.json` は `icons/icon-192.png` と `icons/icon-512.png` を参照するが、リポジトリに存在しない。インストール表示への影響は実機で要確認。

4. **機能別モジュールが未分割**  
   `src/gps.js`、`route.js`、`share.js`、`storage.js`、`voice.js` はプレースホルダーで、実装は約18万字の `app.js` に集中する。今回はリファクタリングしない。

5. **`src/map.js` の公開APIが使われていない**  
   ファイルは読み込まれるが、定義した `RideNaviMap.init()` の呼出しはない。地図本体は `app.js` の `initMap()`。

6. **未使用画像アセット**  
   `icons/ridenavi-bike-marker-v2.png` は現行コードから参照されない。現在地マーカーはCanvasで動的生成する。

7. **GPS監視の解除処理がない**  
   `watchPosition()` の戻り値を保持せず、`clearWatch()` も確認できない。ページ存続中は監視継続する設計と見られるが、意図は要確認。

8. **文書とバージョンの不一致**  
   画面タイトルは2.5.20 β、CSSクエリは2.5.19、JSクエリは2.5.20。README、ROADMAP、CHANGELOGも古い版の記述が残る。どれを正式版番号とするか要確認。

9. **PWAはmanifestのみ**  
   サービスワーカーがなく、オフラインキャッシュは実装されていない。manifestアイコンも欠落しているため、standalone指定だけで完全なPWA対応とは扱わない。

10. **APIキー管理の確認が必要**  
    `config.js` はGit追跡対象で非空値を含む。ブラウザ公開キーであっても、Google Cloud側のAPI・参照元制限が適切かは要確認。

11. **自動ルート追加探索用コードは停止状態**  
    自動通過点生成・琵琶湖大橋固定点等の関数は残るが、現行検索フローから実行されない。未使用コードの意図と将来利用は要確認。

12. **自動テスト・依存管理・明示的な検証基盤がない**  
    `package.json` と自動テストがなく、回帰確認は手動ブラウザ・実機確認へ依存する。

## 付録B. 調査時の基礎確認

- Git作業ツリー: 調査開始時はクリーン。
- JavaScript構文: `app.js`、`config.js`、全 `src/*.js` に対して `node --check` 成功。
- DOM ID: `app.js` の静的ID参照は、動的生成される `rideNaviHeadingControl` を除き `index.html` に存在する。
- 本調査での変更: 本書 `RIDENAVI_DEV_GUIDE.md` の新規作成のみ。既存コード、設定、画像、文書は変更していない。
