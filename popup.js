// Elements
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanes = document.querySelectorAll(".tab-pane");

const imageDropzone = document.getElementById("image-dropzone");
const imageInput = document.getElementById("image-input");
const imagePreviewGrid = document.getElementById("image-preview-grid");

const titleInput = document.getElementById("listing-title");
const titleCharCount = document.getElementById("title-char-count");
const priceInput = document.getElementById("listing-price");
const qtyInput = document.getElementById("listing-quantity");
const categorySelect = document.getElementById("listing-category");
const conditionSelect = document.getElementById("listing-condition");
const availabilitySelect = document.getElementById("listing-availability");
const descTextarea = document.getElementById("listing-description");
const descCharCount = document.getElementById("desc-char-count");
const tagsInput = document.getElementById("listing-tags");
const numListingsInput = document.getElementById("num-listings");

const saveDataBtn = document.getElementById("save-data-btn");
const startListingBtn = document.getElementById("start-listing-btn");
const clearAllBtn = document.getElementById("clear-all-btn");

const detectDraftsBtn = document.getElementById("detect-drafts-btn");
const draftsList = document.getElementById("drafts-list");

const customLocationsText = document.getElementById("custom-locations-text");
const saveLocationsBtn = document.getElementById("save-locations-btn");

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const statusMsg = document.getElementById("status-msg");

let loadedImages = []; // base64 images

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initDragAndDrop();
  initCharCounters();
  loadSavedData();
  loadCustomLocations();
  listenToStatusUpdates();
  checkCurrentJobState();
});

// Tab Switcher
function initTabs() {
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));
      
      btn.classList.add("active");
      const targetPane = document.getElementById(btn.dataset.tab);
      if (targetPane) targetPane.classList.add("active");

      if (btn.dataset.tab === "draft-opener") {
        loadDraftsList();
      }
    });
  });
}

// Drag & Drop
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

  // Attach delete events
  document.querySelectorAll(".delete-img-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.index);
      loadedImages.splice(idx, 1);
      renderImages();
    });
  });
}

// Char Counters
function initCharCounters() {
  titleInput.addEventListener("input", () => {
    titleCharCount.textContent = titleInput.value.length;
  });
  descTextarea.addEventListener("input", () => {
    descCharCount.textContent = descTextarea.value.length;
  });
}

// Save Data Button
saveDataBtn.addEventListener("click", async () => {
  const listingData = getFormData();
  await chrome.storage.local.set({ draftListing: listingData });
  showStatus("Success", "Draft listing saved locally!");
});

// Clear All Button
clearAllBtn.addEventListener("click", async () => {
  titleInput.value = "";
  priceInput.value = "";
  qtyInput.value = "1";
  categorySelect.value = "";
  conditionSelect.value = "New";
  availabilitySelect.value = "List as single item";
  descTextarea.value = "";
  tagsInput.value = "";
  numListingsInput.value = "1";
  loadedImages = [];
  titleCharCount.textContent = "0";
  descCharCount.textContent = "0";
  imagePreviewGrid.innerHTML = "";
  
  await chrome.storage.local.remove("draftListing");
  showStatus("Idle", "Form and draft cleared.");
});

// Start Bulk Listing Button
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

  // Trigger background bulk lister
  chrome.runtime.sendMessage({
    action: "START_BULK_LISTING",
    data: data
  }, (response) => {
    if (response && response.status === "started") {
      showStatus("Running", "Bulk listing started...");
    }
  });
});

function getFormData() {
  return {
    title: titleInput.value,
    price: priceInput.value,
    quantity: qtyInput.value,
    category: categorySelect.value,
    condition: conditionSelect.value,
    availability: availabilitySelect.value,
    description: descTextarea.value,
    tags: tagsInput.value,
    numListings: numListingsInput.value,
    images: loadedImages
  };
}

async function loadSavedData() {
  const res = await chrome.storage.local.get("draftListing");
  if (res.draftListing) {
    const data = res.draftListing;
    titleInput.value = data.title || "";
    priceInput.value = data.price || "";
    qtyInput.value = data.quantity || "1";
    categorySelect.value = data.category || "";
    conditionSelect.value = data.condition || "New";
    availabilitySelect.value = data.availability || "List as single item";
    descTextarea.value = data.description || "";
    tagsInput.value = data.tags || "";
    numListingsInput.value = data.numListings || "1";
    
    titleCharCount.textContent = titleInput.value.length;
    descCharCount.textContent = descTextarea.value.length;
    
    if (data.images) {
      loadedImages = data.images;
      renderImages();
    }
    showStatus("Idle", "Saved draft loaded.");
  }
}

// Draft List Pane
detectDraftsBtn.addEventListener("click", () => loadDraftsList());

async function loadDraftsList() {
  draftsList.innerHTML = "";
  const res = await chrome.storage.local.get("draftListing");
  if (res.draftListing) {
    const data = res.draftListing;
    const li = document.createElement("li");
    li.className = "draft-item";
    li.innerHTML = `
      <div class="draft-info">
        <div class="draft-title">${data.title || "Untitled Listing"}</div>
        <div class="draft-meta">$${data.price || "0"} - ${data.category || "No category"}</div>
      </div>
      <button class="btn btn-outline-cyan btn-sm resume-draft-btn">Resume</button>
    `;
    draftsList.appendChild(li);

    li.querySelector(".resume-draft-btn").addEventListener("click", () => {
      loadSavedData();
      // Switch back to data entry tab
      document.querySelector('[data-tab="data-entry"]').click();
    });
  } else {
    draftsList.innerHTML = `<li class="empty-state">No drafts found.</li>`;
  }
}

// Locations Pane
async function loadCustomLocations() {
  const result = await chrome.storage.local.get("customLocations");
  if (result.customLocations && Array.isArray(result.customLocations)) {
    customLocationsText.value = result.customLocations.join("\n");
  } else {
    // Populate with a clean default list if nothing is saved
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

// Status and Messages updates
function showStatus(type, msg) {
  statusText.textContent = type;
  statusMsg.textContent = msg;

  statusDot.className = "pulsing-dot";
  if (type === "Running") {
    statusDot.classList.add("running");
  } else if (type === "Success") {
    statusDot.classList.add("success");
  } else if (type === "Error") {
    statusDot.classList.add("error");
  } else {
    statusDot.classList.add("idle");
  }
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
}
