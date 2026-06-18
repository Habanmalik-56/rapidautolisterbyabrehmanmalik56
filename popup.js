// ============================================================
// RAPID LISTER PRO — popup.js
// ============================================================

// Elements
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanes   = document.querySelectorAll(".tab-pane");

const imageDropzone    = document.getElementById("image-dropzone");
const imageInput       = document.getElementById("image-input");
const imagePreviewGrid = document.getElementById("image-preview-grid");

const titleInput        = document.getElementById("listing-title");
const titleCharCount    = document.getElementById("title-char-count");
const priceInput        = document.getElementById("listing-price");
const qtyInput          = document.getElementById("listing-quantity");
const categorySelect    = document.getElementById("listing-category");
const conditionSelect   = document.getElementById("listing-condition");
const availabilitySelect= document.getElementById("listing-availability");
const descTextarea      = document.getElementById("listing-description");
const descCharCount     = document.getElementById("desc-char-count");
const tagsInput         = document.getElementById("listing-tags");
const numListingsInput  = document.getElementById("num-listings");

const saveDataBtn     = document.getElementById("save-data-btn");
const startListingBtn = document.getElementById("start-listing-btn");
const clearAllBtn     = document.getElementById("clear-all-btn");

const customLocationsText = document.getElementById("custom-locations-text");
const saveLocationsBtn    = document.getElementById("save-locations-btn");

// AI Publish elements
const startAIPublishBtn    = document.getElementById("start-ai-publish-btn");
const stopAIPublishBtn     = document.getElementById("stop-ai-publish-btn");
const popupStatusText      = document.getElementById("popup-status-text");
const popupProgressCounter = document.getElementById("popup-progress-counter");
const popupProgressBar     = document.getElementById("popup-progress-bar");

const statusDot  = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const statusMsg  = document.getElementById("status-msg");

let loadedImages = [];
let publishPollInterval = null;

// ============================================================
// INITIALIZE
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initDragAndDrop();
  initCharCounters();
  loadSavedData();
  loadCustomLocations();
  listenToStatusUpdates();
  checkCurrentJobState();
});

// ============================================================
// TAB SWITCHER
// ============================================================
function initTabs() {
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPane = document.getElementById(btn.dataset.tab);
      if (targetPane) targetPane.classList.add("active");

      if (btn.dataset.tab === "ai-publish") {
        // Refresh publish state whenever user opens AI Publish tab
        updatePublishProgress();
      }
    });
  });
}

// ============================================================
// DRAG & DROP
// ============================================================
function initDragAndDrop() {
  imageDropzone.addEventListener("click", () => imageInput.click());

  imageDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    imageDropzone.classList.add("dragover");
  });

  imageDropzone.addEventListener("dragleave", () => {
    imageDropzone.classList.remove("dragover");
  });

  imageDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    imageDropzone.classList.remove("dragover");
    handleFiles(e.dataTransfer.files);
  });

  imageInput.addEventListener("change", (e) => {
    handleFiles(e.target.files);
  });
}

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      loadedImages.push(e.target.result);
      renderImages();
    };
    reader.readAsDataURL(file);
  });
}

function renderImages() {
  imagePreviewGrid.innerHTML = "";
  loadedImages.forEach((imgSrc, index) => {
    const item = document.createElement("div");
    item.className = "preview-item";
    item.innerHTML = `
      <img src="${imgSrc}" alt="Preview">
      <button class="delete-img-btn" data-index="${index}">&times;</button>
    `;
    imagePreviewGrid.appendChild(item);
  });

  document.querySelectorAll(".delete-img-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.index);
      loadedImages.splice(idx, 1);
      renderImages();
    });
  });
}

// ============================================================
// CHAR COUNTERS
// ============================================================
function initCharCounters() {
  titleInput.addEventListener("input", () => {
    titleCharCount.textContent = titleInput.value.length;
  });
  descTextarea.addEventListener("input", () => {
    descCharCount.textContent = descTextarea.value.length;
  });
}

// ============================================================
// DATA ENTRY BUTTONS
// ============================================================
saveDataBtn.addEventListener("click", async () => {
  const listingData = getFormData();
  await chrome.storage.local.set({ draftListing: listingData });
  showStatus("Success", "Draft listing saved locally!");
});

clearAllBtn.addEventListener("click", async () => {
  titleInput.value       = "";
  priceInput.value       = "";
  qtyInput.value         = "1";
  categorySelect.value   = "";
  conditionSelect.value  = "New";
  availabilitySelect.value = "List as single item";
  descTextarea.value     = "";
  tagsInput.value        = "";
  numListingsInput.value = "1";
  loadedImages           = [];
  titleCharCount.textContent = "0";
  descCharCount.textContent  = "0";
  imagePreviewGrid.innerHTML = "";

  await chrome.storage.local.remove("draftListing");
  showStatus("Idle", "Form and draft cleared.");
});

startListingBtn.addEventListener("click", async () => {
  const data = getFormData();
  if (!data.title || !data.price) {
    showStatus("Error", "Title and Price are required!");
    return;
  }
  if (loadedImages.length === 0) {
    showStatus("Error", "At least one image is required (Facebook first rule)!");
    return;
  }

  chrome.runtime.sendMessage({ action: "START_BULK_LISTING", data }, (response) => {
    if (response && response.status === "started") {
      showStatus("Running", "Bulk listing started...");
    }
  });
});

function getFormData() {
  return {
    title:        titleInput.value,
    price:        priceInput.value,
    quantity:     qtyInput.value,
    category:     categorySelect.value,
    condition:    conditionSelect.value,
    availability: availabilitySelect.value,
    description:  descTextarea.value,
    tags:         tagsInput.value,
    numListings:  numListingsInput.value,
    images:       loadedImages
  };
}

async function loadSavedData() {
  const res = await chrome.storage.local.get("draftListing");
  if (res.draftListing) {
    const data = res.draftListing;
    titleInput.value        = data.title        || "";
    priceInput.value        = data.price        || "";
    qtyInput.value          = data.quantity     || "1";
    categorySelect.value    = data.category     || "";
    conditionSelect.value   = data.condition    || "New";
    availabilitySelect.value= data.availability || "List as single item";
    descTextarea.value      = data.description  || "";
    tagsInput.value         = data.tags         || "";
    numListingsInput.value  = data.numListings  || "1";

    titleCharCount.textContent = titleInput.value.length;
    descCharCount.textContent  = descTextarea.value.length;

    if (data.images) {
      loadedImages = data.images;
      renderImages();
    }
    showStatus("Idle", "Saved draft loaded.");
  }
}

// ============================================================
// LOCATIONS
// ============================================================
async function loadCustomLocations() {
  const result = await chrome.storage.local.get("customLocations");
  if (result.customLocations && Array.isArray(result.customLocations)) {
    customLocationsText.value = result.customLocations.join("\n");
  } else {
    const defaults = ["New York, NY", "Los Angeles, CA", "Chicago, IL"];
    customLocationsText.value = defaults.join("\n");
    await chrome.storage.local.set({ customLocations: defaults });
  }
}

saveLocationsBtn.addEventListener("click", async () => {
  const text = customLocationsText.value.trim();
  const locations = text.split("\n").map(l => l.trim()).filter(Boolean);

  if (locations.length === 0) {
    showStatus("Error", "Please enter at least one location!");
    return;
  }

  await chrome.storage.local.set({ customLocations: locations });
  showStatus("Success", "Custom locations list saved!");
});

// ============================================================
// AI PUBLISH SECTION
// ============================================================

// Start AI Publish
startAIPublishBtn.addEventListener("click", () => {
  showStatus("Running", "AI Publish starting...");
  if (popupStatusText) popupStatusText.textContent = "🚀 Initializing — opening selling page...";

  chrome.runtime.sendMessage({ action: "START_AI_PUBLISH" }, (response) => {
    if (response && response.status === "started") {
      showStatus("Running", "AI Publish started in background!");
      startPublishPolling();
    }
  });
});

// Stop AI Publish
stopAIPublishBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "STOP_AI_PUBLISH" });
  showStatus("Idle", "AI Publish stopped.");
  if (popupStatusText) popupStatusText.textContent = "⏹ Stopped by user.";
  stopPublishPolling();
});

// Start polling for progress
function startPublishPolling() {
  stopPublishPolling();
  updatePublishProgress(); // immediate
  publishPollInterval = setInterval(updatePublishProgress, 1500);
}

// Stop polling
function stopPublishPolling() {
  if (publishPollInterval) {
    clearInterval(publishPollInterval);
    publishPollInterval = null;
  }
}

// Fetch and display publish progress from background
function updatePublishProgress() {
  chrome.runtime.sendMessage({ action: "GET_PUBLISH_STATE" }, (state) => {
    if (!state) return;

    if (popupStatusText) {
      popupStatusText.textContent = state.statusText || "...";
    }

    const total = state.totalDrafts  || 0;
    const done  = state.currentIndex || 0;

    if (popupProgressCounter) {
      popupProgressCounter.textContent = `${done} / ${total}`;
    }
    if (popupProgressBar) {
      const pct = total > 0 ? (done / total) * 100 : 0;
      popupProgressBar.style.width = `${pct}%`;
    }

    // Auto-stop polling when done
    if (!state.running && !state.collecting) {
      stopPublishPolling();
      if (total > 0 && done >= total) {
        showStatus("Success", state.statusText || "All drafts published!");
      } else if (done > 0) {
        showStatus("Idle", state.statusText || "Publish stopped.");
      }
    }
  });
}

// ============================================================
// STATUS BAR
// ============================================================
function showStatus(type, msg) {
  statusText.textContent = type;
  statusMsg.textContent  = msg;

  statusDot.className = "pulsing-dot";
  if (type === "Running")       statusDot.classList.add("running");
  else if (type === "Success")  statusDot.classList.add("success");
  else if (type === "Error")    statusDot.classList.add("error");
  else                          statusDot.classList.add("idle");
}

function listenToStatusUpdates() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "STATUS_UPDATE") {
      const type = message.active ? "Running" : "Idle";
      showStatus(type, message.message);
    }
  });
}

async function checkCurrentJobState() {
  // Check bulk listing (Phase 1) state
  chrome.runtime.sendMessage({ action: "GET_STATE" }, (state) => {
    if (state && state.activeJob) {
      showStatus("Running", `Autofilling: ${state.createdCount}/${state.totalToCreate}`);
    } else {
      chrome.storage.local.get(["lastStatus"], (res) => {
        if (res.lastStatus) {
          const type = res.lastStatus.active ? "Running" : "Idle";
          showStatus(type, res.lastStatus.message);
        }
      });
    }
  });

  // Check AI Publish (Phase 2) state — resume polling if active
  chrome.runtime.sendMessage({ action: "GET_PUBLISH_STATE" }, (state) => {
    if (!state) return;

    if (state.running || state.collecting) {
      // Still running — resume polling
      showStatus("Running", state.statusText || "Publishing...");
      startPublishPolling();
    } else if (state.statusText) {
      // Restore last known status in AI Publish tab
      if (popupStatusText)      popupStatusText.textContent = state.statusText;
      const total = state.totalDrafts  || 0;
      const done  = state.currentIndex || 0;
      if (popupProgressCounter) popupProgressCounter.textContent = `${done} / ${total}`;
      if (popupProgressBar) {
        const pct = total > 0 ? (done / total) * 100 : 0;
        popupProgressBar.style.width = `${pct}%`;
      }
    }
  });
}
