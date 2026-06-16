const LOCATIONS = [
  "New York, NY", "Los Angeles, CA", "Chicago, IL", "Houston, TX", "Phoenix, AZ", 
  "Philadelphia, PA", "San Antonio, TX", "San Diego, CA", "Dallas, TX", "San Jose, CA", 
  "Austin, TX", "Jacksonville, FL", "Fort Worth, TX", "Columbus, OH", "Charlotte, NC", 
  "Indianapolis, IN", "San Francisco, CA", "Seattle, WA", "Denver, CO", "Washington, DC", 
  "Boston, MA", "El Paso, TX", "Nashville, TN", "Detroit, MI", "Oklahoma City, OK", 
  "Portland, OR", "Las Vegas, NV", "Louisville, KY", "Baltimore, MD", "Milwaukee, WI", 
  "Albuquerque, NM", "Tucson, AZ", "Fresno, CA", "Sacramento, CA", "Mesa, AZ", 
  "Kansas City, MO", "Atlanta, GA", "Long Beach, CA", "Colorado Springs, CO", "Raleigh, NC"
];

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
  }
  return true;
});

async function startBulkListing(data) {
  state.activeJob = true;
  state.totalToCreate = parseInt(data.numListings) || 1;
  state.createdCount = 0;
  state.listingsData = data;
  state.currentBatchTabs = [];
  state.completedTabs = 0;
  state.currentBatchIndex = 0;
  state.totalBatchesNeeded = Math.ceil(state.totalToCreate / state.batchSize);

  updateProgress("Starting bulk listing process...", 0);
  await processNextBatch();
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

  for (let i = 0; i < currentBatchSize; i++) {
    if (!state.activeJob) return;
    
    const locationIndex = (state.createdCount + i) % LOCATIONS.length;
    const location = LOCATIONS[locationIndex];

    // Create a unique listing data payload with location
    const listingPayload = {
      ...state.listingsData,
      location: location,
      listingIndex: state.createdCount + i
    };

    // Store listing payload for the tab to pick up
    // We can store key-value pair of tabId to payload in storage
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
  
  if (remaining > 0) {
    updateProgress(`Batch completed. Pausing for 30 seconds before next batch...`, (state.createdCount / state.totalToCreate) * 100);
    
    // Close the completed tabs in this batch
    for (const tabId of state.currentBatchTabs) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (e) {
        // Tab might already be closed
      }
    }
    state.currentBatchTabs = [];

    // Wait 30 seconds between batches
    await sleep(30000);
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

  state.activeJob = false;
  
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
