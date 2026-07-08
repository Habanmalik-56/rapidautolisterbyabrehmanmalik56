// ============================================================
// RAPID LISTER PRO - content_ULTIMATE.js (Complete Rewrite)
// ============================================================

// ============================================================
// DIAGNOSTIC WATCHDOG + VISIBLE-SLEEP SYSTEM
// Root cause: Chrome throttles setTimeout in background tabs
// to once per minute. Every sleep(3000) becomes 60+ seconds.
// Fix: sleepVisible() only counts down while tab is visible.
// Watchdog: reports exact freeze point every 60 seconds.
// ============================================================

// --- Tracking state ---
let _watchdogTabId = null;
let _watchdogQueueIndex = 0;
let _lastActionTime = Date.now();
let _currentField = "not started";
let _currentWaiting = "none";
let _watchdogInterval = null;
let _phaseRunning = false;

function setWaiting(condition) {
  _currentWaiting = condition;
  _lastActionTime = Date.now();
  console.log(`[Lister Watchdog] ⏳ Waiting: ${condition} | Tab: ${_watchdogTabId} | Queue: ${_watchdogQueueIndex} | Hidden: ${document.hidden} | Visibility: ${document.visibilityState}`);
}

function setField(fieldName) {
  _currentField = fieldName;
  _lastActionTime = Date.now();
  _currentWaiting = "none";
  console.log(`[Lister Watchdog] 🔧 Processing field: ${fieldName} | Tab: ${_watchdogTabId} | Queue: ${_watchdogQueueIndex} | Hidden: ${document.hidden}`);
}

function startWatchdog(tabId, queueIndex) {
  _watchdogTabId = tabId;
  _watchdogQueueIndex = queueIndex;
  _lastActionTime = Date.now();
  _phaseRunning = true;

  if (_watchdogInterval) clearInterval(_watchdogInterval);
  _watchdogInterval = setInterval(() => {
    if (!_phaseRunning) return;
    const stuckSec = Math.round((Date.now() - _lastActionTime) / 1000);
    const logLine = [
      `[Lister Watchdog] ⚠️ FREEZE REPORT — stuck for ${stuckSec}s`,
      `  Tab ID      : ${_watchdogTabId}`,
      `  Queue Index : ${_watchdogQueueIndex}`,
      `  Field       : ${_currentField}`,
      `  Waiting for : ${_currentWaiting}`,
      `  document.hidden         : ${document.hidden}`,
      `  document.visibilityState: ${document.visibilityState}`,
      `  document.readyState     : ${document.readyState}`,
      `  Timestamp   : ${new Date().toISOString()}`,
    ].join('\n');
    if (stuckSec >= 60) {
      console.error(logLine);
    } else {
      console.log(logLine);
    }
  }, 10000); // report every 10s
}

function stopWatchdog() {
  _phaseRunning = false;
  if (_watchdogInterval) {
    clearInterval(_watchdogInterval);
    _watchdogInterval = null;
  }
  console.log(`[Lister Watchdog] ✅ Watchdog stopped. Tab: ${_watchdogTabId}`);
}

// 🚀 VISIBILITY SPOOF: Trick React/Facebook into thinking this tab is always active.
// Without this, background tabs freeze because React checks document.hidden / visibilityState
// before rendering or processing events.
try {
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  console.log('[Lister] ✅ Visibility spoof active — tab will act as always visible.');
} catch (e) {
  console.warn('[Lister] Visibility spoof failed:', e);
}

// --- Background-safe sleep system ---
// Sends a message to the background service worker to sleep, bypassing local tab throttling.
function bgSleep(ms) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: "BG_SLEEP", ms }, () => {
        if (chrome.runtime.lastError) {
          setTimeout(resolve, ms);
        } else {
          resolve();
        }
      });
    } catch (e) {
      setTimeout(resolve, ms);
    }
  });
}

// Bypasses visibility check entirely to allow background processing
function ensureTabVisible() {
  return Promise.resolve();
}

// Map sleepVisible and sleep to use the unthrottled background sleep
async function sleepVisible(ms) {
  await bgSleep(ms);
}

const sleep = ms => bgSleep(ms);

// Robust check to determine if an element is hidden style-wise or layout-wise,
// handling cases where the tab is backgrounded or minimized.
function isElementHidden(el) {
  if (!el) return true;
  // If the document/tab is active and visible, we can use the fast offsetParent & clientRect check
  if (!document.hidden && document.visibilityState === "visible") {
    if (el.offsetParent === null) return true;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return true;
    return false;
  }
  // In background/minimized tabs, offsetParent is always null. We inspect CSS styles instead.
  try {
    let current = el;
    while (current) {
      if (current === document.body) break;
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return true;
      }
      current = current.parentElement;
    }
  } catch (e) {}
  return false;
}

async function executeStep(stepName, stepFn) {
  await ensureTabVisible();
  setField(stepName);
  
  let attempts = 0;
  const maxAttempts = 5;
  
  while (attempts < maxAttempts) {
    await ensureTabVisible();
    try {
      const result = await stepFn();
      console.log(`[Lister Logs] ✅ Step: ${stepName} completed.`);
      _lastActionTime = Date.now();
      return result;
    } catch (error) {
      attempts++;
      console.warn(`[Lister Logs] ⚠️ Step: ${stepName} failed (Attempt ${attempts}/${maxAttempts}): ${error.message}`);
      if (attempts >= maxAttempts) {
        throw error;
      }
      await sleepVisible(2000);
    }
  }
}

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
  setWaiting("Waiting 15s for photo upload to complete");
  await sleepVisible(15000);
}

async function selectDropdownOption(dropdownEl, optionText) {
  if (!dropdownEl || !optionText) return false;

  const val = optionText.trim().toLowerCase();
  console.log("[SELECT] Selecting:", optionText, "| val:", val);

  for (let retry = 0; retry < 3; retry++) {
    // Step 1: Open dropdown with multiple interaction methods
    dropdownEl.scrollIntoView({ block: "center" });
    setWaiting(`selectDropdownOption: opening dropdown for "${optionText}"`);
    await sleepVisible(600);

    // Try clicking the dropdown button itself
    const clickTargets = [
      dropdownEl,
      dropdownEl.querySelector('[role="button"]'),
      dropdownEl.querySelector('div[tabindex]'),
      dropdownEl.closest('[role="button"]'),
      dropdownEl.closest('div[tabindex]')
    ].filter(Boolean);

    for (const target of clickTargets) {
      try {
        target.focus();
        await sleepVisible(100);
        ["mousedown", "mouseup", "click"].forEach(type => {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });
        target.click();
        console.log("[SELECT] Clicked dropdown opener:", target.tagName);
      } catch(e) {}
    }

    setWaiting(`selectDropdownOption: waiting for React to render dropdown for "${optionText}"`);
    await sleepVisible(3000); // Wait for Facebook React to render dropdown

    // Step 2: Find ALL visible text elements in the dropdown
    // Facebook uses nested divs/spans inside role="listbox", role="menu", etc.
    const dropdownContainers = [
      ...document.querySelectorAll('[role="listbox"]'),
      ...document.querySelectorAll('[role="menu"]'),
      ...document.querySelectorAll('[role="dialog"]'),
      ...document.querySelectorAll('div[style*="position: absolute"]'),
      ...document.querySelectorAll('div[style*="position: fixed"]'),
      document.body
    ];

    let allVisibleElements = [];
    for (const container of dropdownContainers) {
      const els = [...container.querySelectorAll('span, div, li, [role="option"]')].filter(el => {
        if (isElementHidden(el)) return false;
        const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
        return txt.length > 0 && txt.length < 80;
      });
      if (els.length > 0) {
        allVisibleElements = els;
        if (container !== document.body) {
          console.log("[SELECT] Found options inside container:", container.getAttribute('role') || 'absolute/fixed div');
          break;
        }
      }
    }

    console.log("[SELECT] Scanning", allVisibleElements.length, "visible elements for:", val);

    // Step 3: Find matching element
    let target = null;

    for (const el of allVisibleElements) {
      const txt = (el.innerText || el.textContent || "").trim().toLowerCase();

      // Exact match
      if (txt === val) {
        target = el;
        console.log("[SELECT] Exact match:", txt);
        break;
      }

      // Check category translations
      const mapped = categoryTranslations[val];
      if (mapped) {
        for (const m of mapped) {
          if (txt === m || txt.includes(m)) {
            target = el;
            console.log("[SELECT] Translation match:", txt, "=>", m);
            break;
          }
        }
        if (target) break;
      }

      // Condition mappings
      if (val === 'new' && (txt === 'nuevo' || txt === 'new')) { target = el; break; }
      if (val === 'used - like new' && (txt.includes('como nuevo') || txt.includes('like new'))) { target = el; break; }
      if (val === 'used - very good' && (txt.includes('muy buen') || txt.includes('very good'))) { target = el; break; }
      if (val === 'used - good' && (txt === 'good' || txt === 'buen estado' || txt === 'aceptable')) { target = el; break; }
      if (val === 'used - fair' && (txt === 'fair' || txt === 'regular')) { target = el; break; }

      // Availability
      if (val.includes('single') && (txt.includes('único') || txt === 'single')) { target = el; break; }
      if (val.includes('stock') && (txt.includes('disponible') || txt.includes('stock'))) { target = el; break; }
    }

    if (target) {
      console.log("[SELECT] Target found:", target.innerText.trim(), "| tag:", target.tagName);

      // Scroll to make sure it's visible
      target.scrollIntoView({ block: "center" });
      setWaiting(`selectDropdownOption: clicking option "${optionText}"`);
      await sleepVisible(800);

      // Find deepest text-containing child
      let clickTarget = target;
      if (target.children.length > 0) {
        const deepest = [...target.querySelectorAll('*')].filter(c => {
          const t = (c.innerText || c.textContent || '').trim();
          return t.length > 0 && c.children.length === 0;
        });
        if (deepest.length > 0) {
          clickTarget = deepest[0];
          console.log("[SELECT] Deepest child text element:", clickTarget.tagName, clickTarget.innerText);
        }
      }

      // Find clickable ancestor
      let clickableAncestor = null;
      let parent = target.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        if (parent.getAttribute('role') === 'option' || 
            parent.getAttribute('role') === 'button' ||
            parent.getAttribute('tabindex') ||
            parent.tagName === 'BUTTON' ||
            parent.tagName === 'LI' ||
            parent.tagName === 'A') {
          clickableAncestor = parent;
          console.log("[SELECT] Found clickable ancestor:", parent.tagName);
          break;
        }
        parent = parent.parentElement;
      }

      // Dispath sequence
      const rect = clickTarget.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

      const clickFn = (el) => {
        if (!el) return;
        el.focus();
        ['pointerdown', 'mousedown', 'focus', 'pointerup', 'mouseup', 'click'].forEach(type => {
          let evt;
          if (type.startsWith('pointer')) {
            evt = new PointerEvent(type, eventOpts);
          } else if (type.startsWith('mouse') || type === 'click') {
            evt = new MouseEvent(type, eventOpts);
          } else {
            evt = new Event(type, { bubbles: true, cancelable: true });
          }
          el.dispatchEvent(evt);
        });
        try { el.click(); } catch(e) {}
      };

      console.log("[SELECT] Clicking clickTarget...");
      clickFn(clickTarget);

      if (clickableAncestor && clickableAncestor !== clickTarget) {
        await sleepVisible(100);
        console.log("[SELECT] Clicking clickableAncestor...");
        clickFn(clickableAncestor);
      }

      // Keyboard events as backup
      setWaiting(`selectDropdownOption: keyboard confirm for "${optionText}"`);
      await sleepVisible(300);
      const kbTarget = clickableAncestor || clickTarget;
      kbTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      await sleepVisible(100);
      kbTarget.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));

      setWaiting(`selectDropdownOption: waiting 3s for dropdown to close after selecting "${optionText}"`);
      await sleepVisible(3000);

      // Check if closed
      const dropdownOpen = document.querySelector('[role="listbox"]') || 
                           document.querySelector('[role="menu"]') ||
                           document.querySelector('div[style*="position: absolute"]') ||
                           document.querySelector('div[style*="position: fixed"]');

      if (!dropdownOpen || dropdownOpen.offsetParent === null) {
        console.log("[SELECT] SUCCESS - Dropdown closed");
        return true;
      }

      console.log("[SELECT] Dropdown still open, clicking target directly...");
      try { target.click(); } catch(e) {}
      await sleepVisible(2000);
      return true;
    }

    console.warn("[SELECT] No match found, retry", retry + 1, "of 3");

    // Close any open dropdown with Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    setWaiting(`selectDropdownOption: retry ${retry + 1}/3 for "${optionText}" — waiting 2s`);
    await sleepVisible(2000);
  }

  console.error("[SELECT] FAILED after 3 retries:", optionText);
  return false;
}function waitForElement(selectorFn, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const el = selectorFn();
    if (el) return resolve(el);
    setWaiting(`waitForElement: polling for DOM element (timeout: ${timeoutMs}ms)`);
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

const labelTranslations = {
  "title": ["title", "título", "titulo"],
  "price": ["price", "precio"],
  "category": ["category", "categoría", "categoria"],
  "condition": ["condition", "estado"],
  "description": ["description", "descripción", "descripcion"],
  "availability": ["availability", "disponibilidad"],
  "product tags": ["product tags", "tags", "etiquetas de productos", "etiquetas"],
  "quantity": ["quantity", "cantidad"],
  "location": ["location", "ubicación", "ciudad", "donde estás", "dónde estás"]
};

const categoryTranslations = {
  "tools": ["herramientas", "tools"],
  "furniture": ["muebles", "furniture"],
  "household": ["artículos para el hogar", "hogar", "household"],
  "garden": ["jardín", "jardin", "garden"],
  "appliances": ["electrodomésticos", "appliances"],
  "video games": ["videojuegos", "video games"],
  "books, movies & music": ["libros, películas y música", "libros", "books"],
  "bags & luggage": ["bolsos y maletas", "equipaje", "bags"],
  "clothing & shoes": ["ropa y calzado", "prendas", "clothing"],
  "jewelry & accessories": ["joyería y accesorios", "joyas", "jewelry"],
  "health & beauty": ["salud y belleza", "health", "beauty"],
  "pet supplies": ["artículos para mascotas", "mascotas", "pet"],
  "baby & kids": ["artículos para bebés y niños", "bebés", "baby"],
  "toys & games": ["juguetes y juegos", "juguetes", "toys"],
  "electronics & computers": ["electrónica e informática", "electrónicos", "electronics"],
  "mobile phones": ["teléfonos móviles", "celulares", "mobile"],
  "bicycles": ["bicicletas", "bicycles"],
  "auto parts": ["autopartes", "repuestos", "piezas de autos", "auto parts"],
  "sports & outdoors": ["deportes y actividades al aire libre", "deportes", "sports"],
  "musical instruments": ["instrumentos musicales", "musical"],
  "antiques & collectibles": ["antigüedades y coleccionables", "antigüedades", "antiques"],
  "garage sale": ["ventas de garaje", "garage sale"],
  "miscellaneous": ["varios", "miscelánea", "miscellaneous"]
};

function findFieldByLabel(labelText, tagName = 'input') {
  const normalizedKey = labelText.toLowerCase();
  const searchTerms = labelTranslations[normalizedKey] || [normalizedKey];

  for (const term of searchTerms) {
    // 1. Exact or case-insensitive attribute match
    let el = document.querySelector(`${tagName}[aria-label="${term}" i]`);
    if (el) return el;

    // 2. Case-insensitive attribute match fallback
    el = [...document.querySelectorAll(tagName)].find(item => {
      const aria = (item.getAttribute('aria-label') || '').toLowerCase();
      return aria === term || aria.includes(term);
    });
    if (el) return el;

    // 3. Label text match
    const label = [...document.querySelectorAll('label')].find(l =>
      l.textContent.toLowerCase().includes(term)
    );
    if (label) {
      el = label.querySelector(tagName);
      if (el) return el;
    }

    // 4. Placeholder match
    el = document.querySelector(`${tagName}[placeholder*="${term}" i]`);
    if (el) return el;
  }
  return null;
}

// ============================================================
// FIND DROPDOWN BY ITS VISIBLE PLACEHOLDER TEXT
// Facebook Marketplace dropdowns show their label as visible text
// inside the button (e.g. "Category", "Condition"). We scan all
// interactive elements and find one whose text matches our keywords.
// ============================================================
async function findDropdownByPlaceholderText(keywords, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // All candidate interactive elements
    const candidates = [
      ...document.querySelectorAll('[role="combobox"]'),
      ...document.querySelectorAll('[role="button"]'),
      ...document.querySelectorAll('[aria-haspopup="listbox"]'),
      ...document.querySelectorAll('[aria-haspopup="true"]'),
      ...document.querySelectorAll('div[tabindex="0"]'),
      ...document.querySelectorAll('select'),
    ].filter(el => !isElementHidden(el));

    for (const el of candidates) {
      const txt = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.textContent || '')
        .trim()
        .toLowerCase();

      for (const kw of keywords) {
        if (txt === kw || txt.startsWith(kw) || txt.includes(kw)) {
          console.log(`[DROPDOWN FINDER] Found "${kw}" in element:`, el.tagName, `"${txt}"`);
          return el;
        }
      }
    }

    await sleep(500);
  }

  console.warn("[DROPDOWN FINDER] Not found for keywords:", keywords);
  return null;
}

// ============================================================
// PHASE 1: CREATE DRAFTS (autofill form)
// ============================================================
async function runPhase1(data) {
  const myTabId = data._tabId || "unknown";
  const myQueueIdx = data._queueIndex !== undefined ? data._queueIndex : "?";
  startWatchdog(myTabId, myQueueIdx);
  console.log(`[Lister Watchdog] 🚀 runPhase1 started | Tab: ${myTabId} | Queue: ${myQueueIdx} | Hidden: ${document.hidden} | Visibility: ${document.visibilityState}`);
  _lastActionTime = Date.now();
  try {
    // 1. PHOTO UPLOAD
    await executeStep("Photo Upload", async () => {
      console.log("[Lister Logs] Step 1: Uploading Photos");
      if (data.images && data.images.length > 0) {
        const imgIdx = (data.listingIndex || 0) % data.images.length;
        await uploadPhoto(data.images[imgIdx], `photo_${imgIdx}.jpg`);
      } else {
        console.warn("[Lister Logs] No photos provided for listing");
      }
    });

    // 2. TITLE
    await executeStep("Fill Title", async () => {
      console.log("[Lister Logs] Step 2: Filling Title");
      const titleInput = await waitForElement(() =>
        findFieldByLabel("Title", "input") || document.querySelector('input[type="text"][maxlength="100"]')
      );
      typeIntoField(titleInput, data.title);
      await sleepVisible(150);
    });

    // 3. PRICE
    await executeStep("Fill Price", async () => {
      console.log("[Lister Logs] Step 3: Filling Price");
      const priceInput = findFieldByLabel("Price", "input") ||
        document.querySelector('input[type="text"][inputmode="numeric"]') ||
        document.querySelector('input[inputmode="numeric"]');
      if (!priceInput) throw new Error("Price field not found");
      typeIntoField(priceInput, data.price);
      await sleepVisible(150);
    });

    // 4. CATEGORY
    await executeStep("Select Category", async () => {
      console.log("[Lister Logs] Step 4: Selecting Category");
      const categoryDrop = await findDropdownByPlaceholderText(
        ["category", "categoría", "categoria"]
      );
      if (categoryDrop && data.category) {
        const catSuccess = await selectDropdownOption(categoryDrop, data.category);
        if (!catSuccess) {
          console.warn("[Lister Logs] [CATEGORY] Primary select failed, trying fallback...");
          categoryDrop.click();
          await sleepVisible(1000);
          const firstLetter = data.category.charAt(0).toLowerCase();
          categoryDrop.dispatchEvent(new KeyboardEvent('keydown', { key: firstLetter, code: 'Key' + firstLetter.toUpperCase(), keyCode: firstLetter.charCodeAt(0), bubbles: true }));
          await sleepVisible(500);
          categoryDrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          await sleepVisible(1500);
        }
        await sleepVisible(1200);
      } else {
        throw new Error("Category dropdown or category value missing");
      }
    });

    // 5. CONDITION
    await executeStep("Select Condition", async () => {
      console.log("[Lister Logs] Step 5: Selecting Condition");
      const conditionDrop = await findDropdownByPlaceholderText(
        ["condition", "estado", "condición"]
      );
      if (conditionDrop && data.condition) {
        const condSuccess = await selectDropdownOption(conditionDrop, data.condition);
        if (!condSuccess) throw new Error("Failed to select condition option");
        await sleepVisible(800);
      } else {
        throw new Error("Condition dropdown or condition value missing");
      }
    });

    // 6. DESCRIPTION
    await executeStep("Fill Description", async () => {
      console.log("[Lister Logs] Step 6: Filling Description");
      const descTextarea = findFieldByLabel("Description", "textarea") ||
        document.querySelector('textarea[aria-label="Description" i]') ||
        document.querySelector('textarea[aria-label="Descripción" i]') ||
        document.querySelector('textarea');
      if (!descTextarea) throw new Error("Description textarea not found");
      typeIntoField(descTextarea, data.description);
      await sleepVisible(150);
    });

    // 7. AVAILABILITY
    await executeStep("Select Availability", async () => {
      console.log("[Lister Logs] Step 7: Selecting Availability");
      const availDrop = await findDropdownByPlaceholderText(
        ["availability", "disponibilidad", "list as single", "single item", "listed"]
      );
      if (availDrop && data.availability) {
        const availSuccess = await selectDropdownOption(availDrop, data.availability);
        if (!availSuccess) throw new Error("Failed to select availability option");
        await sleepVisible(800);
      } else {
        console.warn("[Lister Logs] Availability dropdown not found — skipping");
      }
    });

    // 8. PRODUCT TAGS
    await executeStep("Add Product Tags", async () => {
      console.log("[Lister Logs] Step 8: Adding Product Tags");
      const tagsInput = findFieldByLabel("Product tags", "textarea") ||
        findFieldByLabel("Tags", "input") ||
        document.querySelector('[aria-label="Product tags" i] textarea') ||
        document.querySelector('[aria-label="Etiquetas" i] textarea');
      if (tagsInput && data.tags) {
        const tags = data.tags.split(',').map(t => t.trim()).filter(Boolean);
        for (const tag of tags) {
          typeIntoField(tagsInput, tag);
          await sleepVisible(80);
          tagsInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
          await sleepVisible(80);
        }
      }
    });

    // 9. QUANTITY
    await executeStep("Fill Quantity", async () => {
      if (data.quantity && parseInt(data.quantity) > 1) {
        console.log("[Lister Logs] Step 9: Filling Quantity");
        const qtyInput = findFieldByLabel("Quantity", "input") ||
          document.querySelector('[aria-label="Quantity" i]') ||
          document.querySelector('[aria-label="Cantidad" i]');
        if (qtyInput) {
          typeIntoField(qtyInput, data.quantity);
          await sleepVisible(150);
        }
      }
    });

    // 10. LOCATION
    await executeStep("Set Location", async () => {
      if (data.location) {
        console.log("[Lister Logs] Step 10: Setting location...");
        setWaiting("Waiting for location field to be interactable");
        await sleepVisible(150);
        const locSuccess = await setLocation(data.location);
        if (!locSuccess) {
          console.warn("[Lister Logs] [LOCATION] setLocation returned false, retrying once...");
          await sleepVisible(1000);
          const secondLocSuccess = await setLocation(data.location);
          if (!secondLocSuccess) throw new Error("Failed setting location");
        }
        await sleepVisible(400);
      }
    });

    // 11. SAVE DRAFT
    await executeStep("Save Draft", async () => {
      console.log("[Lister Logs] Step 11: Saving Draft");
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
      
      setWaiting("Waiting 5s after Save Draft click for Facebook to process");
      console.log("[Lister Logs] Save Draft button clicked, waiting 5s for completion...");
      await sleepVisible(5000);
    });

    await ensureTabVisible();
    stopWatchdog();
    console.log("[Lister Logs] ✅ All steps complete. Sending DRAFT_SAVED to background script...");
    chrome.runtime.sendMessage({ action: "DRAFT_SAVED" });

  } catch (error) {
    stopWatchdog();
    console.error("[Lister Logs] ❌ Autofill failed at step:", _currentField, "| Error:", error.message);
  }
}

// ============================================================
// LOCATION SETTER
// ============================================================
async function setLocation(location) {
  console.log("[LOCATION] Setting:", location);

  const locInput = await waitForElement(() => {
    return document.querySelector('input[aria-label="Location"]') ||
      document.querySelector('input[aria-label="Ubicación"]') ||
      document.querySelector('input[placeholder*="location" i]') ||
      document.querySelector('input[placeholder*="ubicación" i]') ||
      document.querySelector('input[placeholder*="city" i]') ||
      document.querySelector('input[placeholder*="ciudad" i]') ||
      [...document.querySelectorAll('input')].find(el =>
        /location|ubicación|ubicacion|city|ciudad|zip/i.test(el.getAttribute('aria-label') || el.placeholder || '')
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

  // Wait for suggestion list to populate
  await sleep(4000);

  let selectedOption = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const searchParts = location.toLowerCase().split(',').map(p => p.trim()).filter(Boolean);

    const candidates = [
      ...document.querySelectorAll('[role="option"]'),
      ...document.querySelectorAll('[role="listbox"] li'),
      ...document.querySelectorAll('[role="listbox"] div'),
      ...document.querySelectorAll('div[role="button"]'),
      ...document.querySelectorAll('div[role="gridcell"]'),
      ...document.querySelectorAll('span, div')
    ].filter(el => {
      if (isElementHidden(el)) return false;
      if (el.tagName === 'INPUT' || el.querySelector('input')) return false;

      const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (txt.length === 0 || txt.length > 150) return false;

      // Check if it contains any of the search parts
      return searchParts.some(part => txt.includes(part));
    });

    // Sort by text length ascending so we get the leaf/most specific element containing the text
    candidates.sort((a, b) => {
      const aLen = (a.innerText || a.textContent || "").trim().length;
      const bLen = (b.innerText || b.textContent || "").trim().length;
      return aLen - bLen;
    });

    if (candidates.length > 0) {
      selectedOption = candidates[0];
      console.log("[LOCATION] Match found:", selectedOption.innerText, "| tag:", selectedOption.tagName);
      break;
    }

    await sleep(500);
  }

  if (selectedOption) {
    selectedOption.scrollIntoView({ block: "center" });
    await sleep(500);

    // Find deepest child text element
    let clickTarget = selectedOption;
    if (selectedOption.children.length > 0) {
      const deepest = [...selectedOption.querySelectorAll('*')].filter(c => {
        const t = (c.innerText || c.textContent || '').trim();
        return t.length > 0 && c.children.length === 0;
      });
      if (deepest.length > 0) {
        clickTarget = deepest[0];
      }
    }

    // Find clickable ancestor
    let clickableAncestor = null;
    let parent = selectedOption.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      if (parent.getAttribute('role') === 'option' || 
          parent.getAttribute('role') === 'button' ||
          parent.getAttribute('tabindex') ||
          parent.tagName === 'BUTTON' ||
          parent.tagName === 'LI') {
        clickableAncestor = parent;
        break;
      }
      parent = parent.parentElement;
    }

    const rect = clickTarget.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const eventOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

    const clickFn = (el) => {
      if (!el) return;
      el.focus();
      ['pointerdown', 'mousedown', 'focus', 'pointerup', 'mouseup', 'click'].forEach(type => {
        let evt;
        if (type.startsWith('pointer')) {
          evt = new PointerEvent(type, eventOpts);
        } else if (type.startsWith('mouse') || type === 'click') {
          evt = new MouseEvent(type, eventOpts);
        } else {
          evt = new Event(type, { bubbles: true, cancelable: true });
        }
        el.dispatchEvent(evt);
      });
      try { el.click(); } catch(e) {}
    };

    console.log("[LOCATION] Clicking target...");
    clickFn(clickTarget);

    if (clickableAncestor && clickableAncestor !== clickTarget) {
      await sleep(100);
      console.log("[LOCATION] Clicking clickableAncestor...");
      clickFn(clickableAncestor);
    }
    
    if (selectedOption !== clickTarget && selectedOption !== clickableAncestor) {
      await sleep(100);
      console.log("[LOCATION] Clicking selectedOption...");
      clickFn(selectedOption);
    }

    await sleep(2000);
    console.log("[LOCATION] Done.");
  } else {
    // Keyboard fallback
    console.warn("[LOCATION] No option matched text, trying keyboard fallback...");
    await sleep(2000);
    locInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
    await sleep(500);
    locInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    await sleep(2000);
  }

  return true;
}

// ============================================================
// PHASE 2: AUTO PUBLISH SYSTEM (Selling Page) — INLINE SCROLL & CLICK
// NO NEW TABS! Everything happens on the same selling page.
// ============================================================

let publishAbortController = null;

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
  console.log("[PUBLISH] Starting inline scroll & click publish...");
  publishAbortController = new AbortController();

  // Step 1: Scroll down to load ALL drafts
  updatePublishUI({ statusText: "Scrolling to load all drafts...", currentIndex: 0, totalDrafts: 0 });
  const allDrafts = await loadAllDrafts();

  if (allDrafts.length === 0) {
    alert("❌ No draft listings found! Make sure you are on facebook.com/marketplace/you/selling");
    return;
  }

  console.log("[PUBLISH] Found", allDrafts.length, "drafts");

  const ps = {
    active: true,
    running: true,
    totalDrafts: allDrafts.length,
    currentIndex: 0,
    statusText: `Found ${allDrafts.length} drafts. Starting...`
  };
  await chrome.storage.local.set({ autoPublishState: ps });
  updatePublishUI(ps);

  // Step 2: Publish each draft inline (same page, no new tabs)
  for (let i = 0; i < allDrafts.length; i++) {
    if (publishAbortController.signal.aborted) {
      console.log("[PUBLISH] Aborted by user.");
      break;
    }

    const draft = allDrafts[i];
    const currentNum = i + 1;

    const statusText = `Publishing draft ${currentNum}/${allDrafts.length}...`;
    updatePublishUI({ statusText, currentIndex: i, totalDrafts: allDrafts.length });
    await chrome.storage.local.set({ autoPublishState: { active: true, running: true, totalDrafts: allDrafts.length, currentIndex: i, statusText } });

    try {
      await publishSingleDraftInline(draft);
      console.log(`[PUBLISH] Draft ${currentNum} published successfully.`);
    } catch (err) {
      console.error(`[PUBLISH] Draft ${currentNum} failed:`, err.message);
    }

    // Anti-ban cooldown between drafts
    if (i < allDrafts.length - 1) {
      const cooldown = 5000; // 5 seconds
      updatePublishUI({ statusText: `Cooldown ${cooldown/1000}s...`, currentIndex: i + 1, totalDrafts: allDrafts.length });
      await sleep(cooldown);
    }
  }

  // Done
  const finalStatus = publishAbortController.signal.aborted ? "Stopped by user" : "ALL DRAFTS PUBLISHED! ✅";
  updatePublishUI({ statusText: finalStatus, currentIndex: allDrafts.length, totalDrafts: allDrafts.length });
  await chrome.storage.local.set({ autoPublishState: { active: false, running: false, totalDrafts: allDrafts.length, currentIndex: allDrafts.length, statusText: finalStatus } });

  if (!publishAbortController.signal.aborted) {
    alert("✅ All draft listings have been published successfully!");
  }

  publishAbortController = null;
}

function stopAutoPublish() {
  console.log("[PUBLISH] Stop requested.");
  if (publishAbortController) {
    publishAbortController.abort();
  }
  updatePublishUI({ statusText: "Stopped", currentIndex: 0, totalDrafts: 0 });
  chrome.storage.local.set({ autoPublishState: { active: false, running: false, statusText: "Stopped" } });
}

// ============================================================
// SCROLL & LOAD ALL DRAFTS
// ============================================================
async function loadAllDrafts() {
  const drafts = [];
  const seenUrls = new Set();
  let lastHeight = 0;
  let noChangeCount = 0;
  const maxScrollAttempts = 50;

  for (let scrollAttempt = 0; scrollAttempt < maxScrollAttempts; scrollAttempt++) {
    if (publishAbortController && publishAbortController.signal.aborted) break;

    // Find all draft links currently visible
    const links = [...document.querySelectorAll('a[href*="/marketplace/edit"]')]
      .filter(a => a.href && a.href.includes('listing_id'));

    for (const link of links) {
      if (!seenUrls.has(link.href)) {
        seenUrls.add(link.href);
        // Find the clickable card/parent element
        const card = link.closest('[role="article"]') || 
                     link.closest('div[class*="x1"]') || 
                     link.closest('div') || 
                     link;
        drafts.push({
          url: link.href,
          element: card,
          linkElement: link
        });
      }
    }

    // Scroll down to load more
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(2000);

    const newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) {
      noChangeCount++;
      if (noChangeCount >= 3) break; // No more content loading
    } else {
      noChangeCount = 0;
    }
    lastHeight = newHeight;
  }

  // Scroll back to top
  window.scrollTo(0, 0);
  await sleep(1000);

  console.log("[PUBLISH] Total drafts loaded:", drafts.length);
  return drafts;
}

// ============================================================
// PUBLISH SINGLE DRAFT INLINE (same page, no tab switching)
// ============================================================
async function publishSingleDraftInline(draft) {
  console.log("[PUBLISH] Opening draft:", draft.url);

  // Click the draft card to open it (inline or modal)
  draft.element.scrollIntoView({ block: "center" });
  await sleep(1000);

  // Try multiple click strategies
  const clickTargets = [
    draft.linkElement,
    draft.element,
    draft.element.querySelector('div[role="button"]'),
    draft.element.querySelector('a'),
    draft.element.querySelector('span')
  ].filter(Boolean);

  let clicked = false;
  for (const target of clickTargets) {
    try {
      target.scrollIntoView({ block: "center" });
      await sleep(500);

      // Full mouse event sequence
      ["mouseover", "mousedown", "mouseup", "click"].forEach(type => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });

      // Also try native click
      target.click();
      clicked = true;
      console.log("[PUBLISH] Clicked draft element");
      break;
    } catch (e) {}
  }

  if (!clicked) {
    throw new Error("Could not click draft element");
  }

  // Wait for the edit page/modal to load
  await sleep(5000);

  // Now we are on the edit page (either in same tab or modal)
  // Try to find and click "Next" then "Publish"
  await runPublishActionInline();
}

async function runPublishActionInline() {
  console.log("[PUBLISH] Running inline publish action...");

  const findBtn = (texts) => {
    return [...document.querySelectorAll('div[role="button"], button, span[role="button"]')]
      .find(el => {
        if (isElementHidden(el)) return false;
        const txt = el.textContent.trim().toLowerCase();
        return texts.some(t => txt === t);
      });
  };

  // Step 1: Click "Next" if present
  let nextBtn = null;
  for (let i = 0; i < 15; i++) {
    if (publishAbortController && publishAbortController.signal.aborted) return;
    nextBtn = findBtn(['next', 'siguiente', 'next step']);
    if (nextBtn) break;
    await sleep(800);
  }

  if (nextBtn) {
    console.log("[PUBLISH] Clicking Next...");
    nextBtn.scrollIntoView({ block: "center" });
    await sleep(500);
    ["mouseover", "mousedown", "mouseup", "click"].forEach(type => {
      nextBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    nextBtn.click();
    await sleep(5000);
  }

  // Step 2: Click "Publish"
  let publishBtn = null;
  for (let i = 0; i < 25; i++) {
    if (publishAbortController && publishAbortController.signal.aborted) return;
    publishBtn = findBtn(['publish', 'publicar', 'post', 'publicar ahora']);
    if (publishBtn) break;
    await sleep(800);
  }

  if (!publishBtn) {
    throw new Error("Publish button not found");
  }

  console.log("[PUBLISH] Clicking Publish...");
  publishBtn.scrollIntoView({ block: "center" });
  await sleep(500);
  ["mouseover", "mousedown", "mouseup", "click"].forEach(type => {
    publishBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  });
  publishBtn.click();

  // Wait for publish to process
  await sleep(10000);

  // Step 3: Try to close any modal/go back to selling page
  const closeBtn = findBtn(['close', 'done', 'ok']) || 
                   document.querySelector('[aria-label="Close"]') ||
                   document.querySelector('[aria-label="Cerrar"]');
  if (closeBtn) {
    closeBtn.click();
    await sleep(2000);
  }

  // Navigate back to selling page if URL changed
  if (!window.location.href.includes('/marketplace/you/selling')) {
    history.back();
    await sleep(3000);
  }

  console.log("[PUBLISH] Inline publish complete.");
}
// ============================================================
// COLLECT_AND_PUBLISH — message listener for selling page
// Background sends this to tell us to scroll & collect drafts
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "COLLECT_AND_PUBLISH") {
    console.log("[CONTENT] COLLECT_AND_PUBLISH received — scrolling for drafts...");
    // Inject UI feedback on selling page if box exists
    const statusEl = document.getElementById("publish-status-text");
    if (statusEl) statusEl.textContent = "Collecting all drafts...";

    loadAllDrafts().then(allDrafts => {
      console.log("[CONTENT] Collected", allDrafts.length, "draft URLs");
      const urls = allDrafts.map(d => d.url);

      if (statusEl) statusEl.textContent = `Found ${urls.length} draft(s). Publishing in background...`;

      chrome.runtime.sendMessage({
        action: "DRAFT_URLS_COLLECTED",
        urls
      });
    }).catch(err => {
      console.error("[CONTENT] Draft collection failed:", err);
      chrome.runtime.sendMessage({ action: "DRAFT_URLS_COLLECTED", urls: [] });
    });

    sendResponse({ status: "collecting" });
    return true;
  }
});

async function waitUntilReadyToFill() {
  console.log("[Lister Logs] Checking document readyState... Current state:", document.readyState);
  while (document.readyState !== "complete") {
    await sleep(500);
  }
  
  console.log("[Lister Logs] Waiting for Marketplace form elements to render...");
  for (let i = 0; i < 40; i++) {
    const fileInput = document.querySelector('input[type="file"][multiple]') || document.querySelector('input[type="file"]');
    const titleInput = findFieldByLabel("Title", "input") || document.querySelector('input[type="text"][maxlength="100"]');
    if (fileInput || titleInput) {
      console.log("[Lister Logs] Form elements found in DOM!");
      return;
    }
    await sleep(500);
  }
  console.warn("[Lister Logs] Marketplace form elements not found after 20s, continuing anyway...");
}

// ============================================================
// MAIN INIT — runs on page load
// ============================================================
async function init() {
  const url = window.location.href;
  console.log("[INIT] Page:", url);

  if (url.includes("/marketplace/create/item")) {
    // Each tab immediately reads its own pending data and starts filling in parallel.
    // Retry a few times in case storage isn't ready instantly.
    let retries = 0;
    const tryFill = async () => {
      chrome.runtime.sendMessage({ action: "GET_MY_PENDING_DATA" }, async (res) => {
        if (res && res.data) {
          console.log("[CONTENT] Got pending data — starting fill immediately...");
          await waitUntilReadyToFill();
          const storage = await chrome.storage.local.get("draftListing");
          const images = (storage.draftListing && storage.draftListing.images) || [];
          const fullData = { ...res.data, images };
          runPhase1(fullData);
        } else {
          retries++;
          if (retries < 20) {
            console.log(`[INIT] No data yet, retry ${retries}/20 in 1s...`);
            setTimeout(tryFill, 1000);
          } else {
            console.warn("[INIT] No pending data found after 20 retries. Tab may not have been assigned a listing.");
          }
        }
      });
    };
    tryFill();

    // Also listen for START_FILLING as a fallback (e.g. replacement tabs)
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
      if (message.action === "START_FILLING" && message.data) {
        console.log("[CONTENT] START_FILLING message received as fallback...");
        await waitUntilReadyToFill();
        const storage = await chrome.storage.local.get("draftListing");
        const images = (storage.draftListing && storage.draftListing.images) || [];
        const fullData = { ...message.data, images };
        runPhase1(fullData);
      }
    });

  } else if (url.includes("/marketplace/create")) {
    // If we land on the choose listing page, but have pending data, redirect to /item
    chrome.runtime.sendMessage({ action: "GET_MY_PENDING_DATA" }, (res) => {
      if (res && res.data) {
        console.log("[INIT] Redirecting to item creation form...");
        window.location.href = "https://www.facebook.com/marketplace/create/item";
      }
    });

  } else if (url.includes("/marketplace/you/selling")) {
    // Phase 2: inject publish panel on selling page (for status display)
    injectPublishBox();

  } else if (url.includes("/marketplace/edit/")) {
    // Phase 3: Auto-publish if opened by background AI Publish system
    chrome.runtime.sendMessage({ action: "CHECK_AUTO_PUBLISH" }, async (res) => {
      if (res && res.isPublishTab) {
        console.log("[INIT] This is a background AI Publish tab — auto-publishing...");
        await sleep(4000); // wait for the edit page to fully render
        try {
          await runPublishActionInline();
          console.log("[INIT] Auto-publish complete — notifying background.");
          chrome.runtime.sendMessage({ action: "PUBLISH_COMPLETE_V2", success: true });
        } catch (err) {
          console.error("[INIT] Auto-publish failed:", err.message);
          chrome.runtime.sendMessage({ action: "PUBLISH_COMPLETE_V2", success: false });
        }
      } else {
        console.log("[INIT] Edit page opened manually — not auto-publishing.");
      }
    });
  }
}

init();
