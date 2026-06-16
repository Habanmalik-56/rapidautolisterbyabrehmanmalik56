// Helper functions
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function typeIntoField(element, text) {
  if (!element) return;
  element.focus();
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
  nativeSetter.call(element, '');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  let val = '';
  for (const char of String(text)) {
    val += char;
    nativeSetter.call(element, val);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function uploadPhoto(base64Image, filename) {
  const fileInput = document.querySelector('input[type="file"][multiple]') || document.querySelector('input[type="file"]');
  if (!fileInput) throw new Error("File input not found");
  const res = await fetch(base64Image);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInput.files = dataTransfer.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(8000); // CRITICAL: Wait 8 seconds for Facebook to process
}

async function selectDropdownOption(dropdownEl, optionText) {
  if (!dropdownEl) return;
  dropdownEl.click();
  await sleep(1000);
  const option = [...document.querySelectorAll('[role="option"], span, div, li')]
    .find(el => el.children.length === 0 && el.textContent.trim().toLowerCase() === optionText.toLowerCase());
  if (option) {
    option.click();
    await sleep(500);
  } else {
    // Fallback: try finding container elements containing the text
    const fallbackOption = [...document.querySelectorAll('[role="option"], [role="menuitem"]')]
      .find(el => el.textContent.trim().toLowerCase().includes(optionText.toLowerCase()));
    if (fallbackOption) {
      fallbackOption.click();
      await sleep(500);
    }
  }
}

function waitForElement(selectorFn, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const el = selectorFn();
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const found = selectorFn();
      if (found) {
        observer.disconnect();
        clearTimeout(t);
        resolve(found);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const t = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Timeout waiting for element"));
    }, timeoutMs);
  });
}

// Finder functions for Facebook Marketplace fields
function findFieldByLabel(labelText, tagName = 'input') {
  // 1. Try finding by aria-label
  let el = document.querySelector(`${tagName}[aria-label="${labelText}"]`);
  if (el) return el;

  // 2. Try looking for labels containing the text
  const label = [...document.querySelectorAll('label')].find(l => l.textContent.toLowerCase().includes(labelText.toLowerCase()));
  if (label) {
    el = label.querySelector(tagName);
    if (el) return el;
  }
  
  // 3. Try fallback to finding matching attribute placeholders
  el = document.querySelector(`[placeholder*="${labelText}"]`);
  if (el) return el;

  return null;
}

// RUN FILL SYSTEM (PHASE 1)
async function runPhase1(data) {
  console.log("Rapid Lister Pro: Starting autofill sequence...", data);
  try {
    // 1. PHOTO UPLOAD (FIRST)
    console.log("Step 1: Uploading Photos");
    if (data.images && data.images.length > 0) {
      for (let i = 0; i < data.images.length; i++) {
        await uploadPhoto(data.images[i], `photo_${i}.jpg`);
      }
    } else {
      console.warn("No photos provided for listing");
    }

    // 2. TITLE
    console.log("Step 2: Filling Title");
    const titleInput = await waitForElement(() => findFieldByLabel("Title", "input") || document.querySelector('input[type="text"][maxlength="100"]'));
    typeIntoField(titleInput, data.title);
    await sleep(500);

    // 3. PRICE
    console.log("Step 3: Filling Price");
    const priceInput = findFieldByLabel("Price", "input") || document.querySelector('input[type="text"][inputmode="numeric"]');
    typeIntoField(priceInput, data.price);
    await sleep(500);

    // 4. CATEGORY
    console.log("Step 4: Selecting Category");
    const categoryDrop = findFieldByLabel("Category", "div") || document.querySelector('[aria-label="Category"]');
    if (categoryDrop && data.category) {
      await selectDropdownOption(categoryDrop, data.category);
    }

    // 5. CONDITION
    console.log("Step 5: Selecting Condition");
    const conditionDrop = findFieldByLabel("Condition", "div") || document.querySelector('[aria-label="Condition"]');
    if (conditionDrop && data.condition) {
      await selectDropdownOption(conditionDrop, data.condition);
    }

    // 6. DESCRIPTION
    console.log("Step 6: Filling Description");
    const descTextarea = findFieldByLabel("Description", "textarea") || document.querySelector('textarea[aria-label="Description"]');
    if (descTextarea) {
      typeIntoField(descTextarea, data.description);
      await sleep(500);
    }

    // 7. AVAILABILITY
    console.log("Step 7: Selecting Availability");
    const availDrop = findFieldByLabel("Availability", "div") || document.querySelector('[aria-label="Availability"]');
    if (availDrop && data.availability) {
      await selectDropdownOption(availDrop, data.availability);
    }

    // 8. PRODUCT TAGS
    console.log("Step 8: Adding Product Tags");
    const tagsInput = findFieldByLabel("Product tags", "textarea") || findFieldByLabel("Tags", "input") || document.querySelector('[aria-label="Product tags"] textarea');
    if (tagsInput && data.tags) {
      const tags = data.tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tags) {
        typeIntoField(tagsInput, tag);
        await sleep(300);
        // Press Enter to submit the tag
        tagsInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
        await sleep(300);
      }
    }

    // 9. QUANTITY (if > 1 and single item not chosen)
    if (data.quantity && parseInt(data.quantity) > 1) {
      console.log("Step 9: Filling Quantity");
      const qtyInput = findFieldByLabel("Quantity", "input") || document.querySelector('[aria-label="Quantity"]');
      if (qtyInput) {
        typeIntoField(qtyInput, data.quantity);
        await sleep(500);
      }
    }

    // 10. LOCATION
    console.log("Step 10: Setting Location");
    const locInput = findFieldByLabel("Location", "input") || document.querySelector('[aria-label="Location"]');
    if (locInput && data.location) {
      // Clear current location value
      locInput.focus();
      typeIntoField(locInput, data.location);
      await sleep(1500); // Wait for location search suggestion dropdown
      
      // Auto-suggest select
      const suggestOption = [...document.querySelectorAll('[role="option"], span, div')]
        .find(el => el.textContent.toLowerCase().includes(data.location.toLowerCase()));
      if (suggestOption) {
        suggestOption.click();
      } else {
        // Fallback: click first option in role="option" list
        const firstOpt = document.querySelector('[role="option"]');
        if (firstOpt) firstOpt.click();
      }
      await sleep(1000);
    }

    // 11. SAVE DRAFT (LAST)
    console.log("Step 11: Saving Draft");
    const saveDraftBtn = [...document.querySelectorAll('div[role="button"], span')]
      .find(el => el.textContent.toLowerCase() === 'save draft' || el.textContent.toLowerCase() === 'save as draft');
    
    if (saveDraftBtn) {
      saveDraftBtn.click();
    } else {
      // Try searching for any buttons containing draft
      const fallbackBtn = [...document.querySelectorAll('div[role="button"]')]
        .find(el => el.textContent.toLowerCase().includes('draft'));
      if (fallbackBtn) {
        fallbackBtn.click();
      } else {
        throw new Error("Save Draft button not found");
      }
    }

    // 12. CLOSE TAB (handled by background after message)
    await sleep(3000);
    chrome.runtime.sendMessage({ action: "DRAFT_SAVED" });

  } catch (error) {
    console.error("Autofill process failed:", error);
  }
}

// AUTO PUBLISH SYSTEM (PHASE 2)
function injectPublishBox() {
  if (document.getElementById("rapid-lister-publish-box")) return;

  const box = document.createElement("div");
  box.id = "rapid-lister-publish-box";
  box.style.position = "fixed";
  box.style.top = "80px";
  box.style.right = "20px";
  box.style.width = "320px";
  box.style.background = "linear-gradient(135deg, #0f0f18, #1a1a2e)";
  box.style.border = "2px solid #06b6d4";
  box.style.borderRadius = "16px";
  box.style.padding = "20px";
  box.style.zIndex = "999999";
  box.style.color = "#f8fafc";
  box.style.fontFamily = "system-ui, -apple-system, sans-serif";
  box.style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.5), 0 0 15px rgba(6, 182, 212, 0.2)";

  box.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="background: linear-gradient(135deg, #8b5cf6, #06b6d4); width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px;">🤖</div>
        <div>
          <div style="font-weight: bold; color: #06b6d4; text-shadow: 0 0 8px rgba(6, 182, 212, 0.3);">AI Publish</div>
          <div style="font-size: 10px; color: #94a3b8;">Rapid Lister Pro</div>
        </div>
      </div>
      <button id="close-publish-box" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 0 5px;">&times;</button>
    </div>
    
    <div style="background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.2); padding: 10px; border-radius: 8px; font-size: 12px; margin-bottom: 15px;">
      <strong>Status:</strong> <span id="publish-status-text">Idle</span>
    </div>

    <div style="margin-bottom: 15px;">
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px; color: #94a3b8;">
        <span>Progress</span>
        <span id="publish-counter">0 / 0</span>
      </div>
      <div style="width: 100%; height: 8px; background: #151522; border-radius: 4px; overflow: hidden;">
        <div id="publish-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #06b6d4, #8b5cf6); transition: width 0.3s;"></div>
      </div>
    </div>

    <div style="display: flex; gap: 10px;">
      <button id="start-publish-btn" style="flex: 1; padding: 10px; border: none; border-radius: 8px; background: linear-gradient(90deg, #06b6d4, #8b5cf6); color: #000; font-weight: bold; cursor: pointer; transition: opacity 0.2s;">START AI PUBLISH</button>
      <button id="stop-publish-btn" style="padding: 10px; border: 1px solid #ef4444; border-radius: 8px; background: transparent; color: #ef4444; font-weight: bold; cursor: pointer; transition: background 0.2s;">STOP</button>
    </div>
  `;

  document.body.appendChild(box);

  document.getElementById("close-publish-box").addEventListener("click", () => {
    box.remove();
    chrome.storage.local.set({ autoPublishState: null });
  });

  document.getElementById("start-publish-btn").addEventListener("click", () => {
    startAutoPublish();
  });

  document.getElementById("stop-publish-btn").addEventListener("click", () => {
    stopAutoPublish();
  });

  // Restore state if active
  chrome.storage.local.get(["autoPublishState"], (res) => {
    if (res.autoPublishState && res.autoPublishState.active) {
      updatePublishUI(res.autoPublishState);
      if (res.autoPublishState.running) {
        continueAutoPublish();
      }
    }
  });
}

function updatePublishUI(publishState) {
  const statusEl = document.getElementById("publish-status-text");
  const counterEl = document.getElementById("publish-counter");
  const barEl = document.getElementById("publish-progress-bar");
  
  if (statusEl) statusEl.textContent = publishState.statusText || "Running...";
  if (counterEl) counterEl.textContent = `${publishState.currentIndex} / ${publishState.totalDrafts}`;
  if (barEl && publishState.totalDrafts > 0) {
    barEl.style.width = `${(publishState.currentIndex / publishState.totalDrafts) * 100}%`;
  }
}

async function startAutoPublish() {
  const drafts = [...document.querySelectorAll('a, div[role="button"], span')]
    .filter(el => el.textContent.trim().toLowerCase() === "continue" || el.textContent.trim().toLowerCase() === "complete listing" || el.textContent.trim().toLowerCase().includes("resume"));

  if (drafts.length === 0) {
    alert("No draft listings found to publish!");
    return;
  }

  const publishState = {
    active: true,
    running: true,
    totalDrafts: drafts.length,
    currentIndex: 0,
    statusText: "Initializing..."
  };

  await chrome.storage.local.set({ autoPublishState: publishState });
  updatePublishUI(publishState);
  await runPublishNext();
}

function stopAutoPublish() {
  chrome.storage.local.get(["autoPublishState"], (res) => {
    if (res.autoPublishState) {
      const state = { ...res.autoPublishState, running: false, statusText: "Stopped" };
      chrome.storage.local.set({ autoPublishState: state });
      updatePublishUI(state);
    }
  });
}

async function continueAutoPublish() {
  chrome.storage.local.get(["autoPublishState"], async (res) => {
    const state = res.autoPublishState;
    if (!state || !state.running) return;

    if (state.currentIndex >= state.totalDrafts) {
      state.running = false;
      state.statusText = "ALL PUBLISHED!";
      chrome.storage.local.set({ autoPublishState: state });
      updatePublishUI(state);
      alert("All draft listings have been published successfully!");
      return;
    }

    await runPublishNext();
  });
}

async function runPublishNext() {
  chrome.storage.local.get(["autoPublishState"], async (res) => {
    const state = res.autoPublishState;
    if (!state || !state.running) return;

    state.statusText = `Searching drafts...`;
    chrome.storage.local.set({ autoPublishState: state });
    updatePublishUI(state);

    // Refresh draft elements list
    const drafts = [...document.querySelectorAll('a, div[role="button"], span')]
      .filter(el => el.textContent.trim().toLowerCase() === "continue" || el.textContent.trim().toLowerCase() === "complete listing" || el.textContent.trim().toLowerCase().includes("resume"));

    if (drafts.length === 0 || state.currentIndex >= drafts.length) {
      state.running = false;
      state.statusText = "Completed / No more drafts";
      chrome.storage.local.set({ autoPublishState: state });
      updatePublishUI(state);
      return;
    }

    const draftButton = drafts[state.currentIndex];
    state.statusText = `Resuming draft #${state.currentIndex + 1}...`;
    chrome.storage.local.set({ autoPublishState: state });
    updatePublishUI(state);

    // Click Continue
    draftButton.scrollIntoView({ block: "center" });
    await sleep(1000);
    draftButton.click();

    // The click navigates to editing flow. Wait for "Publish" page.
    // We let the edit page script take over. We will set a marker in storage that we are in editing flow.
    await chrome.storage.local.set({
      autoPublishState: {
        ...state,
        inEditMode: true
      }
    });
  });
}

// IN EDITING FLOW
async function runPublishAction() {
  try {
    const publishBtn = await waitForElement(() => {
      return [...document.querySelectorAll('div[role="button"], span, button')]
        .find(el => el.textContent.trim().toLowerCase() === 'publish');
    }, 15000);

    // Update state
    chrome.storage.local.get(["autoPublishState"], async (res) => {
      const state = res.autoPublishState;
      if (!state) return;

      state.statusText = "Publishing listing...";
      chrome.storage.local.set({ autoPublishState: state });

      publishBtn.click();

      // Wait 6 seconds for publication process
      await sleep(6000);

      // Return to selling page
      state.currentIndex++;
      state.inEditMode = false;
      
      // Random delay 5-10 seconds between publishes (anti-ban)
      const randomDelay = Math.floor(Math.random() * 5000) + 5000;
      state.statusText = `Cooldown for ${Math.round(randomDelay/1000)}s...`;
      await chrome.storage.local.set({ autoPublishState: state });

      await sleep(randomDelay);
      
      // Navigate back to selling page
      window.location.href = "https://www.facebook.com/marketplace/you/selling";
    });

  } catch (err) {
    console.error("Publish button not found or failed:", err);
    // Go back anyway after timeout
    chrome.storage.local.get(["autoPublishState"], (res) => {
      const state = res.autoPublishState;
      if (!state) return;
      state.currentIndex++;
      state.inEditMode = false;
      chrome.storage.local.set({ autoPublishState: state });
      window.location.href = "https://www.facebook.com/marketplace/you/selling";
    });
  }
}

// Main page listener entry
async function init() {
  const url = window.location.href;

  if (url.includes("/marketplace/create/item")) {
    // Check if we have active autofill data
    chrome.runtime.sendMessage({ action: "GET_MY_PENDING_DATA" }, (res) => {
      if (res && res.data) {
        runPhase1(res.data);
      }
    });
  } else if (url.includes("/marketplace/you/selling")) {
    // Inject and run publish box
    injectPublishBox();
  } else if (url.includes("/marketplace/edit")) {
    // Check if we are auto-publishing
    chrome.storage.local.get(["autoPublishState"], (res) => {
      if (res.autoPublishState && res.autoPublishState.running && res.autoPublishState.inEditMode) {
        runPublishAction();
      }
    });
  }
}

init();
