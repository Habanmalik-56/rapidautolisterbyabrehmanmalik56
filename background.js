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

// Listen for messages from popup and content scripts
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
    return true; // async response
  } else if (message.action === "GET_STATE") {
    sendResponse(state);
  } else if (message.action === "STOP_BULK_LISTING") {
    stopBulkListing();
    sendResponse({ status: "stopped" });
  } else if (message.action === "START_BACKGROUND_PUBLISH") {
    startBackgroundPublish(message.urls);
    sendResponse({ status: "started" });
  } else if (message.action === "CHECK_AUTO_PUBLISH") {
    const isPublishTab = publishState.active && publishState.running && publishState.activeTabs[sender.tab.id];
    sendResponse({ isPublishTab: !!isPublishTab });
  } else if (message.action === "PUBLISH_COMPLETE") {
    handlePublishComplete(sender.tab.id, message.success);
    sendResponse({ status: "acknowledged" });
  } else if (message.action === "STOP_BACKGROUND_PUBLISH") {
    stopBackgroundPublish();
    sendResponse({ status: "stopped" });
  }
  return true;
});

async function startBulkListing(data) {
  state.activeJob = true;
  state.totalToCreate = parseInt(data.numListings) || 1;
  state.createdCount = 0;
  
  // Strip images from background state to prevent QuotaExceededError in chrome.storage.local
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
  return ["New York, NY"]; // fallback
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

    // Create a unique listing data payload with location
    const listingPayload = {
      ...state.listingsData,
      location: location,
      listingIndex: state.createdCount + i
    };

    // Store listing payload for the tab to pick up
    const tab = await chrome.tabs.create({
      url: "https://www.facebook.com/marketplace/create/item",
      active: false // background tabs for performance & memory
    });

    state.currentBatchTabs.push(tab.id);

    // Save pending listing details for this tab ID
    const key = `pendingAutofill_${tab.id}`;
    await chrome.storage.local.set({ [key]: listingPayload });

    // 2-second delay between opening tabs
    await sleep(2000);
  }

  // Setup timeout alarm to prevent getting stuck if tab crashes
  chrome.alarms.create("batchTimeout", { delayInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "batchTimeout") {
    // If we get stuck, force move to next batch
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

  updateProgress(`Listings draft saved: ${state.createdCount}/${state.totalToCreate}`, (state.createdCount / state.totalToCreate) * 100);

  // Clean up storage for this tab
  await chrome.storage.local.remove(`pendingAutofill_${tabId}`);

  // Check if current batch is fully done
  if (state.completedTabs >= state.currentBatchTabs.length) {
    chrome.alarms.clear("batchTimeout");
    handleBatchCompletion();
  }
}

async function handleBatchCompletion() {
  state.currentBatchIndex++;
  const remaining = state.totalToCreate - state.createdCount;
  
  // Close all current batch tabs
  for (const tabId of state.currentBatchTabs) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (e) {}
  }
  state.currentBatchTabs = [];
  state.completedTabs = 0;

  if (remaining > 0) {
    updateProgress(`Batch completed. Opening tabs for next listings...`, (state.createdCount / state.totalToCreate) * 100);
    await processNextBatch();
  } else {
    finishPhase1();
  }
}

async function finishPhase1() {
  updateProgress("All drafts created! Transitioning to Selling page for auto-publish...", 100);
  
  // Close batch tabs
  for (const tabId of state.currentBatchTabs) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (e) {}
  }

  // Double check and close any remaining Facebook create/item tabs that might be open
  try {
    const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/marketplace/create/item*" });
    for (const t of tabs) {
      await chrome.tabs.remove(t.id);
    }
  } catch (e) {}

  state.activeJob = false;
  state.currentBatchTabs = [];
  
  // Open the selling page to initiate Phase 2
  chrome.tabs.create({
    url: "https://www.facebook.com/marketplace/you/selling",
    active: true
  });
}

function stopBulkListing() {
  state.activeJob = false;
  chrome.alarms.clear("batchTimeout");
  
  // Close any active batch tabs
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
      message: message,
      percent: percent,
      active: state.activeJob,
      createdCount: state.createdCount,
      totalToCreate: state.totalToCreate
    }
  });
  // Notify runtime listeners
  chrome.runtime.sendMessage({
    action: "STATUS_UPDATE",
    message: message,
    percent: percent,
    active: state.activeJob,
    createdCount: state.createdCount,
    totalToCreate: state.totalToCreate
  }).catch(() => {}); // Ignore error if popup closed
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let publishState = {
  active: false,
  running: false,
  urls: [],
  currentIndex: 0,
  totalDrafts: 0,
  activeTabs: {}, // tabId -> true
  maxConcurrentTabs: 3
};

async function startBackgroundPublish(urls) {
  publishState.active = true;
  publishState.running = true;
  publishState.urls = urls;
  publishState.currentIndex = 0;
  publishState.totalDrafts = urls.length;
  publishState.activeTabs = {};

  updatePublishStatus("Background publishing started...", 0);
  await launchNextPublishTabs();
}

async function launchNextPublishTabs() {
  if (!publishState.active || !publishState.running) return;

  const activeCount = Object.keys(publishState.activeTabs).length;
  const needed = publishState.maxConcurrentTabs - activeCount;

  for (let i = 0; i < needed; i++) {
    if (publishState.currentIndex >= publishState.totalDrafts) {
      break;
    }

    const url = publishState.urls[publishState.currentIndex];
    publishState.currentIndex++;

    const tab = await chrome.tabs.create({
      url: url,
      active: false
    });

    publishState.activeTabs[tab.id] = true;
    updatePublishStatus(`Publishing draft ${publishState.currentIndex}/${publishState.totalDrafts}`, (publishState.currentIndex / publishState.totalDrafts) * 100);
    
    await sleep(2500); // 2.5 seconds delay between opening tabs to avoid spamming
  }

  if (Object.keys(publishState.activeTabs).length === 0 && publishState.currentIndex >= publishState.totalDrafts) {
    finishBackgroundPublish();
  }
}

async function handlePublishComplete(tabId, success) {
  if (!publishState.activeTabs[tabId]) return;

  delete publishState.activeTabs[tabId];

  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {}

  const stateToSave = {
    active: publishState.active,
    running: publishState.running,
    totalDrafts: publishState.totalDrafts,
    currentIndex: publishState.totalDrafts - (publishState.urls.length - publishState.currentIndex) - Object.keys(publishState.activeTabs).length,
    statusText: `Published last item ${success ? 'successfully' : 'with error'}.`
  };
  chrome.storage.local.set({ autoPublishState: stateToSave });

  await sleep(1000);
  await launchNextPublishTabs();
}

function stopBackgroundPublish() {
  publishState.running = false;
  publishState.active = false;
  
  for (const tabIdStr of Object.keys(publishState.activeTabs)) {
    const tabId = parseInt(tabIdStr);
    try {
      chrome.tabs.remove(tabId);
    } catch (e) {}
  }
  publishState.activeTabs = {};
  
  chrome.storage.local.set({
    autoPublishState: {
      active: false,
      running: false,
      statusText: "Stopped"
    }
  });
}

function finishBackgroundPublish() {
  publishState.active = false;
  publishState.running = false;
  
  chrome.storage.local.set({
    autoPublishState: {
      active: true,
      running: false,
      statusText: "ALL DRAFTS PUBLISHED!",
      currentIndex: publishState.totalDrafts,
      totalDrafts: publishState.totalDrafts
    }
  });
  
  chrome.runtime.sendMessage({ action: "BACKGROUND_PUBLISH_FINISHED" }).catch(() => {});
}

function updatePublishStatus(statusText, percent) {
  const stateToSave = {
    active: publishState.active,
    running: publishState.running,
    totalDrafts: publishState.totalDrafts,
    currentIndex: publishState.currentIndex - Object.keys(publishState.activeTabs).length,
    statusText: statusText
  };
  chrome.storage.local.set({ autoPublishState: stateToSave });
}
