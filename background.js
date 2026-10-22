// 效能模式：perfMode（預設 true）決定是否啟用 block_images；block_ads 永遠啟用
async function applyPerfMode() {
  const { perfMode } = await chrome.storage.local.get('perfMode');
  const on = perfMode !== false;
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    on ? { enableRulesetIds: ['block_images'] } : { disableRulesetIds: ['block_images'] }
  );
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background ready.");
  applyPerfMode();
});
chrome.runtime.onStartup.addListener(applyPerfMode);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.perfMode) applyPerfMode();
});

// 接收 content script 發出的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GENERATE_CLICK") {
    console.log("使用者點擊了生成按鈕！");
    // 可以在這裡執行更多邏輯，例如 API 呼叫或資料處理
    sendResponse({ status: "ok", message: "生成動作已觸發" });
  }
});