const runtimePendingData = new Map();

let state = {
  activeJob: false,
  totalToCreate: 0,
  createdCount: 0,
  batchSize: 5,
  currentBatchTabs: [],
  listingsData: null,
  completedTabs: 0,
  totalBatchesNeeded: 0,
  currentBatchIndex: 0,
  batchOpening: false,
  activeFillingTabId: null,
  currentBatchCompletedTabs: [],
  listingQueue: [],
  currentQueueIndex: 0
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
    const res = await handleDraftSaved(sender.tab.id);
    sendResponse(res || { status: "acknowledged" });

  } else if (message.action === "GET_MY_PENDING_DATA") {
    const tabId = sender.tab.id;
    // All tabs get their data immediately — parallel filling (no queue gate)
    const cached = runtimePendingData.get(tabId);
    if (cached) {
      sendResponse({ data: cached });
    } else {
      const key = `pendingAutofill_${tabId}`;
      chrome.storage.local.get([key], (result) => {
        sendResponse({ data: result[key] || null });
      });
    }

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
  } else if (message.action === "BG_SLEEP") {
    setTimeout(() => {
      sendResponse({ status: "done" });
    }, message.ms);
    return true; // Keep message channel open for async response
  }
}

// ============================================================
// BULK LISTING (Phase 1 — Create Drafts)
// ============================================================
// ============================================================
// BULK LISTING (Phase 1 — Create Drafts)
// ============================================================
async function startBulkListing(data) {
  const { images, ...textData } = data;
  state = {
    activeJob: true,
    totalToCreate: parseInt(data.numListings) || 1,
    createdCount: 0,
    assignedCount: 0,
    batchSize: 5,
    currentBatchTabs: [],
    listingsData: textData,
    completedTabs: 0,
    totalBatchesNeeded: 0,
    currentBatchIndex: 0,
    batchOpening: false,
    activeFillingTabId: null,
    currentBatchCompletedTabs: [],
    listingQueue: [],
    currentQueueIndex: 0
  };
  await saveState();

  await startNextBatch();
}

async function startNextBatch() {
  if (!state.activeJob) return;

  state.currentBatchTabs = [];
  state.currentBatchCompletedTabs = [];
  state.listingQueue = [];
  state.currentQueueIndex = 0;
  state.activeFillingTabId = null;
  await saveState();

  const remaining = state.totalToCreate - state.createdCount;
  console.log(`[Lister Logs] [BG] startNextBatch called. Remaining listings: ${remaining}`);
  if (remaining <= 0) {
    await finishPhase1();
    return;
  }

  const batchCount = Math.min(state.batchSize, remaining);
  const locations = await getLocationsList();

  updateProgress(
    `Opening batch of ${batchCount} tabs...`,
    (state.createdCount / state.totalToCreate) * 100
  );

  console.log(`[Lister Logs] [BG] Opening batch of ${batchCount} tabs. Total to create: ${state.totalToCreate}`);
  for (let i = 0; i < batchCount; i++) {
    if (!state.activeJob) return;

    const currentAssignedIndex = state.createdCount + i;
    const locationIndex = currentAssignedIndex % locations.length;
    const location = locations[locationIndex];

    const listingPayload = {
      ...state.listingsData,
      location,
      listingIndex: currentAssignedIndex
    };

    const isActive = (i === 0);
    const tab = await chrome.tabs.create({
      url: `https://www.facebook.com/marketplace/create/item#idx=${currentAssignedIndex}`,
      active: isActive
    });

    state.currentBatchTabs.push(tab.id);
    state.listingQueue.push(listingPayload);

    if (isActive) {
      state.activeFillingTabId = tab.id;
      console.log(`[Lister Logs] [BG] Initial active filling tab set to: ${tab.id} (index 0)`);
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (e) {}
    }

    state.assignedCount++;
    const key = `pendingAutofill_${tab.id}`;
    await chrome.storage.local.set({ [key]: listingPayload });
    runtimePendingData.set(tab.id, listingPayload);
    await saveState();

    await sleep(1500);
  }
}

async function getLocationsList() {
  const result = await chrome.storage.local.get("customLocations");
  if (result.customLocations && Array.isArray(result.customLocations) && result.customLocations.length > 0) {
    return result.customLocations;
  }
  return ["New York, NY"];
}

async function handleDraftSaved(tabId) {
  if (!state.activeJob) return { close: true };

  state.createdCount++;
  console.log(`[Lister Logs] [BG] Draft saved event from tab: ${tabId}. Total created so far: ${state.createdCount}/${state.totalToCreate}`);
  
  if (!state.currentBatchCompletedTabs) {
    state.currentBatchCompletedTabs = [];
  }
  if (!state.currentBatchCompletedTabs.includes(tabId)) {
    state.currentBatchCompletedTabs.push(tabId);
  }
  
  await saveState();

  updateProgress(
    `Draft saved: ${state.createdCount}/${state.totalToCreate}`,
    (state.createdCount / state.totalToCreate) * 100
  );
  await chrome.storage.local.remove(`pendingAutofill_${tabId}`);
  runtimePendingData.delete(tabId);

  // Move to next tab index in queue
  state.currentQueueIndex++;
  await saveState();

  if (state.currentQueueIndex < state.currentBatchTabs.length) {
    // Switch focus to next tab
    const nextTabId = state.currentBatchTabs[state.currentQueueIndex];
    state.activeFillingTabId = nextTabId;
    await saveState();

    console.log(`[Lister Logs] [BG] Activating next tab in queue. Index: ${state.currentQueueIndex}, Tab ID: ${nextTabId}`);
    try {
      await chrome.tabs.update(nextTabId, { active: true });
      const tabInfo = await chrome.tabs.get(nextTabId);
      await chrome.windows.update(tabInfo.windowId, { focused: true });
    } catch (e) {
      console.error("[Lister Logs] [BG] Failed to activate next tab:", nextTabId, e);
    }

    // Wait for tab to come to foreground and React to render the form
    // before sending START_FILLING (critical for background tab fix)
    await sleep(2500);

    // Send START_FILLING message to next tab
    const nextKey = `pendingAutofill_${nextTabId}`;
    chrome.storage.local.get([nextKey], (result) => {
      const payload = result[nextKey];
      if (payload) {
        chrome.tabs.sendMessage(nextTabId, { action: "START_FILLING", data: payload }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn("[BG] START_FILLING message failed:", chrome.runtime.lastError.message);
          } else {
            console.log("[BG] ✅ START_FILLING sent to tab", nextTabId);
          }
        });
      }
    });

    return { stay: true };

  } else {
    // All tabs in this batch have finished! Close them.
    for (const tId of state.currentBatchTabs) {
      try { await chrome.tabs.remove(tId); } catch (e) {}
    }
    state.currentBatchTabs = [];
    state.activeFillingTabId = null;
    await saveState();

    // Small delay to let tabs close cleanly
    await sleep(2000);

    if (state.createdCount < state.totalToCreate) {
      await startNextBatch();
      return { stay: true };
    } else {
      await finishPhase1();
      return { close: true };
    }
  }
}

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const result = await chrome.storage.local.get("bulkState");
  if (result.bulkState) {
    state = { ...state, ...result.bulkState };
  }

  if (state.activeJob && state.currentBatchTabs.includes(tabId)) {
    console.log("[BG] Tab removed manually:", tabId);
    const wasActiveFilling = (state.activeFillingTabId === tabId);
    const index = state.currentBatchTabs.indexOf(tabId);

    state.currentBatchTabs = state.currentBatchTabs.filter(id => id !== tabId);
    if (state.currentBatchCompletedTabs) {
      state.currentBatchCompletedTabs = state.currentBatchCompletedTabs.filter(id => id !== tabId);
    }
    runtimePendingData.delete(tabId);

    if (wasActiveFilling && state.currentBatchTabs.length > 0) {
      const nextIndex = Math.min(index, state.currentBatchTabs.length - 1);
      state.currentQueueIndex = nextIndex;
      const nextTabId = state.currentBatchTabs[nextIndex];
      state.activeFillingTabId = nextTabId;
      await saveState();

      try {
        await chrome.tabs.update(nextTabId, { active: true });
        const tabInfo = await chrome.tabs.get(nextTabId);
        await chrome.windows.update(tabInfo.windowId, { focused: true });
        const nextKey = `pendingAutofill_${nextTabId}`;
        chrome.storage.local.get([nextKey], (res) => {
          if (res[nextKey]) {
            chrome.tabs.sendMessage(nextTabId, { action: "START_FILLING", data: res[nextKey] }, () => {
              if (chrome.runtime.lastError) {}
            });
          }
        });
      } catch (e) {}
    }

    // If tab was closed manually but we still need to create more listings, open a replacement tab!
    if (state.assignedCount < state.totalToCreate) {
      const locations = await getLocationsList();
      const locationIndex = state.assignedCount % locations.length;
      const location = locations[locationIndex];

      const listingPayload = {
        ...state.listingsData,
        location,
        listingIndex: state.assignedCount
      };

      const tab = await chrome.tabs.create({
        url: "https://www.facebook.com/marketplace/create/item",
        active: false
      });

      state.currentBatchTabs.push(tab.id);
      state.listingQueue.push(listingPayload);
      state.assignedCount++;
      await saveState();

      const key = `pendingAutofill_${tab.id}`;
      await chrome.storage.local.set({ [key]: listingPayload });
      runtimePendingData.set(tab.id, listingPayload);
    } else {
      await saveState();
      if (state.currentBatchTabs.length === 0 || state.createdCount >= state.totalToCreate) {
        await finishPhase1();
      }
    }
  }
});

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

  // Find existing selling page and reload it, or create a new one
  try {
    const existing = await chrome.tabs.query({ url: "*://*.facebook.com/marketplace/you/selling*" });
    if (existing.length > 0) {
      const targetTab = existing[0];
      await chrome.tabs.update(targetTab.id, { active: true });
      await chrome.tabs.reload(targetTab.id);
    } else {
      await chrome.tabs.create({
        url: "https://www.facebook.com/marketplace/you/selling",
        active: true
      });
    }
  } catch (e) {
    chrome.tabs.create({
      url: "https://www.facebook.com/marketplace/you/selling",
      active: true
    });
  }
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
