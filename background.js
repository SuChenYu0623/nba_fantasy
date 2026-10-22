chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background ready.");
});

// 接收 content script 發出的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GENERATE_CLICK") {
    console.log("使用者點擊了生成按鈕！");
    // 可以在這裡執行更多邏輯，例如 API 呼叫或資料處理
    sendResponse({ status: "ok", message: "生成動作已觸發" });
  }
});