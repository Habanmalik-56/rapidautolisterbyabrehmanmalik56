// ============================================================
// RAPID LISTER PRO - background.js
// All state stored in chrome.storage.local (survives SW restart)
// ============================================================

let state = {
  activeJob: false,
  totalToCreate: 0,
  createdCount: 0,
  batchSize: 10,
  currentBatchTabs: [],
  listingsData: null,
  completedTabs: 0,
  totalBatchesNeeded: 0,
  currentBatchIndex: 0
};

async function saveState() {
  await chrome.storage.local.set({ bulkState: state });
}

// ============================================================
// SINGLE UNIFIED MESSAGE LISTENER
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessageAsync(message, sender, sendResponse);
  return true;
});

async function handleMessageAsync(message, sender, sendResponse) {
  // Always load latest state from storage first!
  const result = await chrome.storage.local.get("bulkState");
  if (result.bulkState) {
    state = { ...state, ...result.bulkState };
  }

  if (message.action === "START_BULK_LISTING") {
    await startBulkListing(message.data);
    sendResponse({ status: "started" });

  } else if (message.action === "DRAFT_SAVED") {
    await handleDraftSaved(sender.tab.id);
    sendResponse({ status: "acknowledged" });

  } else if (message.action === "GET_MY_PENDING_DATA") {
    const key = `pendingAutofill_${sender.tab.id}`;
    chrome.storage.local.get([key], (result) => {
      sendResponse({ data: result[key] || null });
    });

  } else if (message.action === "GET_STATE") {
    sendResponse(state);

  } else if (message.action === "STOP_BULK_LISTING") {
    await stopBulkListing();
    sendResponse({ status: "stopped" });

  // ---- AI PUBLISH SYSTEM V2 ----
  } else if (message.action === "START_AI_PUBLISH") {
    startAIPublish();
    sendResponse({ status: "started" });

  } else if (message.action === "DRAFT_URLS_COLLECTED") {
    handleDraftUrlsCollected(message.urls, sender.tab.id);
    sendResponse({ status: "ok" });

  } else if (message.action === "PUBLISH_COMPLETE_V2") {
    handlePublishCompleteV2(sender.tab.id, message.success);
    sendResponse({ status: "ok" });

  } else if (message.action === "STOP_AI_PUBLISH") {
    stopAIPublish();
    sendResponse({ status: "stopped" });

  } else if (message.action === "GET_PUBLISH_STATE") {
    chrome.storage.local.get("publishQueue", (result) => {
      sendResponse(result.publishQueue || null);
    });

  } else if (message.action === "CHECK_AUTO_PUBLISH") {
    chrome.storage.local.get("publishQueue", (result) => {
      const queue = result.publishQueue;
      const isPublishTab = !!(queue && queue.running && queue.activeTabId === sender.tab.id);
      console.log("[BG] CHECK_AUTO_PUBLISH tab:", sender.tab.id, "| activeTabId:", queue && queue.activeTabId, "| match:", isPublishTab);
      sendResponse({ isPublishTab });
    });

  // ---- LEGACY (backward compat) ----
  } else if (message.action === "START_BACKGROUND_PUBLISH") {
    console.log("[BG] Legacy START_BACKGROUND_PUBLISH — now using inline V2 mode.");
    sendResponse({ status: "inline_mode" });

  } else if (message.action === "STOP_BACKGROUND_PUBLISH") {
    sendResponse({ status: "stopped" });

  } else if (message.action === "PUBLISH_COMPLETE") {
    sendResponse({ status: "acknowledged" });
  }
}

// ============================================================
// BULK LISTING (Phase 1 — Create Drafts)
// ============================================================
async function startBulkListing(data) {
  state.activeJob = true;
  state.totalToCreate = parseInt(data.numListings) || 1;
  state.createdCount = 0;

  const { images, ...textData } = data;
  state.listingsData = textData;

  state.currentBatchTabs = [];
  state.completedTabs = 0;
  state.currentBatchIndex = 0;
  state.totalBatchesNeeded = Math.ceil(state.totalToCreate / state.batchSize);

  await saveState();
  updateProgress("Starting bulk listing process...", 0);
  await processNextBatch();
}

async function getLocationsList() {
  const result = await chrome.storage.local.get("customLocations");
  if (result.customLocations && Array.isArray(result.customLocations) && result.customLocations.length > 0) {
    return result.customLocations;
  }
  return ["New York, NY"];
}

async function processNextBatch() {
  if (!state.activeJob) return;

  const remaining = state.totalToCreate - state.createdCount;
  if (remaining <= 0) {
    await finishPhase1();
    return;
  }

  const currentBatchSize = Math.min(state.batchSize, remaining);
  state.currentBatchTabs = [];
  state.completedTabs = 0;
  await saveState();

  updateProgress(
    `Opening batch ${state.currentBatchIndex + 1}/${state.totalBatchesNeeded}...`,
    (state.createdCount / state.totalToCreate) * 100
  );

  const locations = await getLocationsList();

  for (let i = 0; i < currentBatchSize; i++) {
    if (!state.activeJob) return;

    const locationIndex = (state.createdCount + i) % locations.length;
    const location = locations[locationIndex];

    const listingPayload = {
      ...state.listingsData,
      location,
      listingIndex: state.createdCount + i
    };

    const tab = await chrome.tabs.create({
      url: "https://www.facebook.com/marketplace/create/item",
      active: false
    });

    state.currentBatchTabs.push(tab.id);
    await saveState();
    const key = `pendingAutofill_${tab.id}`;
    await chrome.storage.local.set({ [key]: listingPayload });
    await sleep(2000);
  }

  chrome.alarms.create("batchTimeout", { delayInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "batchTimeout") {
    if (state.activeJob && state.completedTabs < state.currentBatchTabs.length) {
      updateProgress("Batch timeout. Progressing anyway.", (state.createdCount / state.totalToCreate) * 100);
      handleBatchCompletion();
    }
  }
});

async function handleDraftSaved(tabId) {
  if (!state.activeJob) return;
  if (!state.currentBatchTabs.includes(tabId)) return;

  state.createdCount++;
  state.completedTabs++;
  await saveState();

  updateProgress(
    `Draft saved: ${state.createdCount}/${state.totalToCreate}`,
    (state.createdCount / state.totalToCreate) * 100
  );
  await chrome.storage.local.remove(`pendingAutofill_${tabId}`);

  if (state.completedTabs >= state.currentBatchTabs.length) {
    chrome.alarms.clear("batchTimeout");
    await handleBatchCompletion();
  }
}

async function handleBatchCompletion() {
  state.currentBatchIndex++;
  const remaining = state.totalToCreate - state.createdCount;

  for (const tabId of state.currentBatchTabs) {
    try { await chrome.tabs.remove(tabId); } catch (e) {}
  }
  state.currentBatchTabs = [];
  state.completedTabs = 0;
  await saveState();

  if (remaining > 0) {
    updateProgress(`Batch done. Opening next...`, (state.createdCount / state.totalToCreate) * 100);
    await processNextBatch();
  } else {
    await finishPhase1();
  }
}

async function finishPhase1() {
  updateProgress("✅ All drafts created! Opening selling page to publish...", 100);

  for (const tabId of state.currentBatchTabs) {
    try { await chrome.tabs.remove(tabId); } catch (e) {}
  }

  // Close any remaining create/item tabs
  try {
    const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/marketplace/create/item*" });
    for (const t of tabs) {
      await chrome.tabs.remove(t.id);
    }
  } catch (e) {}

  state.activeJob = false;
  state.currentBatchTabs = [];
  await saveState();

  // Open selling page
  chrome.tabs.create({
    url: "https://www.facebook.com/marketplace/you/selling",
    active: true
  });
}

async function stopBulkListing() {
  state.activeJob = false;
  chrome.alarms.clear("batchTimeout");

  for (const tabId of state.currentBatchTabs) {
    try {
      chrome.tabs.remove(tabId);
      chrome.storage.local.remove(`pendingAutofill_${tabId}`);
    } catch (e) {}
  }
  state.currentBatchTabs = [];
  await saveState();
  updateProgress("Bulk listing stopped.", 0);
}

function updateProgress(message, percent) {
  chrome.storage.local.set({
    lastStatus: {
      message,
      percent,
      active: state.activeJob,
      createdCount: state.createdCount,
      totalToCreate: state.totalToCreate
    }
  });
  chrome.runtime.sendMessage({
    action: "STATUS_UPDATE",
    message,
    percent,
    active: state.activeJob,
    createdCount: state.createdCount,
    totalToCreate: state.totalToCreate
  }).catch(() => {});
}

// ============================================================
// AI PUBLISH SYSTEM V2 — Background Tab Queue
// Each draft opens in a background tab, auto-publishes,
// sends PUBLISH_COMPLETE_V2, then the tab is closed and
// the next draft is opened. No navigation away from selling page!
// ============================================================

async function startAIPublish() {
  console.log("[AI PUBLISH] Starting...");

  // Reset state
  await chrome.storage.local.set({
    publishQueue: {
      running: true,
      collecting: true,
      urls: [],
      currentIndex: 0,
      totalDrafts: 0,
      activeTabId: null,
      sellingTabId: null,
      statusText: "🔍 Opening selling page..."
    }
  });

  // Find existing selling page tab or create one
  const existingTabs = await chrome.tabs.query({ url: "*://*.facebook.com/marketplace/you/selling*" });
  let sellingTabId;

  if (existingTabs.length > 0) {
    sellingTabId = existingTabs[0].id;
    await chrome.tabs.update(sellingTabId, { active: true });
    // Update state with sellingTabId
    await updatePublishQueue({ sellingTabId, statusText: "📋 Collecting drafts..." });
    await sleep(2000);
    sendCollectMessage(sellingTabId);
  } else {
    // Create new selling page tab
    const newTab = await chrome.tabs.create({
      url: "https://www.facebook.com/marketplace/you/selling",
      active: true
    });
    sellingTabId = newTab.id;
    await updatePublishQueue({ sellingTabId, statusText: "⏳ Loading selling page..." });

    // Wait for tab to fully load
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === sellingTabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        sleep(4000).then(() => {
          updatePublishQueue({ statusText: "📋 Collecting drafts..." });
          sendCollectMessage(sellingTabId);
        });
      }
    });
  }
}

function sendCollectMessage(tabId) {
  console.log("[AI PUBLISH] Sending COLLECT_AND_PUBLISH to tab:", tabId);
  chrome.tabs.sendMessage(tabId, { action: "COLLECT_AND_PUBLISH" }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("[AI PUBLISH] Content script not ready, retrying in 3s...");
      // Content script may not be injected yet — retry once
      sleep(3000).then(() => {
        chrome.tabs.sendMessage(tabId, { action: "COLLECT_AND_PUBLISH" }, (res2) => {
          if (chrome.runtime.lastError) {
            console.error("[AI PUBLISH] Failed to reach content script:", chrome.runtime.lastError.message);
            updatePublishQueue({ running: false, collecting: false, statusText: "❌ Could not reach page. Please refresh and try again." });
          }
        });
      });
    }
  });
}

async function handleDraftUrlsCollected(urls, sellingTabId) {
  console.log("[AI PUBLISH] Received", urls.length, "draft URLs from selling page");

  if (urls.length === 0) {
    await chrome.storage.local.set({
      publishQueue: {
        running: false,
        collecting: false,
        statusText: "❌ No drafts found! Save some listings first.",
        urls: [],
        currentIndex: 0,
        totalDrafts: 0,
        activeTabId: null
      }
    });
    return;
  }

  const queue = {
    running: true,
    collecting: false,
    urls,
    currentIndex: 0,
    totalDrafts: urls.length,
    activeTabId: null,
    sellingTabId,
    statusText: `✅ Found ${urls.length} drafts. Starting publish...`
  };
  await chrome.storage.local.set({ publishQueue: queue });

  await sleep(2000);
  await openNextPublishTab();
}

async function openNextPublishTab() {
  const { publishQueue } = await chrome.storage.local.get("publishQueue");
  if (!publishQueue || !publishQueue.running) return;

  if (publishQueue.currentIndex >= publishQueue.urls.length) {
    // All done!
    const doneQueue = {
      ...publishQueue,
      running: false,
      activeTabId: null,
      statusText: `🎉 All ${publishQueue.totalDrafts} drafts published successfully!`
    };
    await chrome.storage.local.set({ publishQueue: doneQueue });
    console.log("[AI PUBLISH] All drafts published!");
    return;
  }

  const url = publishQueue.urls[publishQueue.currentIndex];
  const num = publishQueue.currentIndex + 1;
  const total = publishQueue.totalDrafts;

  publishQueue.statusText = `⏳ Publishing ${num} / ${total}...`;
  publishQueue.activeTabId = null;
  await chrome.storage.local.set({ publishQueue });

  console.log(`[AI PUBLISH] Opening tab ${num}/${total}:`, url);
  const tab = await chrome.tabs.create({ url, active: false });

  publishQueue.activeTabId = tab.id;
  await chrome.storage.local.set({ publishQueue });
}

async function handlePublishCompleteV2(tabId, success) {
  const { publishQueue } = await chrome.storage.local.get("publishQueue");
  if (!publishQueue) return;

  if (publishQueue.activeTabId !== tabId) {
    console.warn("[AI PUBLISH] Tab ID mismatch — ignoring. Expected:", publishQueue.activeTabId, "Got:", tabId);
    return;
  }

  console.log(`[AI PUBLISH] Draft ${publishQueue.currentIndex + 1} complete (success=${success})`);

  // Close the finished tab
  try { await chrome.tabs.remove(tabId); } catch (e) {}

  publishQueue.currentIndex++;
  publishQueue.activeTabId = null;
  await chrome.storage.local.set({ publishQueue });

  // Anti-ban cooldown before opening next
  await sleep(4000);
  await openNextPublishTab();
}

async function stopAIPublish() {
  console.log("[AI PUBLISH] Stopped by user.");
  const { publishQueue } = await chrome.storage.local.get("publishQueue");

  if (publishQueue && publishQueue.activeTabId) {
    try { await chrome.tabs.remove(publishQueue.activeTabId); } catch (e) {}
  }

  await chrome.storage.local.set({
    publishQueue: {
      running: false,
      collecting: false,
      statusText: `⏹ Stopped. (${publishQueue ? publishQueue.currentIndex : 0}/${publishQueue ? publishQueue.totalDrafts : 0} published)`,
      urls: publishQueue ? publishQueue.urls : [],
      currentIndex: publishQueue ? publishQueue.currentIndex : 0,
      totalDrafts: publishQueue ? publishQueue.totalDrafts : 0,
      activeTabId: null
    }
  });
}

// Helper to partially update publishQueue
async function updatePublishQueue(patch) {
  const { publishQueue } = await chrome.storage.local.get("publishQueue");
  const updated = { ...(publishQueue || {}), ...patch };
  await chrome.storage.local.set({ publishQueue: updated });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
