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
  const fileInput = await waitForElement(() => document.querySelector('input[type="file"][multiple]') || document.querySelector('input[type="file"]'));
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
  console.log("[SELECT] Clicking dropdown for:", optionText);
  dropdownEl.click();
  await sleep(1500);
  
  // Dispatch mouse events on dropdown to open it
  dropdownEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  dropdownEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  
  // Wait for options to appear - check 20 times with 250ms interval
  let foundOption = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const allElements = [
      ...document.querySelectorAll('[role="option"]'),
      ...document.querySelectorAll('[role="menuitem"]'),
      ...document.querySelectorAll('ul li'),
      ...document.querySelectorAll('[role="listbox"] div'),
      ...document.querySelectorAll('div[style*="background"]'),
      ...document.querySelectorAll('span'),
      ...document.querySelectorAll('div')
    ];
    
    const matches = allElements.filter(el => {
      if (!el.textContent) return false;
      if (el.offsetParent === null) return false; // Must be visible
      const text = el.textContent.trim().toLowerCase();
      const search = optionText.trim().toLowerCase();
      return text === search || text.includes(search);
    });
    
    if (matches.length > 0) {
      // Find the one with shortest text content to get the closest/most specific element
      matches.sort((a, b) => a.textContent.trim().length - b.textContent.trim().length);
      foundOption = matches[0];
      console.log("[SELECT] Found matching option element:", foundOption.textContent.trim());
      break;
    }
    
    await sleep(250);
  }
  
  if (foundOption) {
    console.log("[SELECT] Clicking option:", optionText);
    foundOption.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    await sleep(200);
    
    foundOption.click();
    foundOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    foundOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    
    const parentOption = foundOption.closest('[role="option"], [role="menuitem"], li');
    if (parentOption && parentOption !== foundOption) {
      parentOption.click();
      parentOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      parentOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    }
    await sleep(800);
  } else {
    console.warn("[SELECT] Option not found:", optionText);
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
    // 1. PHOTO UPLOAD (FIRST) - Uploads exactly ONE photo, rotating from the images list
    console.log("Step 1: Uploading Photos");
    if (data.images && data.images.length > 0) {
      const imgIdx = (data.listingIndex || 0) % data.images.length;
      await uploadPhoto(data.images[imgIdx], `photo_${imgIdx}.jpg`);
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
    let availDrop = findFieldByLabel("Availability", "div") || document.querySelector('[aria-label="Availability"]');
    if (!availDrop) {
      availDrop = [...document.querySelectorAll('div[role="combobox"], div[role="button"], [aria-haspopup="listbox"], [aria-haspopup="menu"]')]
        .find(el => {
          const txt = el.textContent.trim().toLowerCase();
          return txt.includes("availability") || txt.includes("list as single item") || txt.includes("list as in stock");
        });
    }
    if (!availDrop) {
      availDrop = [...document.querySelectorAll('span, div')]
        .find(el => {
          if (el.offsetParent === null) return false;
          const txt = el.textContent.trim().toLowerCase();
          return txt === "availability" || txt === "list as single item" || txt === "list as in stock";
        });
    }
    if (availDrop && data.availability) {
      const clickTarget = availDrop.closest('div[role="combobox"], div[role="button"], [aria-haspopup]') || availDrop;
      await selectDropdownOption(clickTarget, data.availability);
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
    if (data.location) {
      console.log("Step 10: Setting location...");
      await sleep(500);
      await setLocation(data.location);
      await sleep(1000);
    }

    // 11. SAVE DRAFT (LAST)
    console.log("Step 11: Saving Draft");
    const saveDraftBtn = [...document.querySelectorAll('div[role="button"], span')]
      .find(el => el.textContent.toLowerCase() === 'save draft' || el.textContent.toLowerCase() === 'save as draft');
    
    if (saveDraftBtn) {
      saveDraftBtn.click();
    } else {
      const fallbackBtn = [...document.querySelectorAll('div[role="button"]')]
        .find(el => el.textContent.toLowerCase().includes('draft'));
      if (fallbackBtn) {
        fallbackBtn.click();
      } else {
        throw new Error("Save Draft button not found");
      }
    }

    // 12. Signal background to close/redirect tab
    await sleep(3000);
    chrome.runtime.sendMessage({ action: "DRAFT_SAVED" });

  } catch (error) {
    console.error("Autofill process failed:", error);
  }
}

// Location Setter Function (COMPLETE - Keyboard Only Strategy for React/isTrusted)
async function setLocation(location) {
  console.log("[LOCATION] Setting:", location);

  // Step 1: Find the location input
  const locInput = await waitForElement(() => {
    return document.querySelector('input[aria-label="Location"]') ||
           document.querySelector('input[placeholder*="location" i]') ||
           document.querySelector('input[placeholder*="city" i]') ||
           [...document.querySelectorAll('input')].find(el => 
             /location|city|zip/i.test(el.getAttribute('aria-label') || el.placeholder || ''));
  }, 10000);

  if (!locInput) {
    console.error("[LOCATION] Input not found!");
    return false;
  }

  // Step 2: Focus and clear
  locInput.click();
  await sleep(500);
  locInput.focus();
  await sleep(300);

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(locInput, '');
  locInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);

  // Step 3: Type location
  typeIntoField(locInput, location);
  console.log("[LOCATION] Typed:", location);

  // Wait for Facebook to fetch suggestions
  await sleep(4000);

  // Step 4: Find suggestion options
  let selectedOption = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const options = [...document.querySelectorAll('[role="option"]')].filter(el => el.offsetParent !== null);
    if (options.length > 0) {
      selectedOption = options[0]; // Select first suggestion
      break;
    }
    const fallbackOptions = [...document.querySelectorAll('[role="listbox"] div, [role="listbox"] li, div[data-testid="typeahead-dropdown"] div')]
      .filter(el => el.offsetParent !== null && el.textContent.trim().length > 0);
    if (fallbackOptions.length > 0) {
      selectedOption = fallbackOptions[0];
      break;
    }
    await sleep(300);
  }

  // Step 5: Click the option
  if (selectedOption) {
    console.log("[LOCATION] Clicking suggestion:", selectedOption.textContent.trim());
    selectedOption.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    await sleep(200);
    
    selectedOption.click();
    selectedOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    selectedOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    
    const parentOption = selectedOption.closest('[role="option"], li');
    if (parentOption && parentOption !== selectedOption) {
      parentOption.click();
      parentOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      parentOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    }
    await sleep(1500);
    console.log("[LOCATION] Selection completed.");
  } else {
    console.log("[LOCATION] No options found, trying keyboard on input...");

    // Fallback: Use keyboard on the input itself
    locInput.focus();
    await sleep(500);

    // Press Down to open/select
    locInput.dispatchEvent(new KeyboardEvent('keydown', { 
      key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, 
      bubbles: true, cancelable: true, view: window, composed: true
    }));
    await sleep(1200);

    // Press Enter to confirm
    locInput.dispatchEvent(new KeyboardEvent('keydown', { 
      key: 'Enter', code: 'Enter', keyCode: 13, 
      bubbles: true, cancelable: true, view: window, composed: true
    }));
    await sleep(300);
    locInput.dispatchEvent(new KeyboardEvent('keypress', { 
      key: 'Enter', code: 'Enter', keyCode: 13, 
      bubbles: true, cancelable: true, view: window, composed: true
    }));
    await sleep(300);
    locInput.dispatchEvent(new KeyboardEvent('keyup', { 
      key: 'Enter', code: 'Enter', keyCode: 13, 
      bubbles: true, cancelable: true, view: window, composed: true
    }));

    console.log("[LOCATION] Used keyboard fallback");
  }

  await sleep(1500);
  console.log("[LOCATION] Done");
  return true;
}

// AUTO PUBLISH SYSTEM (PHASE 2)
function injectPublishBox() {
  if (document.getElementById("rapid-lister-publish-box")) return;

  const box = document.createElement("div");
  box.id = "rapid-lister-publish-box";
  box.style.position = "fixed";
  box.style.top = "50%";
  box.style.left = "50%";
  box.style.transform = "translate(-50%, -50%)";
  box.style.width = "340px";
  box.style.background = "linear-gradient(135deg, #0f0f18, #1a1a2e)";
  box.style.border = "2px solid #06b6d4";
  box.style.borderRadius = "16px";
  box.style.padding = "20px";
  box.style.zIndex = "999999";
  box.style.color = "#f8fafc";
  box.style.fontFamily = "system-ui, -apple-system, sans-serif";
  box.style.boxShadow = "0 20px 50px rgba(0, 0, 0, 0.7), 0 0 30px rgba(6, 182, 212, 0.4)";

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

  // Listen for storage changes to update UI dynamically
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.autoPublishState && changes.autoPublishState.newValue) {
      updatePublishUI(changes.autoPublishState.newValue);
    }
  });

  // Restore state if active
  chrome.storage.local.get(["autoPublishState"], (res) => {
    if (res.autoPublishState && res.autoPublishState.active) {
      updatePublishUI(res.autoPublishState);
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

  const draftUrls = drafts.map(el => {
    const anchor = el.tagName === 'A' ? el : el.closest('a');
    return anchor ? anchor.href : null;
  }).filter(Boolean);

  if (draftUrls.length === 0) {
    alert("No draft listing links found to publish! Make sure the page is loaded.");
    return;
  }

  const publishState = {
    active: true,
    running: true,
    totalDrafts: draftUrls.length,
    currentIndex: 0,
    statusText: "Starting background publish...",
    urls: draftUrls
  };

  await chrome.storage.local.set({ autoPublishState: publishState });
  updatePublishUI(publishState);
  
  chrome.runtime.sendMessage({ action: "START_BACKGROUND_PUBLISH", urls: draftUrls });
}

function stopAutoPublish() {
  chrome.runtime.sendMessage({ action: "STOP_BACKGROUND_PUBLISH" });
}

// IN EDITING FLOW
async function runPublishAction() {
  try {
    const publishBtn = await waitForElement(() => {
      return [...document.querySelectorAll('div[role="button"], span, button')]
        .find(el => el.textContent.trim().toLowerCase() === 'publish');
    }, 15000);

    publishBtn.click();

    // Wait 6 seconds for publication process to complete
    await sleep(6000);

    chrome.runtime.sendMessage({ action: "PUBLISH_COMPLETE", success: true });

  } catch (err) {
    console.error("Publish button not found or failed:", err);
    chrome.runtime.sendMessage({ action: "PUBLISH_COMPLETE", success: false });
  }
}

// Main page listener entry
async function init() {
  const url = window.location.href;

  if (url.includes("/marketplace/create/item")) {
    chrome.runtime.sendMessage({ action: "GET_MY_PENDING_DATA" }, async (res) => {
      if (res && res.data) {
        const storage = await chrome.storage.local.get("draftListing");
        const images = (storage.draftListing && storage.draftListing.images) || [];
        const fullData = { ...res.data, images };
        runPhase1(fullData);
      }
    });
  } else if (url.includes("/marketplace/you/selling")) {
    injectPublishBox();
  } else if (url.includes("/marketplace/edit")) {
    chrome.runtime.sendMessage({ action: "CHECK_AUTO_PUBLISH" }, (res) => {
      if (res && res.isPublishTab) {
        runPublishAction();
      }
    });
  }
}

// Global listener for finished background publishing alert
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "BACKGROUND_PUBLISH_FINISHED") {
    alert("All draft listings have been published successfully!");
  }
});

init();
