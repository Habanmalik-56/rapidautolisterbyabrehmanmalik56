// ============================================================
// RAPID LISTER PRO - content_ULTIMATE.js (Complete Rewrite)
// ============================================================

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
  const fileInput = await waitForElement(() =>
    document.querySelector('input[type="file"][multiple]') || document.querySelector('input[type="file"]')
  );
  if (!fileInput) throw new Error("File input not found");
  const res = await fetch(base64Image);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInput.files = dataTransfer.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(15000);
}

async function selectDropdownOption(dropdownEl, optionText) {
  if (!dropdownEl || !optionText) return false;

  console.log("[SELECT] Selecting:", optionText);

  for (let retry = 0; retry < 3; retry++) {
    dropdownEl.scrollIntoView({ block: "center" });
    dropdownEl.click();

    dropdownEl.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true
      })
    );

    await sleep(2500);

    const options = [
      ...document.querySelectorAll('[role="option"]'),
      ...document.querySelectorAll('[role="menuitem"]')
    ].filter(el => el.offsetParent !== null);

    const target = options.find(el => {
      const txt = (el.innerText || el.textContent || "")
        .trim()
        .toLowerCase();

      return txt === optionText.trim().toLowerCase();
    });

    if (target) {
      console.log("[SELECT] Found:", target.innerText);

      target.scrollIntoView({ block: "center" });
      await sleep(400);

      target.click();

      target.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true
        })
      );

      await sleep(2000);
      return true;
    }

    console.warn("[SELECT] Retry:", retry + 1);
    await sleep(1500);
  }

  console.error("[SELECT] Failed:", optionText);
  return false;
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

function findFieldByLabel(labelText, tagName = 'input') {
  let el = document.querySelector(`${tagName}[aria-label="${labelText}"]`);
  if (el) return el;

  const label = [...document.querySelectorAll('label')].find(l =>
    l.textContent.toLowerCase().includes(labelText.toLowerCase())
  );
  if (label) {
    el = label.querySelector(tagName);
    if (el) return el;
  }

  el = document.querySelector(`[placeholder*="${labelText}"]`);
  if (el) return el;

  return null;
}

// ============================================================
// PHASE 1: CREATE DRAFTS (autofill form)
// ============================================================
async function runPhase1(data) {
  console.log("Rapid Lister Pro: Starting autofill sequence...", data);
  try {
    // 1. PHOTO UPLOAD
    console.log("Step 1: Uploading Photos");
    if (data.images && data.images.length > 0) {
      const imgIdx = (data.listingIndex || 0) % data.images.length;
      await uploadPhoto(data.images[imgIdx], `photo_${imgIdx}.jpg`);
    } else {
      console.warn("No photos provided for listing");
    }

    // 2. TITLE
    console.log("Step 2: Filling Title");
    const titleInput = await waitForElement(() =>
      findFieldByLabel("Title", "input") || document.querySelector('input[type="text"][maxlength="100"]')
    );
    typeIntoField(titleInput, data.title);
    await sleep(500);

    // 3. PRICE
    console.log("Step 3: Filling Price");
    const priceInput = findFieldByLabel("Price", "input") ||
      document.querySelector('input[type="text"][inputmode="numeric"]') ||
      document.querySelector('input[inputmode="numeric"]');
    typeIntoField(priceInput, data.price);
    await sleep(500);

    // 4. CATEGORY
    console.log("Step 4: Selecting Category");
    const categoryDrop = findFieldByLabel("Category", "div") || document.querySelector('[aria-label="Category"]');
    if (categoryDrop && data.category) {
      await selectDropdownOption(categoryDrop, data.category);
      await sleep(4000);
    }

    // 5. CONDITION
    console.log("Step 5: Selecting Condition");
    const conditionDrop = findFieldByLabel("Condition", "div") || document.querySelector('[aria-label="Condition"]');
    if (conditionDrop && data.condition) {
      await selectDropdownOption(conditionDrop, data.condition);
    }

    // 6. DESCRIPTION
    console.log("Step 6: Filling Description");
    const descTextarea = findFieldByLabel("Description", "textarea") ||
      document.querySelector('textarea[aria-label="Description"]');
    if (descTextarea) {
      typeIntoField(descTextarea, data.description);
      await sleep(500);
    }

    // 7. AVAILABILITY
    console.log("Step 7: Selecting Availability");
    let availDrop = findFieldByLabel("Availability", "div") || document.querySelector('[aria-label="Availability"]');
    if (!availDrop) {
      availDrop = [...document.querySelectorAll('div[role="combobox"], div[role="button"], [aria-haspopup="listbox"]')]
        .find(el => {
          const txt = el.textContent.trim().toLowerCase();
          return txt.includes("availability") || txt.includes("list as single item") || txt.includes("list as in stock");
        });
    }
    if (availDrop && data.availability) {
      const clickTarget = availDrop.closest('div[role="combobox"], div[role="button"], [aria-haspopup]') || availDrop;
      await selectDropdownOption(clickTarget, data.availability);
    }

    // 8. PRODUCT TAGS
    console.log("Step 8: Adding Product Tags");
    const tagsInput = findFieldByLabel("Product tags", "textarea") ||
      findFieldByLabel("Tags", "input") ||
      document.querySelector('[aria-label="Product tags"] textarea');
    if (tagsInput && data.tags) {
      const tags = data.tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tags) {
        typeIntoField(tagsInput, tag);
        await sleep(300);
        tagsInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
        await sleep(300);
      }
    }

    // 9. QUANTITY
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

    // 11. SAVE DRAFT
    console.log("Step 11: Saving Draft");
    const saveDraftBtn = [...document.querySelectorAll('div[role="button"], span')]
      .find(el =>
        el.textContent.toLowerCase() === 'save draft' ||
        el.textContent.toLowerCase() === 'save as draft' ||
        el.textContent.toLowerCase() === 'guardar borrador'
      );

    if (saveDraftBtn) {
      saveDraftBtn.click();
    } else {
      const fallbackBtn = [...document.querySelectorAll('div[role="button"]')]
        .find(el => el.textContent.toLowerCase().includes('draft') || el.textContent.toLowerCase().includes('borrador'));
      if (fallbackBtn) {
        fallbackBtn.click();
      } else {
        throw new Error("Save Draft button not found");
      }
    }

    await sleep(3000);
    chrome.runtime.sendMessage({ action: "DRAFT_SAVED" });

  } catch (error) {
    console.error("Autofill process failed:", error);
  }
}

// ============================================================
// LOCATION SETTER
// ============================================================
async function setLocation(location) {
  console.log("[LOCATION] Setting:", location);

  const locInput = await waitForElement(() => {
    return document.querySelector('input[aria-label="Location"]') ||
      document.querySelector('input[placeholder*="location" i]') ||
      document.querySelector('input[placeholder*="city" i]') ||
      [...document.querySelectorAll('input')].find(el =>
        /location|city|zip/i.test(el.getAttribute('aria-label') || el.placeholder || '')
      );
  }, 10000);

  if (!locInput) {
    console.error("[LOCATION] Input not found!");
    return false;
  }

  locInput.click();
  await sleep(500);
  locInput.focus();
  await sleep(300);

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(locInput, '');
  locInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);

  typeIntoField(locInput, location);
  console.log("[LOCATION] Typed:", location);

  await sleep(4000);

  let selectedOption = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const options = [...document.querySelectorAll('[role="option"]')].filter(el => el.offsetParent !== null);
    if (options.length > 0) {
      selectedOption = options.find(el =>
      (el.innerText || "").toLowerCase().includes(location.toLowerCase())
    ) || options[0];
      break;
    }
    const fallbackOptions = [...document.querySelectorAll('[role="listbox"] div, [role="listbox"] li')]
      .filter(el => el.offsetParent !== null && el.textContent.trim().length > 0);
    if (fallbackOptions.length > 0) {
      selectedOption = fallbackOptions[0];
      break;
    }
    await sleep(300);
  }

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
    console.log("[LOCATION] Done.");
  } else {
    // Keyboard fallback
    locInput.focus();
    await sleep(500);
    locInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
    await sleep(1200);
    locInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    await sleep(500);
    console.log("[LOCATION] Used keyboard fallback");
  }

  return true;
}

// ============================================================
// PHASE 2: AUTO PUBLISH SYSTEM (Selling Page)
// ============================================================
function injectPublishBox() {
  if (document.getElementById("rapid-lister-publish-box")) return;

  const box = document.createElement("div");
  box.id = "rapid-lister-publish-box";
  box.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 340px; background: linear-gradient(135deg, #0f0f18, #1a1a2e);
    border: 2px solid #06b6d4; border-radius: 16px; padding: 20px;
    z-index: 999999; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif;
    box-shadow: 0 20px 50px rgba(0,0,0,0.7), 0 0 30px rgba(6,182,212,0.4);
  `;

  box.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="background:linear-gradient(135deg,#8b5cf6,#06b6d4); width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px;">🤖</div>
        <div>
          <div style="font-weight:bold; color:#06b6d4;">AI Publish</div>
          <div style="font-size:10px; color:#94a3b8;">Rapid Lister Pro</div>
        </div>
      </div>
      <button id="close-publish-box" style="background:none; border:none; color:#94a3b8; font-size:18px; cursor:pointer;">&times;</button>
    </div>
    <div style="background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.2); padding:10px; border-radius:8px; font-size:12px; margin-bottom:15px;">
      <strong>Status:</strong> <span id="publish-status-text">Idle</span>
    </div>
    <div style="margin-bottom:15px;">
      <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:5px; color:#94a3b8;">
        <span>Progress</span>
        <span id="publish-counter">0 / 0</span>
      </div>
      <div style="width:100%; height:8px; background:#151522; border-radius:4px; overflow:hidden;">
        <div id="publish-progress-bar" style="width:0%; height:100%; background:linear-gradient(90deg,#06b6d4,#8b5cf6); transition:width 0.3s;"></div>
      </div>
    </div>
    <div style="display:flex; gap:10px;">
      <button id="start-publish-btn" style="flex:1; padding:10px; border:none; border-radius:8px; background:linear-gradient(90deg,#06b6d4,#8b5cf6); color:#000; font-weight:bold; cursor:pointer;">START AI PUBLISH</button>
      <button id="stop-publish-btn" style="padding:10px; border:1px solid #ef4444; border-radius:8px; background:transparent; color:#ef4444; font-weight:bold; cursor:pointer;">STOP</button>
    </div>
  `;

  document.body.appendChild(box);

  document.getElementById("close-publish-box").addEventListener("click", () => {
    box.remove();
    chrome.storage.local.set({ autoPublishState: null });
  });

  document.getElementById("start-publish-btn").addEventListener("click", () => startAutoPublish());
  document.getElementById("stop-publish-btn").addEventListener("click", () => stopAutoPublish());

  // Live UI updates via storage listener
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.autoPublishState && changes.autoPublishState.newValue) {
      updatePublishUI(changes.autoPublishState.newValue);
    }
  });

  // Restore current state
  chrome.storage.local.get("autoPublishState", (res) => {
    if (res.autoPublishState) {
      updatePublishUI(res.autoPublishState);
    }
  });
}

function updatePublishUI(ps) {
  const statusEl = document.getElementById("publish-status-text");
  const counterEl = document.getElementById("publish-counter");
  const barEl = document.getElementById("publish-progress-bar");

  if (statusEl) statusEl.textContent = ps.statusText || "Running...";
  if (counterEl) counterEl.textContent = `${ps.currentIndex || 0} / ${ps.totalDrafts || 0}`;
  if (barEl && ps.totalDrafts > 0) {
    barEl.style.width = `${((ps.currentIndex || 0) / ps.totalDrafts) * 100}%`;
  }
}

async function startAutoPublish() {
  console.log("[PUBLISH] Scanning page for draft listings...");

  // Strategy 1: Find direct /marketplace/edit/ links on page
  let draftUrls = [...new Set(
    [...document.querySelectorAll('a[href*="/marketplace/edit"]')]
      .map(a => a.href)
      .filter(h => h && h.includes('listing_id'))
  )];

  // Strategy 2: Look for listing_id in any anchor
  if (draftUrls.length === 0) {
    draftUrls = [...new Set(
      [...document.querySelectorAll('a[href*="listing_id"]')]
        .map(a => a.href)
    )];
  }

  // Strategy 3: Find Continue/Resume buttons that are anchors
  if (draftUrls.length === 0) {
    const keywords = ['continue', 'resume', 'complete listing'];
    const links = [...document.querySelectorAll('a')].filter(a => {
      const txt = a.textContent.trim().toLowerCase();
      return keywords.some(k => txt.includes(k)) && a.href;
    });
    draftUrls = [...new Set(links.map(a => a.href))];
  }

  if (draftUrls.length === 0) {
    alert(
      "❌ No draft listings found on this page!\n\n" +
      "Please make sure you are on:\nfacebook.com/marketplace/you/selling\n\n" +
      "And that your draft listings are VISIBLE on screen before clicking START."
    );
    return;
  }

  console.log("[PUBLISH] Found", draftUrls.length, "draft URLs:", draftUrls);

  const ps = {
    active: true,
    running: true,
    totalDrafts: draftUrls.length,
    currentIndex: 0,
    statusText: `Found ${draftUrls.length} drafts. Starting...`
  };

  await chrome.storage.local.set({ autoPublishState: ps });
  updatePublishUI(ps);

  chrome.runtime.sendMessage({ action: "START_BACKGROUND_PUBLISH", urls: draftUrls });
}

function stopAutoPublish() {
  chrome.runtime.sendMessage({ action: "STOP_BACKGROUND_PUBLISH" });
}

// ============================================================
// PHASE 2: RUN PUBLISH ON EDIT PAGE
// ============================================================
async function runPublishAction() {
  console.log("[PUBLISH] runPublishAction() triggered on edit page");

  // Helper: find a visible button/element by exact or partial text
  const findBtn = (texts) => {
    return [...document.querySelectorAll('div[role="button"], button, span[role="button"]')]
      .find(el => {
        if (el.offsetParent === null) return false;
        const txt = el.textContent.trim().toLowerCase();
        return texts.some(t => txt === t);
      });
  };

  try {
    await sleep(3000); // wait for page to fully load

    // Step 1: Click "Next" if present (some draft edit flows have a Next button)
    let nextBtn = null;
    for (let i = 0; i < 10; i++) {
      nextBtn = findBtn(['next', 'siguiente', 'next step']);
      if (nextBtn) break;
      await sleep(500);
    }

    if (nextBtn) {
      console.log("[PUBLISH] Clicking Next button...");
      nextBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
      await sleep(500);
      nextBtn.click();
      nextBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      nextBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      await sleep(4000); // wait for transition to publish step
    } else {
      console.log("[PUBLISH] No Next button found, looking directly for Publish...");
    }

    // Step 2: Click "Publish"
    let publishBtn = null;
    for (let i = 0; i < 20; i++) {
      publishBtn = findBtn(['publish', 'publicar', 'post', 'publicar ahora']);
      if (publishBtn) break;
      await sleep(500);
    }

    if (!publishBtn) {
      throw new Error("Publish button not found after waiting 10 seconds");
    }

    console.log("[PUBLISH] Clicking Publish button...");
    publishBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(500);
    publishBtn.click();
    publishBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    publishBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));

    // Wait for publish to complete
    await sleep(8000);

    console.log("[PUBLISH] Done! Signaling background...");
    chrome.runtime.sendMessage({ action: "PUBLISH_COMPLETE", success: true });

  } catch (err) {
    console.error("[PUBLISH] Failed:", err.message);
    chrome.runtime.sendMessage({ action: "PUBLISH_COMPLETE", success: false });
  }
}

// ============================================================
// MAIN INIT — runs on page load
// ============================================================
async function init() {
  const url = window.location.href;
  console.log("[INIT] Page:", url);

  if (url.includes("/marketplace/create/item")) {
    // Phase 1: autofill form
    chrome.runtime.sendMessage({ action: "GET_MY_PENDING_DATA" }, async (res) => {
      if (res && res.data) {
        const storage = await chrome.storage.local.get("draftListing");
        const images = (storage.draftListing && storage.draftListing.images) || [];
        const fullData = { ...res.data, images };
        runPhase1(fullData);
      }
    });

  } else if (url.includes("/marketplace/you/selling")) {
    // Phase 2: inject publish panel on selling page
    injectPublishBox();

  } else if (url.includes("/marketplace/edit")) {
    // Phase 2: this tab was opened for publishing - check via background
    console.log("[INIT] Edit page - checking if this is a publish tab...");
    chrome.runtime.sendMessage({ action: "CHECK_AUTO_PUBLISH" }, (res) => {
      console.log("[INIT] CHECK_AUTO_PUBLISH response:", res);
      if (res && res.isPublishTab) {
        runPublishAction();
      } else {
        console.log("[INIT] Not a publish tab, doing nothing.");
      }
    });
  }
}

// Listen for finish notification
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "BACKGROUND_PUBLISH_FINISHED") {
    alert("✅ All draft listings have been published successfully!");
  }
});

init();
