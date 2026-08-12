/* ==========================================================================
   add-product.js
   Backend logic for add-product.html — NeilNest
   Requires (loaded before this file): firebase-init.js, auth-guard.js

   Stack:
     • Firebase Auth       — identify the signed-in business owner
     • Cloud Firestore     — products live at businesses/{businessId}/products/{productId}
                              (same subcollection business-profile.js already reads)
     • Cloudinary          — image storage (unsigned upload, no Firebase Storage)

   ⚠️ CLOUDINARY CONFIG — fill these in with your real values before this
   works. Get them from cloudinary.com → Dashboard (cloud name) and
   Settings → Upload → Upload presets (create an "Unsigned" preset).
   ========================================================================== */
const CLOUDINARY_CLOUD_NAME = "dhwelpyz";
const CLOUDINARY_UPLOAD_PRESET = "NeilNest";
const CLOUDINARY_UPLOAD_URL =
`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

/* ---------------------------------------------------------------------
   State
--------------------------------------------------------------------- */
  let currentStep = 0;
let uploadedImages = [];   // { file: File, previewUrl: string(blob) }
let tags = [];
let CURRENT_USER = null;
let CURRENT_BUSINESS_ID = null;
let CURRENT_BUSINESS = null;
let CURRENT_PLAN = "free";
let MAX_IMAGES = PLAN_CATALOG.free.limits.imagesPerProduct;
let isPublishing = false;
let lastPublishedProductId = null;
let IS_SERVICE = false;              // true when the business is a service provider (web dev, designer, etc.)
let selectedPricingType = "Fixed";   // Fixed | Hourly | Custom Quote — services only

/* ---------------------------------------------------------------------
   Toasts (same look as business-profile.js's ptoast)
--------------------------------------------------------------------- */
function showToast(msg, type) {
  const host = document.getElementById("toast-host");
  if (!host) { console.warn(msg); return; }
  const el = document.createElement("div");
  el.className = "toast";
  el.style.borderColor = type === "error" ? "rgba(225,75,75,0.4)" : "rgba(55,198,95,0.4)";
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .25s";
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

/* ---------------------------------------------------------------------
   Init — resolve the signed-in user's business before the form is usable
--------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  bindStaticListeners();

  CURRENT_USER = await Promise.race([
    waitForAuthUser(),
    new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 8000))
  ]);

  if (CURRENT_USER === "TIMEOUT" || !CURRENT_USER) {
    window.location.href = "signin.html?redirect=add-product.html" + window.location.search;
    return;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const paramBusinessId = params.get("businessId");

    let bizDoc;
    if (paramBusinessId) {
      bizDoc = await db.collection(COLLECTIONS.businesses).doc(paramBusinessId).get();
      if (!bizDoc.exists || bizDoc.data().ownerUid !== CURRENT_USER.uid) {
        showToast("You don't have permission to add products to that business.", "error");
        setTimeout(() => (window.location.href = "business-profile.html"), 1500);
        return;
      }
    } else {
      const snap = await db.collection(COLLECTIONS.businesses)
        .where("ownerUid", "==", CURRENT_USER.uid)
        .limit(1)
        .get();
      if (snap.empty) {
        showToast("You need to create a business profile first.", "error");
        setTimeout(() => (window.location.href = "add-business.html"), 1500);
        return;
      }
      bizDoc = snap.docs[0];
    }

    CURRENT_BUSINESS_ID = bizDoc.id;
    CURRENT_BUSINESS = bizDoc.data();
    IS_SERVICE = !!(CURRENT_BUSINESS.businessType && CURRENT_BUSINESS.businessType !== "product");

    const extras = await Promise.race([
      getAccountExtras(CURRENT_USER.uid),
      new Promise((resolve) => setTimeout(() => resolve({ plan: "free" }), 6000))
    ]);
    CURRENT_PLAN = extras.plan || "free";
    MAX_IMAGES = (PLAN_CATALOG[CURRENT_PLAN] || PLAN_CATALOG.free).limits.imagesPerProduct; // null = unlimited
    document.getElementById("imageCount").textContent = `0/${MAX_IMAGES || "∞"}`;

    const listingLimit = (PLAN_CATALOG[CURRENT_PLAN] || PLAN_CATALOG.free).limits.products;
    const listingCollection = IS_SERVICE ? COLLECTIONS.services : COLLECTIONS.products;
    if (listingLimit !== null) {
      const countSnap = await db.collection(COLLECTIONS.businesses).doc(CURRENT_BUSINESS_ID).collection(listingCollection).get();
      if (countSnap.size >= listingLimit) {
        const noun = IS_SERVICE ? "services" : "products";
        showToast(`Your ${(PLAN_CATALOG[CURRENT_PLAN] || PLAN_CATALOG.free).name} plan allows up to ${listingLimit} ${noun}. Upgrade to add more.`, "error");
        setTimeout(() => { window.location.href = "upgrade.html"; }, 1600);
        return;
      }
    }

    applyBusinessTypeUI();
  } catch (err) {
    console.error("Business lookup error:", err);
    showToast("Couldn't load your business. Check your connection.", "error");
  }
});

/* ---------------------------------------------------------------------
   Swap the form between "product" mode and "service" mode
--------------------------------------------------------------------- */
function applyBusinessTypeUI() {
  if (!IS_SERVICE) return; // default markup is already product-oriented

  document.querySelector(".top-title").textContent = "Add Service";
  document.title = "Add Service - NeilNest";

  document.getElementById("step1Title").textContent = "Service Information";
  document.getElementById("step1Subtitle").textContent = "Add the basic details about your service";
  document.getElementById("imagesLabel").textContent = "Service Images";
  document.getElementById("nameLabel").innerHTML = 'Service Name <span class="req">*</span>';
  document.getElementById("pName").placeholder = "e.g. Website Design & Development";
  document.getElementById("priceLabel").innerHTML = 'Starting Price (₦) <span class="req">*</span>';
  document.getElementById("pPrice").placeholder = "50,000";
  document.getElementById("descLabel").innerHTML = 'Description <span class="req">*</span>';
  document.getElementById("pDescription").placeholder = "Describe the service you offer, what's included, and what makes it stand out.";

  document.getElementById("categoryGroup").style.display = "none";
  document.getElementById("salePriceGroup").style.display = "none";

  document.getElementById("productOnlyFields").style.display = "none";
  document.getElementById("serviceOnlyFields").style.display = "block";
  document.getElementById("tagsLabel").innerHTML = 'Tags <span class="optional">(e.g. design, branding, react)</span>';

  document.getElementById("step2Subtitle").textContent = "Add more information about your service";
  document.getElementById("step3Subtitle").textContent = "This is how your service will appear";
  document.getElementById("summaryTitle").textContent = "Service Summary";
  document.getElementById("summaryCategoryRow").style.display = "none";
  document.getElementById("publishBtnLabel").textContent = "Publish Service";

  document.getElementById("successTitle").textContent = "Service Published Successfully!";
  document.getElementById("successSubtitle").textContent = "Your service is now live and visible to everyone on NeilNest.";
  document.getElementById("whatsNextShare").textContent = "Share your service to get more visibility";
  document.getElementById("whatsNextPin").textContent = "Pin your service to the top of your profile";
  document.getElementById("whatsNextMore").textContent = "Add more services to grow your business";
  document.getElementById("addAnotherBtn").textContent = "Add Another Service";

  // Default-select the "Fixed" pricing pill
  const defaultPill = document.querySelector('.pricing-pill[data-value="Fixed"]');
  if (defaultPill) defaultPill.classList.add("selected");
}

/* ---------------------------------------------------------------------
   Step navigation
--------------------------------------------------------------------- */
function goToStep(n) {
  if (n === 2 && !validateStep1()) return;
  if (n === 3 && !validateStep2()) return;
  if (n === 3) buildPreview();
  document.querySelectorAll(".step").forEach((s) => s.classList.remove("active"));
  document.getElementById("step" + n).classList.add("active");
  document.getElementById("stepCount").textContent = n + "/4";
  document.querySelectorAll("#progressTrack span").forEach((s, i) => s.classList.toggle("done", i < n));
  currentStep = n;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function prevStep() {
  if (currentStep > 1) { goToStep(currentStep - 1); }
  else { history.back(); }
}

/* ---------------------------------------------------------------------
   Validation
--------------------------------------------------------------------- */
function validateStep1() {
  const name = document.getElementById("pName").value.trim();
  const category = document.getElementById("pCategory").value;
  const price = document.getElementById("pPrice").value;
  const description = document.getElementById("pDescription").value.trim();

  if (uploadedImages.length === 0) {
    showToast(IS_SERVICE ? "Add at least one image showcasing your service." : "Add at least one product image.", "error");
    return false;
  }
  if (!name) { showToast(IS_SERVICE ? "Service name is required." : "Product name is required.", "error"); return false; }
  if (!IS_SERVICE && !category) { showToast("Please select a category.", "error"); return false; }
  if (!price || Number(price) <= 0) { showToast(IS_SERVICE ? "Enter a valid starting price." : "Enter a valid price.", "error"); return false; }
  if (!description) { showToast("Description is required.", "error"); return false; }

  if (!IS_SERVICE) {
    const salePrice = document.getElementById("pSalePrice").value;
    if (salePrice && Number(salePrice) >= Number(price)) {
      showToast("Sale price must be lower than the regular price.", "error");
      return false;
    }
  }
  return true;
}

function validateStep2() {
  if (IS_SERVICE) {
    if (!selectedPricingType) {
      showToast("Please select a pricing type.", "error");
      return false;
    }
    return true;
  }
  const stock = document.getElementById("pStock").value;
  const condition = document.getElementById("pCondition").value;
  if (stock === "" || Number(stock) < 0) {
    showToast("Enter a valid stock quantity.", "error");
    return false;
  }
  if (!condition) {
    showToast("Please select the product condition.", "error");
    return false;
  }
  return true;
}

/* ---------------------------------------------------------------------
   Image upload (local preview now, Cloudinary upload happens on publish)
--------------------------------------------------------------------- */
function bindStaticListeners() {
  
 document.getElementById("imageUpload").addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);

  if (!files.length) {
    return;
  }

  const remaining = MAX_IMAGES
    ? Math.max(0, MAX_IMAGES - uploadedImages.length)
    : Infinity;

  files.slice(0, remaining).forEach((file) => {
    try {
      const previewUrl = URL.createObjectURL(file);

      uploadedImages.push({
        file: file,
        previewUrl: previewUrl
      });

      renderImageGrid();

    } catch (error) {
      console.error("NeilNest image error:", error);
      showToast("Couldn't load this image.", "error");
    }
  });

  e.target.value = "";
}); document.getElementById("tagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      e.preventDefault();

      const val = e.target.value.trim();

      if (!tags.includes(val) && tags.length < 10) {
        tags.push(val);
      }

      e.target.value = "";
      renderTags();
    }
  });

  document.getElementById("pDescription").addEventListener("input", (e) => {
    document.getElementById("descCount").textContent =
      e.target.value.length;
  });

  document.getElementById("viewProductBtn").addEventListener("click", () => {
    if (lastPublishedProductId) {
      const dest = IS_SERVICE
        ? "service-details.html"
        : "product-details.html";

      window.location.href = `${dest}?id=${lastPublishedProductId}`;
    }
  });

  document.getElementById("pricingTypeWrap").addEventListener("click", (e) => {
    const btn = e.target.closest(".pricing-pill");

    if (!btn) return;

    selectedPricingType = btn.dataset.value;

    document.querySelectorAll(".pricing-pill").forEach((b) => {
      b.classList.toggle("selected", b === btn);
    });
  });
}


function renderImageGrid() {
  const grid = document.getElementById("imageGrid");
  document.getElementById("imageCount").textContent = `${uploadedImages.length}/${MAX_IMAGES || "∞"}`;
  const thumbs = uploadedImages.map((img, i) => `
    <div class="image-thumb">
      <img src="${img.previewUrl}" alt="Product image ${i + 1}">
      <button class="remove-btn" onclick="removeImage(${i})">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`).join("");
  const addBtn = (!MAX_IMAGES || uploadedImages.length < MAX_IMAGES) ? `
    <div class="image-add" onclick="document.getElementById('imageUpload').click()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
    </div>` : "";
  grid.innerHTML = thumbs + addBtn;
}

function removeImage(i) {
  URL.revokeObjectURL(uploadedImages[i].previewUrl);
  uploadedImages.splice(i, 1);
  renderImageGrid();
}

/* ---------------------------------------------------------------------
   Toggles
--------------------------------------------------------------------- */
function toggleSwitch(el) {
  el.classList.toggle("on");
  if (el.id === "deliveryToggle") {
    document.getElementById("deliveryFeeGroup").style.display = el.classList.contains("on") ? "block" : "none";
  }
  if (el.id === "pickupToggle") {
    document.getElementById("pickupLocationGroup").style.display = el.classList.contains("on") ? "block" : "none";
  }
}

/* ---------------------------------------------------------------------
   Tags
--------------------------------------------------------------------- */
function renderTags() {
  const wrap = document.getElementById("tagsWrap");
  const input = document.getElementById("tagInput");
  wrap.querySelectorAll(".tag-chip").forEach((c) => c.remove());
  tags.forEach((tag, i) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${escapeHtml(tag)} <button onclick="removeTag(${i})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    wrap.insertBefore(chip, input);
  });
}
function removeTag(i) { tags.splice(i, 1); renderTags(); }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------------------
   Preview (step 3)
--------------------------------------------------------------------- */
function buildPreview() {
  const name = document.getElementById("pName").value.trim() || (IS_SERVICE ? "Untitled Service" : "Untitled Product");
  const price = Number(document.getElementById("pPrice").value || 0);
  const description = document.getElementById("pDescription").value.trim() || "No description provided.";

  document.getElementById("previewImage").src = uploadedImages[0] ? uploadedImages[0].previewUrl : "";
  document.getElementById("previewName").textContent = name;
  document.getElementById("previewDesc").textContent = description;
  document.getElementById("summaryImages").textContent = uploadedImages.length + " image" + (uploadedImages.length === 1 ? "" : "s");

  if (IS_SERVICE) {
    document.getElementById("previewPrice").textContent = "From ₦" + price.toLocaleString();
    document.getElementById("previewStrike").textContent = "";
    document.getElementById("previewMeta").textContent = selectedPricingType + " pricing";
    document.getElementById("previewConditionBadge").textContent = selectedPricingType;
    const location = document.getElementById("previewLocation");
    // CURRENT_BUSINESS.location is an object ({country, state, city} — see
    // add-business.js), not a string. Assigning it straight to .textContent
    // stringifies it to "[object Object]". Same city/state join pattern
    // business-profile.js already uses (bizLocation, line ~220) for
    // consistency.
    const loc = CURRENT_BUSINESS.location;
    const locStr = loc && (loc.city || loc.state)
      ? [loc.city, loc.state].filter(Boolean).join(", ")
      : (CURRENT_BUSINESS.address || "");
    location.textContent = locStr || "Remote / On request";
    document.getElementById("previewStock").textContent =
      document.getElementById("sDeliveryTime").value.trim() || "Delivery time on request";
    document.getElementById("previewDelivery").style.display = "none";
    return;
  }

  const salePrice = Number(document.getElementById("pSalePrice").value || 0);
  const category = document.getElementById("pCategory").value || "—";
  const brand = document.getElementById("pBrand").value.trim();
  const stock = document.getElementById("pStock").value || "0";
  const location = document.getElementById("pPickupLocation").value.trim() || "Location not set";
  const deliveryOn = document.getElementById("deliveryToggle").classList.contains("on");

  document.getElementById("previewPrice").textContent = "₦" + (salePrice || price).toLocaleString();
  document.getElementById("previewStrike").textContent = salePrice ? "₦" + price.toLocaleString() : "";
  document.getElementById("previewMeta").textContent = [category, brand].filter(Boolean).join(" • ");
  document.getElementById("previewLocation").textContent = location;
  document.getElementById("previewConditionBadge").textContent = "New";
  document.getElementById("previewStock").textContent = "Stock: " + stock;
  document.getElementById("previewDelivery").style.display = deliveryOn ? "flex" : "none";
  document.getElementById("summaryCategory").textContent = category;
}

/* ---------------------------------------------------------------------
   Cloudinary upload
--------------------------------------------------------------------- */
async function uploadImagesToCloudinary(images) {
  if (CLOUDINARY_CLOUD_NAME === "YOUR_CLOUDINARY_CLOUD_NAME") {
    throw new Error("Cloudinary isn't configured yet — set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in add-product.js.");
  }

  const folder = IS_SERVICE ? "neilnest/services" : "neilnest/products";
  const uploadOne = async (img) => {
    const formData = new FormData();
    formData.append("file", img.file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("folder", folder);

    const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: formData });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error((errBody.error && errBody.error.message) || "Image upload failed.");
    }
    const data = await res.json();
    return data.secure_url;
  };

  return Promise.all(images.map(uploadOne));
}

/* ---------------------------------------------------------------------
   Product ID + Firestore write
--------------------------------------------------------------------- */
function generateProductId() {
  return db.collection(COLLECTIONS.businesses).doc().id; // Firestore auto-id, generated client-side
}

function readFormValues() {
  if (IS_SERVICE) {
    return {
      name: document.getElementById("pName").value.trim(),
      startingPrice: Number(document.getElementById("pPrice").value || 0),
      description: document.getElementById("pDescription").value.trim(),
      pricingType: selectedPricingType,
      deliveryTime: document.getElementById("sDeliveryTime").value.trim() || null
    };
  }
  return {
    name: document.getElementById("pName").value.trim(),
    category: document.getElementById("pCategory").value,
    price: Number(document.getElementById("pPrice").value || 0),
    salePrice: Number(document.getElementById("pSalePrice").value || 0) || null,
    description: document.getElementById("pDescription").value.trim(),
    stock: Number(document.getElementById("pStock").value || 0),
    brand: document.getElementById("pBrand").value.trim() || null,
    deliveryEnabled: document.getElementById("deliveryToggle").classList.contains("on"),
    deliveryFee: Number(document.getElementById("pDeliveryFee").value || 0) || 0,
    pickupEnabled: document.getElementById("pickupToggle").classList.contains("on"),
    pickupLocation: document.getElementById("pPickupLocation").value.trim() || null,
    condition: document.getElementById("pCondition").value
  };
}

async function saveProduct(listingId, imageUrls) {
  const v = readFormValues();
  const baseData = {
    tags,
    images: imageUrls,
    thumbnail: imageUrls[0],
    businessId: CURRENT_BUSINESS_ID,
    businessName: CURRENT_BUSINESS.name || "",
    ownerUid: CURRENT_USER.uid,
    ownerName: CURRENT_BUSINESS.ownerName || CURRENT_USER.displayName || "",
    hidden: false,
    verified: !!CURRENT_BUSINESS.verified,
    viewsCount: 0,
    bookmarkCount: 0,
    ratingAvg: 0,
    ratingCount: 0,
    // Firestore can't do substring/case-insensitive search natively — this
    // lowercase mirror of `name` is what directory.html's collectionGroup
    // search does a prefix match against (see startBusinessListener /
    // searchProductsAndServices there). Keep this in sync with `name`
    // wherever a listing gets created OR edited, since this same function
    // handles both (an edit is just another .set() with the same listingId).
    nameLower: (v.name || "").toLowerCase(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const listingData = IS_SERVICE
    ? {
        serviceId: listingId,
        name: v.name,
        description: v.description,
        startingPrice: v.startingPrice,
        pricingType: v.pricingType,
        deliveryTime: v.deliveryTime,
        ...baseData
      }
    : {
        productId: listingId,
        name: v.name,
        category: v.category,
        price: v.price,
        salePrice: v.salePrice,
        description: v.description,
        stock: v.stock,
        brand: v.brand,
        delivery: { enabled: v.deliveryEnabled, fee: v.deliveryEnabled ? v.deliveryFee : 0 },
        pickup: { enabled: v.pickupEnabled, location: v.pickupEnabled ? v.pickupLocation : null },
        condition: v.condition,
        ...baseData
      };

  const targetCollection = IS_SERVICE ? COLLECTIONS.services : COLLECTIONS.products;
  await db.collection(COLLECTIONS.businesses)
    .doc(CURRENT_BUSINESS_ID)
    .collection(targetCollection)
    .doc(listingId)
    .set(listingData);

  return listingData;
}

/* ---------------------------------------------------------------------
   Loading UX
--------------------------------------------------------------------- */
function togglePublishLoading(loading) {
  const btn = document.querySelector('#step3 .btn-primary');
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-spinner"></span> Publishing…';
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.originalText || "Publish Product";
    btn.disabled = false;
  }
}

/* ---------------------------------------------------------------------
   Publish flow
--------------------------------------------------------------------- */
async function publishProduct() {
  if (isPublishing) return;
  if (!CURRENT_BUSINESS_ID || !CURRENT_USER) {
    showToast("Still loading your business — try again in a moment.", "error");
    return;
  }
  if (!validateStep1() || !validateStep2()) return;

  isPublishing = true;
  togglePublishLoading(true);

  try {
    let imageUrls;
    try {
      imageUrls = await uploadImagesToCloudinary(uploadedImages);
    } catch (uploadErr) {
      console.error("Cloudinary upload error:", uploadErr);
      showToast(uploadErr.message || "Image upload failed. Publish stopped.", "error");
      return;
    }

    const productId = generateProductId();

    try {
      await saveProduct(productId, imageUrls);
    } catch (firestoreErr) {
      console.error("Firestore save error:", firestoreErr);
      showToast(firestoreErr.message || "Couldn't save your listing. Try again.", "error");
      return;
    }

    lastPublishedProductId = productId;
    showToast(IS_SERVICE ? "Service published successfully." : "Product published successfully.");
    goToStep(4);
  } finally {
    isPublishing = false;
    togglePublishLoading(false);
  }
}

/* ---------------------------------------------------------------------
   Reset
--------------------------------------------------------------------- */
function resetFlow() {
  uploadedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
  uploadedImages = [];
  tags = [];
  lastPublishedProductId = null;
  document.querySelectorAll(".text-input, textarea, select").forEach((el) => (el.value = ""));
  document.getElementById("descCount").textContent = "0";
  if (IS_SERVICE) {
    selectedPricingType = "Fixed";
    document.querySelectorAll(".pricing-pill").forEach((b) => b.classList.toggle("selected", b.dataset.value === "Fixed"));
  }
  renderImageGrid();
  renderTags();
  goToStep(1);
}
