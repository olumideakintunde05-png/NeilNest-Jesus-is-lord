/* ==========================================================================
   product-details.js — NeilNest
   Requires: firebase-init.js, auth-guard.js, billing.js, trustsafety-core.js
   URL: product-details.html?id={productId}&business={businessId}
   Schema matches add-business.js exactly: name, category, description,
   price, negotiable, stockStatus, hidden, images[] — no invented fields.
   ========================================================================== */

let CURRENT_USER = null;
let PRODUCT_ID = null;
let BUSINESS_ID = null;
let PRODUCT = null;
let BUSINESS = null;

function showToast(msg, type) {
  const host = document.getElementById("toast-host");
  if (!host) { console.warn(msg); return; }
  const el = document.createElement("div");
  el.className = "toast";
  el.style.borderColor = type === "error" ? "rgba(225,75,75,0.4)" : "rgba(55,198,95,0.4)";
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0"; el.style.transition = "opacity .25s";
    setTimeout(() => el.remove(), 250);
  }, 3200);
}
function esc(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtNaira(n) { return "₦" + (Number(n) || 0).toLocaleString(); }

document.addEventListener("DOMContentLoaded", async () => {
  bindStaticUI();

  CURRENT_USER = await Promise.race([
    waitForAuthUser(),
    new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 8000))
  ]);
  if (CURRENT_USER === "TIMEOUT" || !CURRENT_USER) {
    window.location.href = "signin.html?redirect=product-details.html" + window.location.search;
    return;
  }

  const params = new URLSearchParams(window.location.search);
  PRODUCT_ID = params.get("id");
  BUSINESS_ID = params.get("business");

  if (!PRODUCT_ID || !BUSINESS_ID) {
    showToast("This product link is missing information.", "error");
    document.getElementById("appShell").style.opacity = "1";
    document.getElementById("appShell").style.pointerEvents = "auto";
    return;
  }

  try {
    const [bizSnap, prodSnap] = await Promise.all([
      db.collection(COLLECTIONS.businesses).doc(BUSINESS_ID).get(),
      db.collection(COLLECTIONS.businesses).doc(BUSINESS_ID).collection(COLLECTIONS.products).doc(PRODUCT_ID).get()
    ]);

    if (!bizSnap.exists || !prodSnap.exists) {
      showToast("This product isn't available anymore.", "error");
      document.getElementById("appShell").style.opacity = "1";
      document.getElementById("appShell").style.pointerEvents = "auto";
      return;
    }

    BUSINESS = bizSnap.data();
    PRODUCT = prodSnap.data();
    const isOwner = BUSINESS.ownerUid === CURRENT_USER.uid;
    if (PRODUCT.adminHidden && !isOwner) {
      showToast("This product isn't available anymore.", "error");
      document.getElementById("appShell").style.opacity = "1";
      document.getElementById("appShell").style.pointerEvents = "auto";
      return;
    }

    if (!isOwner) trackProductView();

    renderGallery();
    renderProductInfo();
    renderBusinessCard(isOwner);
    renderSafetyNotice("pSafetyNotice");
    if (!isOwner) document.getElementById("actionBar").style.display = "flex";
    loadRelatedProducts();

    document.getElementById("appShell").style.opacity = "1";
    document.getElementById("appShell").style.pointerEvents = "auto";
  } catch (err) {
    console.error("Product load error:", err);
    showToast("Couldn't load this product. Check your connection.", "error");
    document.getElementById("appShell").style.opacity = "1";
    document.getElementById("appShell").style.pointerEvents = "auto";
  }
});

function trackProductView() {
  const key = `neilnest_viewed_product_${PRODUCT_ID}`;
  if (sessionStorage.getItem(key)) return;
  db.collection(COLLECTIONS.businesses).doc(BUSINESS_ID).collection(COLLECTIONS.products).doc(PRODUCT_ID)
    .set({ viewsCount: firebase.firestore.FieldValue.increment(1) }, { merge: true }).catch((err) => console.error("product view tracking error:", err));
  sessionStorage.setItem(key, "1");
}

function bindStaticUI() {
  document.getElementById("backBtn").addEventListener("click", () => history.back());
  document.getElementById("moreBtn").addEventListener("click", () => document.getElementById("morePanel").classList.toggle("open"));
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("morePanel");
    if (panel.classList.contains("open") && !panel.contains(e.target) && e.target.id !== "moreBtn") panel.classList.remove("open");
  });
  document.getElementById("shareBtn").addEventListener("click", () => {
    const url = window.location.href;
    if (navigator.share) navigator.share({ title: PRODUCT ? PRODUCT.name : "NeilNest", url }).catch(() => {});
    else navigator.clipboard.writeText(url).then(() => showToast("Link copied."));
  });
  document.getElementById("reportProductBtn").addEventListener("click", () => {
    document.getElementById("morePanel").classList.remove("open");
    openReportModal({ type: "product", targetId: PRODUCT_ID, targetName: PRODUCT.name, businessId: BUSINESS_ID });
  });
  document.getElementById("messageBtn").addEventListener("click", () => {
    window.location.href = `messages.html?to=${BUSINESS.ownerUid}&business=${BUSINESS_ID}&product=${PRODUCT_ID}`;
  });
}

function renderGallery() {
  const images = (PRODUCT.images && PRODUCT.images.length) ? PRODUCT.images : [""];
  const scroll = document.getElementById("galleryScroll");
  scroll.innerHTML = images.map((src) => `<img src="${src}" alt="${esc(PRODUCT.name)}" onerror="this.style.background='#141414'">`).join("");

  const dots = document.getElementById("galleryDots");
  if (images.length > 1) {
    dots.innerHTML = images.map((_, i) => `<span class="${i === 0 ? "active" : ""}"></span>`).join("");
    scroll.addEventListener("scroll", () => {
      const idx = Math.round(scroll.scrollLeft / scroll.clientWidth);
      dots.querySelectorAll("span").forEach((d, i) => d.classList.toggle("active", i === idx));
    });
  }
}

function renderProductInfo() {
  document.getElementById("pName").textContent = PRODUCT.name || "Untitled Product";
  document.getElementById("pPrice").textContent = fmtNaira(PRODUCT.price);
  document.getElementById("pNegotiable").style.display = PRODUCT.negotiable ? "inline-block" : "none";
  document.getElementById("pCategory").textContent = PRODUCT.category || "";
  document.getElementById("pDesc").textContent = PRODUCT.description || "No description provided.";

  const stockEl = document.getElementById("pStock");
  const stock = PRODUCT.stockStatus || "In Stock";
  stockEl.textContent = stock;
  stockEl.className = "stock-pill " + (stock.toLowerCase().includes("out") ? "out" : stock.toLowerCase().includes("low") ? "low" : "in");
}

function renderBusinessCard(isOwner) {
  document.getElementById("bizAvatar").src = BUSINESS.logoUrl || "";
  document.getElementById("bizName").textContent = BUSINESS.name || "Business";
  document.getElementById("bizVerifiedBadge").style.display = BUSINESS.verified ? "inline-flex" : "none";
  document.getElementById("bizTrustedBadge").style.display = BUSINESS.trustedSeller ? "inline-flex" : "none";
  document.getElementById("bizSub").textContent = [BUSINESS.category, BUSINESS.location && BUSINESS.location.city].filter(Boolean).join(" · ");
  document.getElementById("bizVisitBtn").href = `business-profile.html?id=${BUSINESS_ID}`;

  if (!isOwner) {
    if (BUSINESS.phone) { document.getElementById("callBtn").style.display = "flex"; document.getElementById("callBtn").href = `tel:${BUSINESS.phone}`; }
    if (BUSINESS.whatsapp) { document.getElementById("whatsappBtn").style.display = "flex"; document.getElementById("whatsappBtn").href = `https://wa.me/${BUSINESS.whatsapp.replace(/[^0-9]/g, "")}`; }
  }
}

async function loadRelatedProducts() {
  try {
    const snap = await db.collection(COLLECTIONS.businesses).doc(BUSINESS_ID).collection(COLLECTIONS.products)
      .where("hidden", "==", false).limit(7).get();
    const items = snap.docs.filter((d) => d.id !== PRODUCT_ID).slice(0, 6).map((d) => ({ id: d.id, ...d.data() }));
    if (items.length === 0) return;

    document.getElementById("relatedSection").style.display = "block";
    document.getElementById("relatedScroll").innerHTML = items.map((p) => `
      <a class="related-card" href="product-details.html?id=${p.id}&business=${BUSINESS_ID}">
        <img src="${(p.images && p.images[0]) || ""}" alt="${esc(p.name)}" onerror="this.style.background='#141414'">
        <div class="r-name">${esc(p.name)}</div>
        <div class="r-price">${fmtNaira(p.price)}</div>
      </a>`).join("");
  } catch (err) {
    console.error("loadRelatedProducts error:", err);
  }
}
