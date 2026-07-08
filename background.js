const runtimePendingData = new Map();

// ============================================================
// SERVICE WORKER KEEP-ALIVE SYSTEM (v2 — PORT BASED)
// ============================================================
// MV3 service workers are auto-terminated by Chrome after ~30s
// of no incoming events. A pending setTimeout does NOT count as
// activity and is silently lost if the worker dies mid-wait.
//
// IMPORTANT CORRECTION: chrome.alarms has a hard-enforced MINIMUM
// period of 1 minute in production — a 20s alarm gets silently
// clamped to 60s by Chrome, so alarms ALONE cannot cover the 30s
// danger window. We fix this properly with a long-lived
// chrome.runtime.Port connection: content scripts open a port and
// ping it every ~15s. Each incoming port message is a real event
// that resets the SW's 30s idle countdown, with no 1-minute floor.
// chrome.alarms is kept ONLY as a 1-minute safety net in case no
// tab/port is currently connected (e.g. between batches).
// ============================================================
const activePorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "listerKeepAlive") return;
  activePorts.add(port);
  console.log("[KeepAlive] Port connected. Active ports:", activePorts.size);

  port.onMessage.addListener((msg) => {
    // Any message received = activity = idle timer reset. No-op needed.
    if (msg && msg.ping) {
      // Optionally ack back so the content script knows the SW is alive.
      try { port.postMessage({ pong: true, t: Date.now() }); } catch (e) {}
    }
  });

  port.onDisconnect.addListener(() => {
    activePorts.delete(port);
    console.log("[KeepAlive] Port disconnected. Active ports:", activePorts.size);
  });
});

// Backup net: fires at most once per minute (Chrome's real floor),
// covers gaps where no content-script tab/port is currently open.
const KEEP_ALIVE_ALARM = "listerKeepAlive";
chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    chrome.storage.local.get("bulkState", () => {
      console.log("[KeepAlive] Alarm backup heartbeat @", new Date().toISOString());
    });
  }
});

let state = {
  activeJob: false,
  totalToCreate: 0,
  createdCount: 0,
  listingsData: null,
  activeFillingTabId: null,
  currentListingIndex: 0
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
    listingsData: textData,
    activeFillingTabId: null,
    currentListingIndex: 0
  };
  await saveState();

  // Content script reads full listing data (incl. images) + location
  // rotation directly from "draftListing" + "customLocations" using the
  // #idx= hash on each navigation — save it once here so it's always
  // fresh, regardless of whether the user pressed "Store Details" first.
  await chrome.storage.local.set({ draftListing: data });

  await openListingTab(0);
}

// ============================================================
// SEQUENTIAL SINGLE-TAB PROCESSING (Phase 1)
// ------------------------------------------------------------
// Only ONE tab is ever open for the whole job, and it is ALWAYS
// the active/selected tab. Chrome's Page Lifecycle "freeze" only
// hits tabs that stay BACKGROUNDED (not the selected tab) for
// 5+ minutes. By reusing the same tab and just navigating its URL
// for each listing (instead of opening several tabs and waiting
// for a turn), no tab is ever backgrounded long enough to freeze —
// so this works identically whether the user is watching or not.
// ============================================================
async function openListingTab(index) {
  if (!state.activeJob) return;

  if (index >= state.totalToCreate) {
    await finishPhase1();
    return;
  }

  state.currentListingIndex = index;
  await saveState();

  updateProgress(
    `Creating listing ${index + 1}/${state.totalToCreate}...`,
    (index / state.totalToCreate) * 100
  );

  const url = `https://www.facebook.com/marketplace/create/item#idx=${index}`;
  console.log(`[Lister Logs] [BG] Navigating to listing ${index}. Tab: ${state.activeFillingTabId || "(new)"}`);

  if (state.activeFillingTabId) {
    try {
      await chrome.tabs.update(state.activeFillingTabId, { url, active: true });
      const tabInfo = await chrome.tabs.get(state.activeFillingTabId);
      try { await chrome.windows.update(tabInfo.windowId, { focused: true }); } catch (e) {}
      return;
    } catch (e) {
      console.warn("[Lister Logs] [BG] Active tab is gone, opening a fresh one:", e.message);
      state.activeFillingTabId = null;
    }
  }

  const tab = await chrome.tabs.create({ url, active: true });
  state.activeFillingTabId = tab.id;
  await saveState();
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
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

  // Ignore stray messages from a tab that is no longer the one we're tracking
  // (e.g. an old tab that hasn't fully unloaded yet).
  if (tabId !== state.activeFillingTabId) {
    console.log(`[Lister Logs] [BG] Ignoring DRAFT_SAVED from stale tab ${tabId} (expected ${state.activeFillingTabId})`);
    return { close: false };
  }

  state.createdCount++;
  console.log(`[Lister Logs] [BG] Draft saved. Total created: ${state.createdCount}/${state.totalToCreate}`);
  await saveState();

  updateProgress(
    `Draft saved: ${state.createdCount}/${state.totalToCreate}`,
    (state.createdCount / state.totalToCreate) * 100
  );

  if (state.createdCount >= state.totalToCreate) {
    await finishPhase1();
    return { close: true };
  }

  // Brief pause, then navigate the SAME tab to the next listing.
  // The tab stays active/selected throughout — it never gets
  // backgrounded, so it never hits Chrome's freeze threshold.
  await sleep(1500);
  await openListingTab(state.createdCount);
  return { stay: true };
}

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const result = await chrome.storage.local.get("bulkState");
  if (result.bulkState) {
    state = { ...state, ...result.bulkState };
  }

  if (state.activeJob && state.activeFillingTabId === tabId) {
    console.log("[BG] Active filling tab closed manually:", tabId, "— retrying listing", state.currentListingIndex, "in a fresh tab.");
    state.activeFillingTabId = null;
    await saveState();
    await openListingTab(state.currentListingIndex);
  }
});

async function finishPhase1() {
  updateProgress("✅ All drafts created! Opening selling page to publish...", 100);

  if (state.activeFillingTabId) {
    try { await chrome.tabs.remove(state.activeFillingTabId); } catch (e) {}
  }

  // Close any remaining create/item tabs
  try {
    const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/marketplace/create/item*" });
    for (const t of tabs) {
      await chrome.tabs.remove(t.id);
    }
  } catch (e) {}

  state.activeJob = false;
  state.activeFillingTabId = null;
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

  if (state.activeFillingTabId) {
    try { chrome.tabs.remove(state.activeFillingTabId); } catch (e) {}
  }
  state.activeFillingTabId = null;
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
