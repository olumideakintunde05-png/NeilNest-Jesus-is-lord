/* ==========================================================================
   add-business.js — NeilNest "Add Your Business" 4-step wizard
   ========================================================================== */

/* ---------------------------------------------------------------------
   CONFIG — fill these in with your Cloudinary account before going live.
   Dashboard → Settings → Upload → Upload presets → create an UNSIGNED preset.
--------------------------------------------------------------------- */
const CLOUDINARY_CLOUD_NAME = "dhwelpyz";     // e.g. "neilnest"
const CLOUDINARY_UPLOAD_PRESET = "NeilNest";  // e.g. "neilnest_unsigned"
const ADMIN_APPROVAL_ENABLED = true;  // false = businesses go live immediately

/* ---------------------------------------------------------------------
   Static reference data
--------------------------------------------------------------------- */
const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","Gombe","Imo","Jigawa",
  "Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger",
  "Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe",
  "Zamfara","FCT - Abuja"
];

const BUSINESS_CATEGORIES = [
  "Fragrance Store","Shortlet Apartments","Restaurant","Fitness Center",
  "Photography Studio","Beauty Spa","clothing appearl","Fashion Retail",
  "Real Estate Agency","Electronics Store","Event Planning","Cleaning Services",
  "Auto Repair","Salon & Barbershop","Bakery","Grocery Store",
  "Logistics & Delivery","Law Firm","Medical Clinic","Education & Tutoring",
  "IT Services","Interior Design","Construction","Other"
];
function isListedCategory(v) { return BUSINESS_CATEGORIES.slice(0, -1).includes(v); }

const SOCIAL_PLATFORMS = [
  { key: "facebook",  label: "Facebook",  placeholder: "facebook.com/yourbusiness" },
  { key: "instagram", label: "Instagram", placeholder: "instagram.com/yourbusiness" },
  { key: "tiktok",    label: "TikTok",    placeholder: "tiktok.com/@yourbusiness" },
  { key: "linkedin",  label: "LinkedIn",  placeholder: "linkedin.com/company/yourbusiness" },
  { key: "x",         label: "X (Twitter)", placeholder: "x.com/yourbusiness" },
  { key: "youtube",   label: "YouTube",   placeholder: "youtube.com/@yourbusiness" }
];

/* Image/product caps now come from PLAN_CATALOG in billing.js — no local
   copy of these numbers. (A local IMAGE_CAPS constant used to live here;
   it silently drifted out of sync with billing.js once, which is exactly
   the bug this avoids.) */
function imageCapFor(plan) {
  const cap = PLAN_CATALOG[plan] ? PLAN_CATALOG[plan].limits.imagesPerProduct : PLAN_CATALOG.free.limits.imagesPerProduct;
  return cap; // null = unlimited
}
function productCapFor(plan) {
  const cap = PLAN_CATALOG[plan] ? PLAN_CATALOG[plan].limits.products : PLAN_CATALOG.free.limits.products;
  return cap; // null = unlimited
}

/* ---------------------------------------------------------------------
   State
--------------------------------------------------------------------- */
let currentStep = 1;
let currentUser = null;
let currentPlan = "free";
let isPublishing = false;
let EDIT_MODE = { active: false, businessId: null, jumpToItemKey: null, existingLogoUrl: "", existingCoverUrl: "", logoRemoved: false, coverRemoved: false, deletedProductIds: [], deletedServiceIds: [] };

const STATE = {
  businessName: "", businessCategory: "", businessType: "service",
  description: "", country: "Nigeria", state: "", city: "",
  logoFile: null, logoPreview: "", coverFile: null, coverPreview: "",
  products: [],   // {id,name,category,description,price,negotiable,stock,files:[],previews:[]}
  services: [],   // {id,name,description,startingPrice,pricingType,files:[],previews:[]}
  phone: "", whatsapp: "", email: "", website: "", address: "", hours: "", mapsLink: "",
  socials: {} // { facebook: "", instagram: "", ... }
};
SOCIAL_PLATFORMS.forEach(p => STATE.socials[p.key] = "");

/* ---------------------------------------------------------------------
   Draft persistence (localStorage) — images can't survive reload as files,
   so only text/meta fields are restored; the user re-attaches photos.
--------------------------------------------------------------------- */
function draftKey() {
  return "neilnest_add_business_draft_" + (currentUser ? currentUser.uid : "guest");
}
function saveDraft() {
  if (EDIT_MODE.active) return;
  const serializable = {
    businessName: STATE.businessName, businessCategory: STATE.businessCategory,
    businessType: STATE.businessType, description: STATE.description,
    country: STATE.country, state: STATE.state, city: STATE.city,
    phone: STATE.phone, whatsapp: STATE.whatsapp, email: STATE.email,
    website: STATE.website, address: STATE.address, hours: STATE.hours,
    mapsLink: STATE.mapsLink, socials: STATE.socials,
    products: STATE.products.map(p => ({ id: p.id, name: p.name, category: p.category, description: p.description, price: p.price, negotiable: p.negotiable, stock: p.stock })),
    services: STATE.services.map(s => ({ id: s.id, name: s.name, description: s.description, startingPrice: s.startingPrice, pricingType: s.pricingType })),
    currentStep
  };
  try { localStorage.setItem(draftKey(), JSON.stringify(serializable)); } catch (e) { console.error("saveDraft error:", e); }
}
let saveDraftTimer = null;
function saveDraftDebounced() {
  clearTimeout(saveDraftTimer);
  saveDraftTimer = setTimeout(saveDraft, 600);
}
function loadDraft() {
  let raw;
  try { raw = localStorage.getItem(draftKey()); } catch (e) { return; }
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    Object.assign(STATE, d, { logoFile: null, logoPreview: "", coverFile: null, coverPreview: "" });
    STATE.products = (d.products || []).map(p => ({ ...p, files: [], previews: [] }));
    STATE.services = (d.services || []).map(s => ({ ...s, files: [], previews: [] }));
    STATE.socials = Object.assign({}, STATE.socials, d.socials || {});
    currentStep = d.currentStep || 1;
    showToast("Restored your saved draft.", "success");
  } catch (e) { console.error("loadDraft parse error:", e); }
}
function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch (e) {}
}

/* ---------------------------------------------------------------------
   Toasts
--------------------------------------------------------------------- */
function showToast(message, type) {
  const host = document.getElementById("toast-host");
  const el = document.createElement("div");
  el.className = "toast " + (type || "success");
  const icon = type === "error"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>';
  el.innerHTML = icon + "<span>" + message + "</span>";
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 0.25s ease"; setTimeout(() => el.remove(), 250); }, 3200);
}

/* ---------------------------------------------------------------------
   Init
--------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  populateSelect(document.getElementById("businessCategory"), BUSINESS_CATEGORIES);
  populateSelect(document.getElementById("locState"), NIGERIAN_STATES);
  renderSocialFields();

  // Custom category input — shown only when "Other" is selected, so a
  // business whose real category isn't in the list can name it instead of
  // being stuck showing generic "Other" everywhere.
  document.getElementById("businessCategory").insertAdjacentHTML("afterend",
    `<input type="text" id="customCategoryInput" class="input-field" placeholder="Type your business category" style="display:none;margin-top:8px;" maxlength="40">`);
  const customCatInput = document.getElementById("customCategoryInput");
  const categorySelect = document.getElementById("businessCategory");

  categorySelect.addEventListener("change", () => {
    if (categorySelect.value === "Other") {
      customCatInput.style.display = "block";
      STATE.businessCategory = customCatInput.value.trim();
      customCatInput.focus();
    } else {
      customCatInput.style.display = "none";
      customCatInput.value = "";
      STATE.businessCategory = categorySelect.value;
    }
    clearFieldError(categorySelect);
    saveDraftDebounced();
  });
  customCatInput.addEventListener("input", () => {
    STATE.businessCategory = customCatInput.value.trim();
    clearFieldError(categorySelect);
    saveDraftDebounced();
  });

  currentUser = await waitForAuthUser();
  if (!currentUser) {
    // No blocking redirect loop risk here — allow drafting, but publish will require sign-in.
    showToast("Sign in to publish your business listing.", "error");
  } else {
    // Was calling a nonexistent getCurrentUserPlan(uid), which threw a
    // ReferenceError here and silently killed the rest of this handler for
    // every user — no plan detection, no draft/edit loading, no bindEvents().
    // getAccountExtras() is the real, working source of truth (same one
    // business-profile.js uses, defined in firebase-init.js).
    const extras = await getAccountExtras(currentUser.uid);
currentPlan = String(extras.plan || "free").trim().toLowerCase();
  }
  updatePlanUI();

  const params = new URLSearchParams(window.location.search);
  let businessId = params.get("businessId");

  // Every plan caps business listings at 1 (see PLAN_CATALOG.limits.businessListings
  // in billing.js). If they already own a business and didn't land here with an
  // explicit businessId, this is really an edit, not a new listing.
  if (currentUser && !businessId) {
    try {
      const existing = await db.collection(COLLECTIONS.businesses).where("ownerUid", "==", currentUser.uid).limit(1).get();
      if (!existing.empty) {
        showToast("You already have a business listing — opening it for editing.", "success");
        window.location.href = `add-business.html?businessId=${existing.docs[0].id}`;
        return;
      }
    } catch (err) {
      console.error("Existing-business check error:", err);
    }
  }

  if (businessId && currentUser) {
    const loaded = await loadBusinessForEdit(businessId, params.get("editItem"), params.get("jumpToStep"));
    if (!loaded) return; // error already shown, page left in a safe state
  } else {
    loadDraft();
  }

  hydrateFormFromState();
  renderSingleImageBox("logo");
  renderSingleImageBox("cover");
  renderListingsStep();
  goToStep(currentStep, true);
  bindEvents();

  if (EDIT_MODE.active) applyEditModeUI();
  if (EDIT_MODE.jumpToItemKey) highlightEditingItem();
});

/* ---------------------------------------------------------------------
   Edit mode: load an existing business + its products/services for editing
--------------------------------------------------------------------- */
async function loadBusinessForEdit(businessId, editItemParam, jumpToStepParam) {
  try {
    const bizSnap = await db.collection(COLLECTIONS.businesses).doc(businessId).get();
    if (!bizSnap.exists) { showToast("Business not found.", "error"); return false; }
    const b = bizSnap.data();
    if (b.ownerUid !== currentUser.uid) { showToast("You don't have permission to edit this business.", "error"); return false; }

    EDIT_MODE.active = true;
    EDIT_MODE.businessId = businessId;
    EDIT_MODE.existingLogoUrl = b.logoUrl || "";
    EDIT_MODE.existingCoverUrl = b.coverUrl || "";

    // Contact fields live at businesses/{id}/private/contact now, not on
    // the public doc — read separately. Owner always has access per
    // firestore.rules, so this just falls back to blank on any hiccup.
    let contact = { phone: "", whatsapp: "", email: "" };
    try {
      const contactSnap = await bizSnap.ref.collection("private").doc("contact").get();
      if (contactSnap.exists) contact = contactSnap.data();
    } catch (err) { console.error("Load protected contact error:", err); }

    Object.assign(STATE, {
      businessName: b.name || "", businessCategory: b.category || "", businessType: b.businessType || "service",
      description: b.description || "", country: (b.location && b.location.country) || "Nigeria",
      state: (b.location && b.location.state) || "", city: (b.location && b.location.city) || "",
      logoPreview: b.logoUrl || "", coverPreview: b.coverUrl || "",
      phone: contact.phone || "", whatsapp: contact.whatsapp || "", email: contact.email || "",
      website: b.website || "", address: b.address || "", hours: b.hours || "", mapsLink: b.mapsLink || "",
      socials: Object.assign({}, STATE.socials, b.socials || {})
    });

    const [productsSnap, servicesSnap] = await Promise.all([
      db.collection(COLLECTIONS.businesses).doc(businessId).collection(COLLECTIONS.products).get(),
      db.collection(COLLECTIONS.businesses).doc(businessId).collection(COLLECTIONS.services).get()
    ]);
    STATE.products = productsSnap.docs.map(d => ({ id: d.id, isNew: false, name: d.data().name || "", category: d.data().category || "", description: d.data().description || "", price: d.data().price || "", negotiable: !!d.data().negotiable, stock: d.data().stockStatus || "In Stock", files: [], previews: [], existingImages: d.data().images || [] }));
    STATE.services = servicesSnap.docs.map(d => ({ id: d.id, isNew: false, name: d.data().name || "", description: d.data().description || "", startingPrice: d.data().startingPrice || "", pricingType: d.data().pricingType || "Fixed", files: [], previews: [], existingImages: d.data().images || [] }));

    if (jumpToStepParam) currentStep = parseInt(jumpToStepParam, 10) || 1;
    if (editItemParam) {
      const [kind, itemId] = editItemParam.split(":");
      STATE.businessType = kind === "product" ? "product" : "service";
      currentStep = 2;
      EDIT_MODE.jumpToItemKey = editItemParam;
    }

    return true;
  } catch (err) {
    console.error("loadBusinessForEdit error:", err);
    showToast("Couldn't load this business for editing.", "error");
    return false;
  }
}

function applyEditModeUI() {
  document.querySelector(".wizard-head h1").innerHTML = 'Edit Your <span class="accent">Business</span>';
  document.querySelector(".wizard-head p").textContent = "Update your business details below.";
}

function highlightEditingItem() {
  const [, itemId] = EDIT_MODE.jumpToItemKey.split(":");
  setTimeout(() => {
    const card = document.querySelector(`.repeat-card[data-id="${itemId}"]`);
    if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); card.style.borderColor = "#e0a83c"; }
  }, 150);
}

function populateSelect(selectEl, items) {
  items.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item; opt.textContent = item;
    selectEl.appendChild(opt);
  });
}

function renderSocialFields() {
  const wrap = document.getElementById("socialsWrap");
  wrap.innerHTML = SOCIAL_PLATFORMS.map(p => `
    <div class="form-group locked-wrap" data-social="${p.key}">
      <label style="margin-bottom:8px;">${p.label}</label>
      <div class="input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>
        <input type="text" class="social-input" data-key="${p.key}" placeholder="${p.placeholder}">
      </div>
      <span class="upgrade-badge social-lock-badge" style="display:none;">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a4 4 0 0 0-4 4v3H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4zm-2 7V6a2 2 0 1 1 4 0v3h-4z"/></svg>
        PRO
      </span>
    </div>
  `).join("");
}

function updatePlanUI() {
  const normalizedPlan = String(currentPlan || "free").trim().toLowerCase();

  const rawCap = imageCapFor(normalizedPlan);

  document.getElementById("planNameLabel").textContent =
    capitalize(normalizedPlan);

  document.getElementById("planImgCap").textContent =
    rawCap === null ? "unlimited" : rawCap;

  document.getElementById("rvPlan").textContent =
    capitalize(normalizedPlan);

  document.getElementById("rvPlan").className =
    "status-chip " + (normalizedPlan === "free" ? "free" : "pending");

  const hasSocialLinks =
  normalizedPlan === "pro" || normalizedPlan === "business";

  document.querySelectorAll(".locked-wrap").forEach(wrap => {
    const badge = wrap.querySelector(".social-lock-badge");
    const input = wrap.querySelector(".social-input");

    if (!hasSocialLinks) {
      badge.style.display = "flex";
      input.disabled = true;
      input.placeholder = "Upgrade to add this link";
    } else {
      badge.style.display = "none";
      input.disabled = false;

      const platform = SOCIAL_PLATFORMS.find(
        p => p.key === input.dataset.key
      );

      input.placeholder = platform
        ? platform.placeholder
        : "";
    }
  });
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }

/* ---------------------------------------------------------------------
   Hydrate static (non-repeating) fields from STATE (used after draft load)
--------------------------------------------------------------------- */
function hydrateFormFromState() {
  document.getElementById("businessName").value = STATE.businessName;
  const catSelect = document.getElementById("businessCategory");
  const customCatInput = document.getElementById("customCategoryInput");
  if (STATE.businessCategory && !isListedCategory(STATE.businessCategory)) {
    catSelect.value = "Other";
    if (customCatInput) { customCatInput.value = STATE.businessCategory; customCatInput.style.display = "block"; }
  } else {
    catSelect.value = STATE.businessCategory;
    if (customCatInput) { customCatInput.value = ""; customCatInput.style.display = "none"; }
  }
  document.getElementById("businessDesc").value = STATE.description;
  document.getElementById("descCount").textContent = STATE.description.length;
  document.getElementById("locState").value = STATE.state;
  document.getElementById("locCity").value = STATE.city;
  document.getElementById("phoneInput").value = STATE.phone;
  document.getElementById("whatsappInput").value = STATE.whatsapp;
  document.getElementById("emailInput").value = STATE.email;
  document.getElementById("websiteInput").value = STATE.website;
  document.getElementById("addressInput").value = STATE.address;
  document.getElementById("hoursInput").value = STATE.hours;
  document.getElementById("mapsInput").value = STATE.mapsLink;
  document.querySelectorAll(".social-input").forEach(inp => { inp.value = STATE.socials[inp.dataset.key] || ""; });

  document.querySelectorAll(".type-opt").forEach(btn => btn.classList.toggle("selected", btn.dataset.type === STATE.businessType));
}

/* ---------------------------------------------------------------------
   Event binding
--------------------------------------------------------------------- */
function bindEvents() {
  const form = document.getElementById("wizard-form");

  // Generic text/select/textarea inputs -> sync STATE + autosave
  const fieldMap = {
    businessName: "businessName",
    businessDesc: "description", locState: "state", locCity: "city",
    phoneInput: "phone", whatsappInput: "whatsapp", emailInput: "email",
    websiteInput: "website", addressInput: "address", hoursInput: "hours", mapsInput: "mapsLink"
  };
  Object.keys(fieldMap).forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => {
      STATE[fieldMap[id]] = el.value;
      if (id === "businessDesc") document.getElementById("descCount").textContent = el.value.length;
      clearFieldError(el);
      saveDraftDebounced();
    });
    el.addEventListener("change", () => { STATE[fieldMap[id]] = el.value; clearFieldError(el); saveDraftDebounced(); });
  });

  document.getElementById("socialsWrap").addEventListener("input", (e) => {
    if (!e.target.classList.contains("social-input")) return;
    STATE.socials[e.target.dataset.key] = e.target.value;
    saveDraftDebounced();
  });

  // Business type toggle
  document.querySelectorAll(".type-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".type-opt").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      STATE.businessType = btn.dataset.type;
      renderListingsStep();
      saveDraftDebounced();
    });
  });

  // Single image uploads (logo / cover)
  document.getElementById("logoInput").addEventListener("change", (e) => handleSingleImage(e, "logo"));
  document.getElementById("coverInput").addEventListener("change", (e) => handleSingleImage(e, "cover"));

  // Add product/service
  document.getElementById("addProductBtn").addEventListener("click", () => {
    const cap = productCapFor(currentPlan); // null = unlimited
    const count = STATE.businessType === "product" ? STATE.products.length : STATE.services.length;
    if (cap !== null && count >= cap) {
      showToast(`Your ${capitalize(currentPlan)} plan allows up to ${cap} ${STATE.businessType === "product" ? "products" : "services"}. Upgrade for more.`, "error");
      return;
    }
    if (STATE.businessType === "product") { STATE.products.push(createProduct()); }
    else { STATE.services.push(createService()); }
    renderListingsStep();
    saveDraftDebounced();
  });

  // Delegated events inside the products/services wrapper
  document.getElementById("productsWrap").addEventListener("click", onListingsWrapClick);
  document.getElementById("productsWrap").addEventListener("input", onListingsWrapInput);
  document.getElementById("productsWrap").addEventListener("change", onListingsWrapInput);

  // Nav buttons
  document.getElementById("nextBtn").addEventListener("click", onNextClick);
  document.getElementById("backBtn").addEventListener("click", () => goToStep(currentStep - 1));
  document.getElementById("saveLaterBtn").addEventListener("click", (e) => {
    e.preventDefault();
    saveDraft();
    showToast("Draft saved. Continue anytime.", "success");
  });

  document.getElementById("confirmCheck").addEventListener("change", () => {
    document.getElementById("nextBtn").disabled = !document.getElementById("confirmCheck").checked;
  });

  form.addEventListener("submit", (e) => e.preventDefault());
}

function clearFieldError(el) {
  const group = el.closest(".form-group");
  if (group) group.classList.remove("has-error");
}

/* ---------------------------------------------------------------------
   Single image upload (logo / cover)
--------------------------------------------------------------------- */
function handleSingleImage(e, kind) {
  const file = e.target.files[0];
  if (!file) return;
  const maxMB = kind === "logo" ? 5 : 10;
  if (file.size > maxMB * 1024 * 1024) {
    showToast(`${capitalize(kind)} image must be under ${maxMB}MB.`, "error");
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (kind === "logo") { STATE.logoFile = file; STATE.logoPreview = reader.result; EDIT_MODE.logoRemoved = false; }
    else { STATE.coverFile = file; STATE.coverPreview = reader.result; EDIT_MODE.coverRemoved = false; }
    renderSingleImageBox(kind);
    saveDraftDebounced();
  };
  reader.readAsDataURL(file);
}
function renderSingleImageBox(kind) {
  const box = document.getElementById(kind === "logo" ? "logoBox" : "coverBox");
  const preview = kind === "logo" ? STATE.logoPreview : STATE.coverPreview;
  let img = box.querySelector("img");
  if (preview) {
    box.classList.add("has-image");
    if (!img) { img = document.createElement("img"); box.insertBefore(img, box.firstChild); }
    img.src = preview;
  } else {
    box.classList.remove("has-image");
    if (img) img.remove();
  }
}
function removeSingleImage(e, kind) {
  e.preventDefault(); e.stopPropagation();
  if (kind === "logo") { STATE.logoFile = null; STATE.logoPreview = ""; document.getElementById("logoInput").value = ""; EDIT_MODE.logoRemoved = true; }
  else { STATE.coverFile = null; STATE.coverPreview = ""; document.getElementById("coverInput").value = ""; EDIT_MODE.coverRemoved = true; }
  renderSingleImageBox(kind);
  saveDraftDebounced();
}

/* ---------------------------------------------------------------------
   Step 2 — Products / Services
--------------------------------------------------------------------- */
function createProduct() {
  return { id: "p" + Date.now() + Math.random().toString(36).slice(2, 7), isNew: true, name: "", category: "", description: "", price: "", negotiable: false, stock: "In Stock", files: [], previews: [], existingImages: [] };
}
function createService() {
  return { id: "s" + Date.now() + Math.random().toString(36).slice(2, 7), isNew: true, name: "", description: "", startingPrice: "", pricingType: "Fixed", files: [], previews: [], existingImages: [] };
}

function renderListingsStep() {
  document.getElementById("addMoreLabel").textContent = STATE.businessType === "product" ? "Add Another Product" : "Add Another Service";
  if (STATE.businessType === "product") {
    if (STATE.products.length === 0) STATE.products.push(createProduct());
    renderProducts();
  } else {
    if (STATE.services.length === 0) STATE.services.push(createService());
    renderServices();
  }

  const cap = productCapFor(currentPlan);
  const count = STATE.businessType === "product" ? STATE.products.length : STATE.services.length;
  const addBtn = document.getElementById("addProductBtn");
  addBtn.style.opacity = (cap !== null && count >= cap) ? "0.45" : "1";
}

function renderProducts() {
  const wrap = document.getElementById("productsWrap");
  const cap = imageCapFor(currentPlan) || 999; // null (unlimited) -> effectively no cap
  wrap.innerHTML = STATE.products.map((p, i) => `
    <div class="repeat-card" data-kind="product" data-id="${p.id}">
      <div class="repeat-card__head">
        <span>Product ${i + 1}</span>
        ${STATE.products.length > 1 ? `<button type="button" class="repeat-card__remove" data-action="remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}
      </div>
      <div class="form-group">
        <label>Product Name</label>
        <input class="input-field" data-field="name" placeholder="e.g. Chanel No. 5 Eau de Parfum" value="${escapeHtml(p.name)}">
      </div>
      <div class="form-group">
        <label>Category</label>
        <input class="input-field" data-field="category" placeholder="e.g. Fragrance" value="${escapeHtml(p.category)}">
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea class="input-field" data-field="description" placeholder="Describe this product...">${escapeHtml(p.description)}</textarea>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label>Price (₦)</label>
          <input class="input-field" data-field="price" type="number" min="0" placeholder="0.00" value="${escapeHtml(p.price)}">
        </div>
        <div class="form-group">
          <label>Stock Status</label>
          <div class="input-wrap">
            <select data-field="stock">
              <option ${p.stock === "In Stock" ? "selected" : ""}>In Stock</option>
              <option ${p.stock === "Limited Stock" ? "selected" : ""}>Limited Stock</option>
              <option ${p.stock === "Out of Stock" ? "selected" : ""}>Out of Stock</option>
            </select>
          </div>
        </div>
      </div>
      <div class="form-group switch-row">
        <span class="switch-label">Negotiable Price</span>
        <span class="switch ${p.negotiable ? "on" : ""}" data-action="toggle-negotiable"></span>
      </div>
      <div class="form-group">
        <label>Product Images</label>
        ${renderMultiUpload(p, cap)}
      </div>
    </div>
  `).join("");
}

function renderServices() {
  const wrap = document.getElementById("productsWrap");
  const cap = imageCapFor(currentPlan) || 999; // null (unlimited) -> effectively no cap
  wrap.innerHTML = STATE.services.map((s, i) => `
    <div class="repeat-card" data-kind="service" data-id="${s.id}">
      <div class="repeat-card__head">
        <span>Service ${i + 1}</span>
        ${STATE.services.length > 1 ? `<button type="button" class="repeat-card__remove" data-action="remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}
      </div>
      <div class="form-group">
        <label>Service Name</label>
        <input class="input-field" data-field="name" placeholder="e.g. Home Cleaning" value="${escapeHtml(s.name)}">
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea class="input-field" data-field="description" placeholder="Describe this service...">${escapeHtml(s.description)}</textarea>
      </div>
      <div class="form-group">
        <label>Starting Price (₦)</label>
        <input class="input-field" data-field="startingPrice" type="number" min="0" placeholder="0.00" value="${escapeHtml(s.startingPrice)}">
      </div>
      <div class="form-group">
        <label>Pricing Type</label>
        <div class="pill-select">
          ${["Fixed", "Hourly", "Custom Quote"].map(pt => `<button type="button" data-action="pricing-type" data-value="${pt}" class="${s.pricingType === pt ? "selected" : ""}">${pt}</button>`).join("")}
        </div>
      </div>
      <div class="form-group">
        <label>Service Images</label>
        ${renderMultiUpload(s, cap)}
      </div>
    </div>
  `).join("");
}

function renderMultiUpload(item, cap) {
  const existingThumbs = (item.existingImages || []).map((src, idx) => `
    <div class="multi-upload-thumb">
      <img src="${src}">
      <button type="button" class="remove-img" data-action="remove-existing-image" data-idx="${idx}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
  `).join("");
  const newThumbs = item.previews.map((src, idx) => `
    <div class="multi-upload-thumb">
      <img src="${src}">
      <button type="button" class="remove-img" data-action="remove-image" data-idx="${idx}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
  `).join("");
  const totalCount = (item.existingImages || []).length + item.previews.length;
  const canAddMore = totalCount < cap;
  const addBtn = `
    <div class="multi-upload-add ${canAddMore ? "" : "disabled"}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>
      <input type="file" accept="image/png,image/jpeg" data-action="add-image" ${canAddMore ? "" : "disabled"}>
    </div>`;
  return `<div class="multi-upload-row">${existingThumbs}${newThumbs}${addBtn}</div><p class="img-cap-note">${totalCount}/<b>${cap}</b> images used on your ${capitalize(currentPlan)} plan.</p>`;
}

function findListingItem(card) {
  const kind = card.dataset.kind, id = card.dataset.id;
  const list = kind === "product" ? STATE.products : STATE.services;
  return { list, item: list.find(x => x.id === id) };
}

function onListingsWrapClick(e) {
  const card = e.target.closest(".repeat-card");
  if (!card) return;
  const { list, item } = findListingItem(card);
  if (!item) return;

  const removeBtn = e.target.closest('[data-action="remove"]');
  if (removeBtn) {
    const idx = list.indexOf(item);
    list.splice(idx, 1);
    if (EDIT_MODE.active && item.isNew === false) {
      const targetArr = STATE.businessType === "product" ? EDIT_MODE.deletedProductIds : EDIT_MODE.deletedServiceIds;
      targetArr.push(item.id);
    }
    STATE.businessType === "product" ? renderProducts() : renderServices();
    saveDraftDebounced();
    return;
  }
  const toggle = e.target.closest('[data-action="toggle-negotiable"]');
  if (toggle) {
    item.negotiable = !item.negotiable;
    toggle.classList.toggle("on", item.negotiable);
    saveDraftDebounced();
    return;
  }
  const pricingBtn = e.target.closest('[data-action="pricing-type"]');
  if (pricingBtn) {
    item.pricingType = pricingBtn.dataset.value;
    card.querySelectorAll('[data-action="pricing-type"]').forEach(b => b.classList.toggle("selected", b === pricingBtn));
    saveDraftDebounced();
    return;
  }
  const removeImg = e.target.closest('[data-action="remove-image"]');
  if (removeImg) {
    const idx = parseInt(removeImg.dataset.idx, 10);
    item.files.splice(idx, 1);
    item.previews.splice(idx, 1);
    STATE.businessType === "product" ? renderProducts() : renderServices();
    saveDraftDebounced();
    return;
  }
  const removeExisting = e.target.closest('[data-action="remove-existing-image"]');
  if (removeExisting) {
    const idx = parseInt(removeExisting.dataset.idx, 10);
    item.existingImages.splice(idx, 1);
    STATE.businessType === "product" ? renderProducts() : renderServices();
    return;
  }
}

function onListingsWrapInput(e) {
  const card = e.target.closest(".repeat-card");
  if (!card) return;
  const { item } = findListingItem(card);
  if (!item) return;

  const field = e.target.dataset.field;
  if (field) {
    item[field] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    saveDraftDebounced();
    return;
  }
  if (e.target.dataset.action === "add-image") {
    if (e.type !== "change") return; // file inputs fire both 'input' and 'change' — only handle once
    const file = e.target.files[0];
    if (!file) return;
    const cap = imageCapFor(currentPlan) || 999; // null (unlimited) -> effectively no cap
    const totalCount = (item.existingImages || []).length + item.previews.length;
    if (totalCount >= cap) { showToast(`Your ${capitalize(currentPlan)} plan allows up to ${cap} images per listing.`, "error"); return; }
    if (file.size > 8 * 1024 * 1024) { showToast("Image must be under 8MB.", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      item.files.push(file);
      item.previews.push(reader.result);
      STATE.businessType === "product" ? renderProducts() : renderServices();
      saveDraftDebounced();
    };
    reader.readAsDataURL(file);
  }
}

function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------------------
   Step navigation
--------------------------------------------------------------------- */
function goToStep(step, silent) {
  currentStep = Math.max(1, Math.min(4, step));
  document.querySelectorAll(".wizard-step").forEach(sec => sec.classList.toggle("active", parseInt(sec.dataset.step, 10) === currentStep));
  document.querySelectorAll(".step-track__seg").forEach(seg => {
    const n = parseInt(seg.dataset.seg, 10);
    seg.classList.toggle("done", n < currentStep);
    seg.classList.toggle("current", n <= currentStep);
  });
  ["lbl1", "lbl2", "lbl3", "lbl4"].forEach((id, idx) => document.getElementById(id).classList.toggle("active", idx + 1 <= currentStep));

  const circumference = 138.2;
  document.getElementById("ringFill").style.strokeDashoffset = circumference - (circumference * currentStep) / 4;
  document.getElementById("ringLabel").textContent = currentStep + "/4";

  document.getElementById("backBtn").style.display = currentStep === 1 ? "none" : "flex";

  const nextBtn = document.getElementById("nextBtn");
  const nextLabel = document.getElementById("nextBtnLabel");
  if (currentStep === 4) {
    nextLabel.textContent = EDIT_MODE.active ? "Save Changes" : "Publish Business";
    nextBtn.disabled = !document.getElementById("confirmCheck").checked;
    populateReview();
  } else {
    nextLabel.textContent = "Next Step";
    nextBtn.disabled = false;
  }

  if (!silent) window.scrollTo({ top: 0, behavior: "smooth" });
  saveDraft();
}

function onNextClick() {
  if (isPublishing) return;
  if (currentStep < 4) {
    if (!validateStep(currentStep)) return;
    goToStep(currentStep + 1);
  } else {
    publishBusiness();
  }
}

function validateStep(step) {
  let valid = true;
  const setError = (groupId, on) => {
    const g = document.getElementById(groupId);
    if (g) g.classList.toggle("has-error", on);
    if (on) valid = false;
  };

  if (step === 1) {
    setError("fg-name", !STATE.businessName.trim());
    setError("fg-category", !STATE.businessCategory);
    const locBad = !STATE.state || !STATE.city.trim();
    const locGroup = document.getElementById("locError").closest(".form-group");
    locGroup.classList.toggle("has-error", locBad);
    if (locBad) valid = false;
  }

  if (step === 3) {
    setError("fg-phone", !STATE.phone.trim());
    setError("fg-whatsapp", !STATE.whatsapp.trim());
  }

  if (!valid) showToast("Please fill in the required fields.", "error");
  return valid;
}

/* ---------------------------------------------------------------------
   Step 4 — Review population
--------------------------------------------------------------------- */
function populateReview() {
  document.getElementById("reviewName").textContent = STATE.businessName || "Untitled Business";
  document.getElementById("reviewCategoryLoc").textContent = [STATE.businessCategory, [STATE.city, STATE.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "—";

  const coverImg = document.getElementById("reviewCoverImg");
  const logoImg = document.getElementById("reviewLogoImg");
  coverImg.src = STATE.coverPreview || STATE.logoPreview || "";
  logoImg.src = STATE.logoPreview || "";
  document.getElementById("reviewCover").style.background = STATE.coverPreview ? "" : "#121212";

  document.getElementById("rvType").textContent = STATE.businessType === "product" ? "Product Based" : "Service Provider";
  document.getElementById("rvProductsRow").style.display = STATE.businessType === "product" ? "flex" : "none";
  document.getElementById("rvServicesRow").style.display = STATE.businessType === "service" ? "flex" : "none";
  document.getElementById("rvProducts").textContent = STATE.products.filter(p => p.name.trim()).length;
  document.getElementById("rvServices").textContent = STATE.services.filter(s => s.name.trim()).length;

  document.getElementById("rvPhone").textContent = STATE.phone || "—";
  document.getElementById("rvWhatsapp").textContent = STATE.whatsapp || "—";
  document.getElementById("rvWebsite").textContent = STATE.website || "—";

  const totalBytes = estimateStorageBytes();
  document.getElementById("rvStorage").textContent = (totalBytes / (1024 * 1024)).toFixed(1) + " MB";
}

function estimateStorageBytes() {
  let bytes = 0;
  if (STATE.logoFile) bytes += STATE.logoFile.size;
  if (STATE.coverFile) bytes += STATE.coverFile.size;
  STATE.products.forEach(p => p.files.forEach(f => bytes += f.size));
  STATE.services.forEach(s => s.files.forEach(f => bytes += f.size));
  return bytes;
}

/* ---------------------------------------------------------------------
   Cloudinary upload
--------------------------------------------------------------------- */
async function uploadToCloudinary(file) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error("Cloudinary is not configured yet — set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in add-business.js.");
  }
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(url, { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || "Image upload failed.");
  return data.secure_url;
}

/* ---------------------------------------------------------------------
   Publish
--------------------------------------------------------------------- */
async function publishBusiness() {
  if (!document.getElementById("confirmCheck").checked) {
    showToast("Please confirm the information is accurate.", "error");
    return;
  }
  if (!currentUser) {
    showToast("Please sign in to publish your business.", "error");
    return;
  }
  if (isPublishing) return;
  isPublishing = true;

  const nextBtn = document.getElementById("nextBtn");
  const nextLabel = document.getElementById("nextBtnLabel");
  nextBtn.disabled = true;
  const originalLabel = nextLabel.textContent;
  nextBtn.innerHTML = `<span class="spinner"></span><span>${EDIT_MODE.active ? "Saving…" : "Publishing…"}</span>`;

  try {
    if (EDIT_MODE.active) await saveBusinessEdits();
    else await createNewBusiness();
  } catch (err) {
    console.error("Save/Publish error:", err);
    showToast(err.message || "Something went wrong.", "error");
    nextBtn.disabled = false;
    nextBtn.innerHTML = `<span id="nextBtnLabel">${originalLabel}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>`;
    isPublishing = false;
  }
}

async function createNewBusiness() {
  const dupeCheck = await db.collection(COLLECTIONS.businesses).where("ownerUid", "==", currentUser.uid).limit(1).get();
  if (!dupeCheck.empty) {
    throw new Error("You already have a business listing on this account. Edit it instead of creating a new one.");
  }

  const logoUrl = STATE.logoFile ? await uploadToCloudinary(STATE.logoFile) : "";
  const coverUrl = STATE.coverFile ? await uploadToCloudinary(STATE.coverFile) : "";

  const businessDoc = {
    ownerUid: currentUser.uid,
    claimed: true, claimStatus: "claimed", createdBy: currentUser.uid,
    name: STATE.businessName.trim(),
    category: STATE.businessCategory,
    businessType: STATE.businessType,
    description: STATE.description,
    location: { country: STATE.country, state: STATE.state, city: STATE.city },
    logoUrl, coverUrl,
    // Real phone/whatsapp/email are NOT written here — see the
    // businesses/{id}/private/contact write right below this. This doc is
    // public (firestore.rules: `allow read: if true`), so raw contact info
    // must never land on it. These booleans just tell free-user UI which
    // locked buttons to show, without exposing the actual values.
    contactChannels: { phone: !!STATE.phone, whatsapp: !!STATE.whatsapp, email: !!STATE.email },
    website: STATE.website, address: STATE.address, hours: STATE.hours,
    mapsLink: STATE.mapsLink, socials: STATE.socials,
    plan: currentPlan, visibility: "public",
    status: "pending", verified: false, featured: false,
    followersCount: 0, viewsCount: 0, ratingAvg: 0, ratingCount: 0, completedDeals: 0,
    productsCount: 0, servicesCount: 0,
    storageUsedBytes: estimateStorageBytes(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const businessRef = await db.collection(COLLECTIONS.businesses).add(businessDoc);

  // Protected contact info — only readable by the owner, admin, or an
  // active Pro/Business plan user (enforced in firestore.rules).
  await businessRef.collection("private").doc("contact").set({
    phone: STATE.phone || "", whatsapp: STATE.whatsapp || "", email: STATE.email || "",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  if (STATE.businessType === "product") {
    const validProducts = STATE.products.filter(p => p.name.trim());
    for (const p of validProducts) {
      const imageUrls = [];
      for (const file of p.files) imageUrls.push(await uploadToCloudinary(file));
      await businessRef.collection(COLLECTIONS.products).add({
        name: p.name.trim(), category: p.category, description: p.description,
        price: Number(p.price) || 0, negotiable: !!p.negotiable, stockStatus: p.stock, hidden: false,
        images: imageUrls, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    await businessRef.update({ productsCount: validProducts.length });
  } else {
    const validServices = STATE.services.filter(s => s.name.trim());
    for (const s of validServices) {
      const imageUrls = [];
      for (const file of s.files) imageUrls.push(await uploadToCloudinary(file));
      await businessRef.collection(COLLECTIONS.services).add({
        name: s.name.trim(), description: s.description,
        startingPrice: Number(s.startingPrice) || 0, pricingType: s.pricingType, hidden: false,
        images: imageUrls, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    await businessRef.update({ servicesCount: validServices.length });
  }

  clearDraft();
  showToast("✅ Business submitted successfully.", "success");
  showToast(ADMIN_APPROVAL_ENABLED ? "Your business is awaiting approval." : "Your business is now live.", "success");
  setTimeout(() => { window.location.href = `business-profile.html?id=${businessRef.id}`; }, 1400);
}

async function saveBusinessEdits() {
  const businessRef = db.collection(COLLECTIONS.businesses).doc(EDIT_MODE.businessId);

  let logoUrl = EDIT_MODE.existingLogoUrl;
  if (STATE.logoFile) logoUrl = await uploadToCloudinary(STATE.logoFile);
  else if (EDIT_MODE.logoRemoved) logoUrl = "";

  let coverUrl = EDIT_MODE.existingCoverUrl;
  if (STATE.coverFile) coverUrl = await uploadToCloudinary(STATE.coverFile);
  else if (EDIT_MODE.coverRemoved) coverUrl = "";

  await businessRef.update({
    name: STATE.businessName.trim(),
    category: STATE.businessCategory,
    businessType: STATE.businessType,
    description: STATE.description,
    location: { country: STATE.country, state: STATE.state, city: STATE.city },
    logoUrl, coverUrl,
    contactChannels: { phone: !!STATE.phone, whatsapp: !!STATE.whatsapp, email: !!STATE.email },
    website: STATE.website, address: STATE.address, hours: STATE.hours,
    mapsLink: STATE.mapsLink, socials: STATE.socials,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // Protected contact info — same gate as createNewBusiness().
  await businessRef.collection("private").doc("contact").set({
    phone: STATE.phone || "", whatsapp: STATE.whatsapp || "", email: STATE.email || "",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Delete items explicitly removed during this edit session
  for (const id of EDIT_MODE.deletedProductIds) await businessRef.collection(COLLECTIONS.products).doc(id).delete();
  for (const id of EDIT_MODE.deletedServiceIds) await businessRef.collection(COLLECTIONS.services).doc(id).delete();

  if (STATE.businessType === "product") {
    const validProducts = STATE.products.filter(p => p.name.trim());
    for (const p of validProducts) {
      const newUrls = [];
      for (const file of p.files) newUrls.push(await uploadToCloudinary(file));
      const images = [...(p.existingImages || []), ...newUrls];
      const payload = { name: p.name.trim(), category: p.category, description: p.description, price: Number(p.price) || 0, negotiable: !!p.negotiable, stockStatus: p.stock, images };
      if (p.isNew) {
        await businessRef.collection(COLLECTIONS.products).add({ ...payload, hidden: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      } else {
        await businessRef.collection(COLLECTIONS.products).doc(p.id).update(payload);
      }
    }
    await businessRef.update({ productsCount: validProducts.length });
  } else {
    const validServices = STATE.services.filter(s => s.name.trim());
    for (const s of validServices) {
      const newUrls = [];
      for (const file of s.files) newUrls.push(await uploadToCloudinary(file));
      const images = [...(s.existingImages || []), ...newUrls];
      const payload = { name: s.name.trim(), description: s.description, startingPrice: Number(s.startingPrice) || 0, pricingType: s.pricingType, images };
      if (s.isNew) {
        await businessRef.collection(COLLECTIONS.services).add({ ...payload, hidden: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      } else {
        await businessRef.collection(COLLECTIONS.services).doc(s.id).update(payload);
      }
    }
    await businessRef.update({ servicesCount: validServices.length });
  }

  showToast("✅ Changes saved.", "success");
  setTimeout(() => { window.location.href = `business-profile.html?id=${EDIT_MODE.businessId}`; }, 1000);
}
