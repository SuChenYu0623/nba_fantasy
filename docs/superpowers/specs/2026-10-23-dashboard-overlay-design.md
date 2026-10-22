# 頁內儀表板 overlay + 效能模式開關 設計文件

日期：2026-10-23
狀態：待審查

## 1. 背景與動機（Why）

目前送出後開出**兩個互不相連的 Blob 分頁**（表格、雷達），和聯盟頁三者分離，失去擴充功能
「就地、即時」的便利；而且已把每週基準存進 storage，卻沒有任何**跨週趨勢**視圖。

本次把輸出改成**在目前 Yahoo 頁面上彈出的全幅覆蓋層（overlay）**，不開新分頁，內含三個
視圖（表格 / 雷達 / 趨勢），並加上結果快取、重新整理、以及一顆「效能模式」圖片封鎖開關。

正規化邏輯（v2：volume-weighted robust z、跨週可比戰力值）**不變**，本案只改「呈現與互動」。

## 2. 目標（Goals）

- **頁內全幅 overlay**（Shadow DOM 隔離）呈現儀表板；**不開新分頁**。
- **三視圖共一 overlay**：
  - **表格**：沿用 v2，補上**好壞色階**（高/低於平均）與**發散 Total 條**（0 為中線、右正左負）。
  - **雷達（保留）**：聚焦 + 比較，照舊。
  - **趨勢（新）**：各隊 **Total 逐週折線**，以**當前基準統一重算**（跨週可比），選隊即高亮。
- **爬蟲只在「送出 / 重新整理」時跑**；開關 overlay、切三視圖都用快取、不重抓。
- **結果存 `chrome.storage.local`**（以 league+week 為 key），頁內跳轉後重開仍在。
- overlay 標頭顯示「**資料時間 X 分鐘前 · 重新整理**」，重抓為明確動作。
- 角落啟動器加 **⚡ 效能模式開關**：只切**圖片封鎖**；狀態存 storage、首次預設 **ON**。

## 3. 非目標 / 反目標（Non-goals / Anti-goals）

- **不**再開新分頁 / Blob 頁（取代既有機制）。
- **不**用 CDN；Chart.js 以本地 `chart.umd.min.js` 併入 content scripts。
- 趨勢**不**做分項（PTS/REB…各自）趨勢，只做各隊 Total 逐週。
- **不**更動 v2 正規化數學與爬取流程。
- 效能模式**只**切圖片封鎖；**廣告/追蹤封鎖（pbs、prebid、oath）維持常開**、不受此開關影響。
- 反目標：開啟 overlay **絕不**悄悄重跑爬蟲。
- 反目標：不把純邏輯綁進 `chrome.*`，保持 Node 可測。

## 4. 已決定的設計（How，已與使用者確認）

### 4.1 UI 結構

- **角落啟動器**（Shadow DOM 常駐）：週次輸入、送出、**效能模式開關**。
- 送出 → 爬蟲 → v2 計分 → 存快取 → **彈出全幅 overlay**（半透明背景 + 中央 sheet + ✕ 關閉）。
- overlay 標頭：標題、League/Week、**「資料時間 X 分鐘前 · 重新整理」**、✕。
- 標頭下：分頁列（表格 / 雷達 / 趨勢）+ 校準提示（沿用 v2 的「已累積 N 週」）。
- overlay 與啟動器皆在 **Shadow DOM**（樣式隔離、極高 z-index）。

### 4.2 頁內渲染（取代 Blob 分頁）

- 把本地 `chart.umd.min.js` 加入 `manifest` 的 `content_scripts.js`（在 content.js 之前），
  使 `Chart` 於 content script 的 isolated world 可用，直接畫到 **Shadow DOM 內的 canvas**。
- 渲染改為把 HTML 塞進 overlay 容器（沿用 `lib/render.js` 產字串的思路，但目標是 Shadow DOM
  節點而非 Blob 文件），再用 Chart.js 綁定影子 canvas。
- `lib/render.js` 的純字串函式續用/調整；DOM 掛載與圖表綁定屬 `content.js`（瀏覽器端）。

### 4.3 爬取、快取與重新整理

- **送出 / 重新整理**：爬蟲 → `scoreWeek`+`rankColumns`（v2）→ 存結果與時間戳 → `updateBaseline`（v2）
  存回 → 渲染。
- **開啟 overlay / 切分頁**：讀快取直接渲染，**不重抓**。
- **結果快取**（`chrome.storage.local`，與 v2 基準分開存）：
  `result:<leagueId>` = `{ [week]: { rows:[{Team, <metric>:原始值, …, <metric>_score, Total, Rank}], ts:<epoch毫秒> }, lastWeek:<n> }`
  - `rows` 同時保留**原始數據**（供趨勢重算）與**當次算好的分數/Total**（供表格秒開、數字與送出當下一致）。
  - 開 overlay 預設顯示 `lastWeek` 的結果。
- **資料時間**：由 `ts` 與現在時間算「X 分鐘前」。

### 4.4 趨勢資料與兩把尺（重要）

- v2 基準（pooled 樣本）**不含隊名與完整 per-team 列**，無法還原逐隊歷史 → 趨勢改由**結果快取**
  取得各週 per-team 原始數據。
- **兩把尺，刻意區分**：
  - **表格 / 雷達**：顯示該週送出當下算好的分數（v2：當週對「先前池」計分）。
  - **趨勢**：對**當前完整基準的量尺**（`poolStats(整季基準)`）**重算每一週每隊的 Total**，使整條折線
    落在同一把尺上、跨週可比。
- 跨週追蹤以**隊名**對應（同賽季通常穩定；中途改名會斷，屬少見邊角）。

### 4.5 效能模式（圖片封鎖開關）

- 把現有 `rules.json` **拆成兩個 ruleset**：
  - `block_images`（圖片 redirect，rule 1）→ **可切換**。
  - `block_ads`（pbs/prebid/oath，rule 10/11/12）→ **永遠啟用**。
- 開關狀態存 `chrome.storage.local`；**background service worker** 以
  `chrome.declarativeNetRequest.updateEnabledRulesets` 啟用/停用 `block_images`。
- **首次預設 ON**（維持現狀「封圖」），之後以使用者最後選擇為準。
- 切換影響「之後」的請求（已載入的圖需重整才變），UI 可小字提示。

## 5. 限制（Constraints）

- MV3、無 build step、原生 JS/CSS；overlay/啟動器用 Shadow DOM。
- Chart.js 併入 content scripts，於 isolated world 畫 Shadow DOM canvas。
- `declarativeNetRequest` 多 ruleset；runtime 以 `updateEnabledRulesets` 切換（權限已具備）。
- `chrome.storage.local` 非同步。
- 沿用 v2 的 `lib/stats.js`（評分/基準）；`lib/render.js` 轉為供頁內渲染。

## 6. 留給 builder 決定的細節

- overlay / 啟動器的精確尺寸、動畫、RWD 斷點。
- 好壞色階的確切色帶與臨界、發散條的縮放與配色。
- 結果快取的確切結構、`result:` 與 v2 `baseline:` 是否共用一個 storage 物件。
- 「X 分鐘前」的格式（剛剛 / N 分鐘 / N 小時 / 日期）。
- 趨勢圖軸範圍、線條樣式、超多隊時的淡顯策略。
- 效能模式切換後是否自動提示/提供「重新整理頁面」。
- 純函式/DOM 掛載的檔案切分（延續 `NbaStats` / `NbaRender`，不引入 build step）。

## 7. 成功樣貌

使用者在 Yahoo 聯盟頁按送出，儀表板**就地彈出**（不跳分頁），表格一眼看出強弱（色階）、Total
可正可負且有發散條、雷達可聚焦比較、趨勢看得到每隊逐週戰力走勢；關掉再開、切分頁都**秒開不重抓**，
需要最新數字才按「重新整理」；想省流量就按「效能模式」關圖，設定被記住。
