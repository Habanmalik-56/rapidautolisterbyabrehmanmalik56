// ============================================================
// RAPID LISTER PRO - background.js (Complete Rewrite)
// All publish state stored in chrome.storage.local
// so it SURVIVES service worker restarts
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

// ============================================================
// MESSAGE LISTENER
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === "START_BULK_LISTING") {
    startBulkListing(message.data);
    sendResponse({ status: "started" });

  } else if (message.action === "DRAFT_SAVED") {
    handleDraftSaved(sender.tab.id);
    sendResponse({ status: "acknowledged" });

  } else if (message.action === "GET_MY_PENDING_DATA") {
    const key = `pendingAutofill_${sender.tab.id}`;
    chrome.storage.local.get([key], (result) => {
      sendResponse({ data: result[key] || null });
    });
    return true;

  } else if (message.action === "GET_STATE") {
    sendResponse(state);

  } else if (message.action === "STOP_BULK_LISTING") {
    stopBulkListing();
    sendResponse({ status: "stopped" });

  // ---- PUBLISH SYSTEM ----
  } else if (message.action === "START_BACKGROUND_PUBLISH") {
    startBackgroundPublish(message.urls);
    sendResponse({ status: "started" });

  } else if (message.action === "CHECK_AUTO_PUBLISH") {
    // READ FROM STORAGE (not memory!) so it survives SW restart
    chrome.storage.local.get("publishQueue", (result) => {
      const queue = result.publishQueue;
      const isPublishTab = !!(queue && queue.running && queue.activeTabId === sender.tab.id);
      console.log("[BG] CHECK_AUTO_PUBLISH for tab", sender.tab.id, "| activeTabId:", queue && queue.activeTabId, "| isPublishTab:", isPublishTab);
      sendResponse({ isPublishTab });
    });
    return true; // async

  } else if (message.action === "PUBLISH_COMPLETE") {
    handlePublishComplete(sender.tab.id, message.success);
    sendResponse({ status: "acknowledged" });

  } else if (message.action === "STOP_BACKGROUND_PUBLISH") {
    stopBackgroundPublish();
    sendResponse({ status: "stopped" });
  }

  return true;
});

// ============================================================
// BULK LISTING SYSTEM (Phase 1 - Create Drafts)
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
    finishPhase1();
    return;
  }

  const currentBatchSize = Math.min(state.batchSize, remaining);
  state.currentBatchTabs = [];
  state.completedTabs = 0;

  updateProgress(`Opening batch ${state.currentBatchIndex + 1}/${state.totalBatchesNeeded}...`, (state.createdCount / state.totalToCreate) * 100);

  const locations = await getLocationsList();

  for (let i = 0; i < currentBatchSize; i++) {
    if (!state.activeJob) return;

    const locationIndex = (state.createdCount + i) % locations.length;
    const location = locations[locationIndex];

    const listingPayload = {
      ...state.listingsData,
      location: location,
      listingIndex: state.createdCount + i
    };

    const tab = await chrome.tabs.create({
      url: "https://www.facebook.com/marketplace/create/item",
      active: false
    });

    state.currentBatchTabs.push(tab.id);

    const key = `pendingAutofill_${tab.id}`;
    await chrome.storage.local.set({ [key]: listingPayload });

    await sleep(2000);
  }

  chrome.alarms.create("batchTimeout", { delayInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "batchTimeout") {
    if (state.activeJob && state.completedTabs < state.currentBatchTabs.length) {
      updateProgress("Batch timeout reached. Progressing anyway.", (state.createdCount / state.totalToCreate) * 100);
      handleBatchCompletion();
    }
  }
});

async function handleDraftSaved(tabId) {
  if (!state.activeJob) return;
  if (!state.currentBatchTabs.includes(tabId)) return;

  state.createdCount++;
  state.completedTabs++;

  updateProgress(`Draft saved: ${state.createdCount}/${state.totalToCreate}`, (state.createdCount / state.totalToCreate) * 100);
  await chrome.storage.local.remove(`pendingAutofill_${tabId}`);

  if (state.completedTabs >= state.currentBatchTabs.length) {
    chrome.alarms.clear("batchTimeout");
    handleBatchCompletion();
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

  if (remaining > 0) {
    updateProgress(`Batch done. Opening next...`, (state.createdCount / state.totalToCreate) * 100);
    await processNextBatch();
  } else {
    finishPhase1();
  }
}

async function finishPhase1() {
  updateProgress("All drafts created! Go to Selling page to publish.", 100);

  for (const tabId of state.currentBatchTabs) {
    try { await chrome.tabs.remove(tabId); } catch (e) {}
  }

  try {
    const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/marketplace/create/item*" });
    for (const t of tabs) {
      await chrome.tabs.remove(t.id);
    }
  } catch (e) {}

  state.activeJob = false;
  state.currentBatchTabs = [];

  chrome.tabs.create({
    url: "https://www.facebook.com/marketplace/you/selling",
    active: true
  });
}

function stopBulkListing() {
  state.activeJob = false;
  chrome.alarms.clear("batchTimeout");

  for (const tabId of state.currentBatchTabs) {
    try {
      chrome.tabs.remove(tabId);
      chrome.storage.local.remove(`pendingAutofill_${tabId}`);
    } catch (e) {}
  }
  state.currentBatchTabs = [];
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// BACKGROUND PUBLISH SYSTEM (Phase 2)
// ALL state stored in chrome.storage.local["publishQueue"]
// This SURVIVES Chrome service worker restarts!
// ============================================================

async function startBackgroundPublish(urls) {
  console.log("[BG] startBackgroundPublish with", urls.length, "URLs");

  const queue = {
    running: true,
    urls: urls,
    currentIndex: 0,
    totalDrafts: urls.length,
    activeTabId: null,
    doneCount: 0
  };

  await chrome.storage.local.set({
    publishQueue: queue,
    autoPublishState: {
      active: true,
      running: true,
      totalDrafts: urls.length,
      currentIndex: 0,
      statusText: `Found ${urls.length} drafts. Starting...`
    }
  });

  await launchNextPublishTab();
}

async function launchNextPublishTab() {
  const result = await chrome.storage.local.get("publishQueue");
  const queue = result.publishQueue;

  if (!queue || !queue.running) {
    console.log("[BG] launchNextPublishTab: queue not running, stopping.");
    return;
  }

  if (queue.currentIndex >= queue.totalDrafts) {
    await finishBackgroundPublish();
    return;
  }

  const url = queue.urls[queue.currentIndex];
  const nextIndex = queue.currentIndex + 1;

  console.log("[BG] Opening draft", nextIndex, "/", queue.totalDrafts, "->", url);

  const tab = await chrome.tabs.create({ url: url, active: true });

  queue.currentIndex = nextIndex;
  queue.activeTabId = tab.id;

  await chrome.storage.local.set({
    publishQueue: queue,
    autoPublishState: {
      active: true,
      running: true,
      totalDrafts: queue.totalDrafts,
      currentIndex: queue.doneCount,
      statusText: `Publishing draft ${nextIndex} / ${queue.totalDrafts}...`
    }
  });

  console.log("[BG] Tab", tab.id, "opened for draft", nextIndex);
}

async function handlePublishComplete(tabId, success) {
  console.log("[BG] handlePublishComplete tab:", tabId, "success:", success);

  const result = await chrome.storage.local.get("publishQueue");
  const queue = result.publishQueue;

  if (!queue) { console.log("[BG] No queue found."); return; }
  if (queue.activeTabId !== tabId) {
    console.log("[BG] Tab ID mismatch. Expected:", queue.activeTabId, "Got:", tabId);
    return;
  }

  // Close the finished tab
  try { await chrome.tabs.remove(tabId); } catch (e) {}

  queue.activeTabId = null;
  queue.doneCount = (queue.doneCount || 0) + 1;

  const statusText = success
    ? `Published ${queue.doneCount}/${queue.totalDrafts} ✅`
    : `Draft ${queue.doneCount} had an error, continuing...`;

  await chrome.storage.local.set({
    publishQueue: queue,
    autoPublishState: {
      active: true,
      running: true,
      totalDrafts: queue.totalDrafts,
      currentIndex: queue.doneCount,
      statusText: statusText
    }
  });

  if (queue.currentIndex >= queue.totalDrafts) {
    await finishBackgroundPublish();
  } else {
    await sleep(3000); // 3 second anti-ban cooldown
    await launchNextPublishTab();
  }
}

async function stopBackgroundPublish() {
  console.log("[BG] Stopping background publish...");

  const result = await chrome.storage.local.get("publishQueue");
  const queue = result.publishQueue;

  if (queue && queue.activeTabId) {
    try { await chrome.tabs.remove(queue.activeTabId); } catch (e) {}
  }

  await chrome.storage.local.set({
    publishQueue: { running: false, activeTabId: null },
    autoPublishState: {
      active: false,
      running: false,
      statusText: "Stopped"
    }
  });
}

async function finishBackgroundPublish() {
  console.log("[BG] All drafts published!");

  const result = await chrome.storage.local.get("publishQueue");
  const queue = result.publishQueue || {};

  await chrome.storage.local.set({
    publishQueue: { running: false, activeTabId: null },
    autoPublishState: {
      active: true,
      running: false,
      totalDrafts: queue.totalDrafts || 0,
      currentIndex: queue.totalDrafts || 0,
      statusText: "ALL DRAFTS PUBLISHED! ✅"
    }
  });

  chrome.runtime.sendMessage({ action: "BACKGROUND_PUBLISH_FINISHED" }).catch(() => {});
}
