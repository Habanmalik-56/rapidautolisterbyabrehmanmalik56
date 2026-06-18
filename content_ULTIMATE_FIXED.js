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

  const val = optionText.trim().toLowerCase();
  console.log("[SELECT] Selecting:", optionText);

  function matchesOption(el) {
    const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
    if (!txt || txt.length > 100) return false;

    // Exact match
    if (txt === val) return true;

    // Condition mappings
    if (val === 'new' && (txt === 'nuevo' || txt === 'new')) return true;
    if (val === 'used - like new' && (txt.includes('como nuevo') || txt.includes('like new'))) return true;
    if (val === 'used - very good' && (txt.includes('muy buen') || txt.includes('very good'))) return true;
    if (val === 'used - good' && (txt === 'good' || txt === 'buen estado' || txt === 'aceptable')) return true;
    if (val === 'used - fair' && (txt === 'fair' || txt === 'regular' || txt === 'aceptable')) return true;

    // Availability mappings
    if (val.includes('single') && (txt.includes('único') || txt === 'single')) return true;
    if (val.includes('stock') && (txt.includes('disponible') || txt.includes('stock'))) return true;

    // Category: check English exact match
    if (txt === val) return true;

    // Category: check translation map
    const mapped = categoryTranslations[val];
    if (mapped) {
      for (const m of mapped) {
        if (txt === m) return true;
        if (txt.includes(m) && txt.length < 60) return true;
      }
    }

    // Partial match for longer category names
    if (txt.includes(val) && txt.length < 60) return true;
    if (val.includes(txt) && txt.length > 3) return true;

    return false;
  }

  for (let retry = 0; retry < 3; retry++) {
    // Step 1: Click to open dropdown
    dropdownEl.scrollIntoView({ block: "center" });
    await sleep(500);

    // Full interaction sequence to open dropdown
    dropdownEl.focus();
    await sleep(200);
    ["mousedown", "mouseup", "click"].forEach(type =>
      dropdownEl.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    );
    dropdownEl.click();
    await sleep(3000); // Wait longer for React to render dropdown

    // Step 2: Find matching option — comprehensive search
    let allOptions = [
      ...document.querySelectorAll('[role="option"]'),
      ...document.querySelectorAll('[role="menuitem"]'),
      ...document.querySelectorAll('[data-value]'),
      ...document.querySelectorAll('ul li'),
      ...document.querySelectorAll('[class*="x1"] [role="none"]'),
      ...document.querySelectorAll('div[tabindex]'),
    ].filter(el => el.offsetParent !== null);

    let target = allOptions.find(matchesOption);

    // Step 3: Deep fallback — search ALL visible elements with text
    if (!target) {
      console.log("[SELECT] Fallback: searching all visible elements...");
      const all = [...document.querySelectorAll('span, div, li, a, button')]
        .filter(el => {
          if (el.offsetParent === null) return false;
          const t = (el.innerText || el.textContent || "").trim();
          return t.length > 0 && t.length < 100;
        });
      target = all.find(matchesOption);
    }

    if (target) {
      console.log("[SELECT] Found:", `"${target.innerText.trim()}"`, target.tagName);
      target.scrollIntoView({ block: "center" });
      await sleep(800);

      // Method 1: Full mouse event sequence on the element
      for (const el of [target, target.closest('[role="option"]'), target.closest('li'), target.closest('[tabindex]')]) {
        if (!el) continue;
        ["mouseover", "mouseenter", "mousedown", "mouseup", "click"].forEach(type => {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });
        try { el.click(); } catch(e) {}
      }

      await sleep(3000);

      // Check if dropdown closed (option selected)
      const dropdownStillOpen = document.querySelector('[role="listbox"]') || 
                                 document.querySelector('[role="menu"]') ||
                                 document.querySelector('ul[role="listbox"]');
      if (!dropdownStillOpen) {
        console.log("[SELECT] Dropdown closed — option selected successfully");
        return true;
      }

      // If dropdown still open, try keyboard fallback
      console.log("[SELECT] Dropdown still open, trying keyboard...");
      target.focus();
      await sleep(300);
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      await sleep(300);
      target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      await sleep(3000);
      return true;
    }

    console.warn("[SELECT] No match found, retry", retry + 1, "of 3");

    // Close dropdown if open (press Escape)
    dropdownEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(1500);
  }

  console.error("[SELECT] FAILED to find option:", optionText);
  return false;
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
    ].filter(el => el.offsetParent !== null);

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
    // Find the Category dropdown by looking for any interactive element whose visible text is "Category"
    const categoryDrop = await findDropdownByPlaceholderText(
      ["category", "categoría", "categoria"]
    );
    if (categoryDrop && data.category) {
      await selectDropdownOption(categoryDrop, data.category);
      await sleep(4000);
    } else {
      console.warn("[CATEGORY] Dropdown not found — skipping");
    }

    // 5. CONDITION
    console.log("Step 5: Selecting Condition");
    const conditionDrop = await findDropdownByPlaceholderText(
      ["condition", "estado", "condición"]
    );
    if (conditionDrop && data.condition) {
      await selectDropdownOption(conditionDrop, data.condition);
      await sleep(2000);
    } else {
      console.warn("[CONDITION] Dropdown not found — skipping");
    }

    // 6. DESCRIPTION
    console.log("Step 6: Filling Description");
    const descTextarea = findFieldByLabel("Description", "textarea") ||
      document.querySelector('textarea[aria-label="Description" i]') ||
      document.querySelector('textarea[aria-label="Descripción" i]') ||
      document.querySelector('textarea');
    if (descTextarea) {
      typeIntoField(descTextarea, data.description);
      await sleep(500);
    }

    // 7. AVAILABILITY
    console.log("Step 7: Selecting Availability");
    const availDrop = await findDropdownByPlaceholderText(
      ["availability", "disponibilidad", "list as single", "single item", "listed"]
    );
    if (availDrop && data.availability) {
      await selectDropdownOption(availDrop, data.availability);
      await sleep(2000);
    } else {
      console.warn("[AVAILABILITY] Dropdown not found — skipping");
    }

    // 8. PRODUCT TAGS
    console.log("Step 8: Adding Product Tags");
    const tagsInput = findFieldByLabel("Product tags", "textarea") ||
      findFieldByLabel("Tags", "input") ||
      document.querySelector('[aria-label="Product tags" i] textarea') ||
      document.querySelector('[aria-label="Etiquetas" i] textarea');
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
      const qtyInput = findFieldByLabel("Quantity", "input") ||
        document.querySelector('[aria-label="Quantity" i]') ||
        document.querySelector('[aria-label="Cantidad" i]');
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

  // Step 1: Focus and clear input properly
  locInput.scrollIntoView({ block: "center" });
  await sleep(500);
  locInput.click();
  await sleep(300);
  locInput.focus();
  await sleep(300);

  // Step 2: Clear using native setter
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(locInput, '');
  locInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(500);

  // Step 3: Type character by character with proper events
  const text = String(location);
  for (const char of text) {
    setter.call(locInput, locInput.value + char);
    locInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
    await sleep(50); // Small delay between characters
  }

  // Step 4: Trigger change and key events to activate dropdown
  locInput.dispatchEvent(new Event('change', { bubbles: true }));
  locInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', code: 'End', keyCode: 35, bubbles: true }));
  await sleep(100);
  locInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', code: 'End', keyCode: 35, bubbles: true }));

  console.log("[LOCATION] Typed:", location);
  await sleep(4000); // Wait for suggestions to appear

  // Step 5: Try to select first suggestion via mouse click
  let selectedOption = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const options = [
      ...document.querySelectorAll('[role="option"]'),
      ...document.querySelectorAll('[role="listbox"] li'),
      ...document.querySelectorAll('[role="listbox"] div'),
      ...document.querySelectorAll('ul li'),
      ...document.querySelectorAll('[class*="x1"] div'),
    ].filter(el =>
      el.offsetParent !== null &&
      (el.innerText || el.textContent || "").trim().length > 0
    );

    if (options.length > 0) {
      selectedOption = options[0]; // ALWAYS FIRST SUGGESTION
      console.log("[LOCATION] First suggestion found:", selectedOption.innerText || selectedOption.textContent);
      break;
    }

    await sleep(500);
  }

  if (selectedOption) {
    selectedOption.scrollIntoView({ block: "center" });
    await sleep(800);

    // Full mouse interaction sequence
    ["mouseover", "mouseenter", "mousedown", "mouseup", "click"].forEach(type => {
      selectedOption.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
    });
    try { selectedOption.click(); } catch(e) {}

    await sleep(3000);
    console.log("[LOCATION] Done via mouse click.");
  } else {
    // Step 6: Keyboard fallback - MOST RELIABLE for Facebook
    console.log("[LOCATION] No suggestion found via mouse, using keyboard fallback...");
    locInput.focus();
    await sleep(1000);

    // Press ArrowDown to open/select first suggestion
    locInput.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        keyCode: 40,
        bubbles: true,
        cancelable: true
      })
    );
    await sleep(100);
    locInput.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "ArrowDown",
        code: "ArrowDown",
        keyCode: 40,
        bubbles: true,
        cancelable: true
      })
    );
    await sleep(1500);

    // Press Enter to select
    locInput.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true
      })
    );
    await sleep(100);
    locInput.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true
      })
    );
    await sleep(3000);
    console.log("[LOCATION] Done via keyboard fallback.");
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
        if (el.offsetParent === null) return false;
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
