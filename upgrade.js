/* ==========================================================================
   upgrade.js — NeilNest Upgrade Plan page
   Requires (loaded before this): firebase-init.js, auth-guard.js, billing.js
   ========================================================================== */

/* ⚠️ Cloudinary config — same as add-product.js, fill in your real values. */
const CLOUDINARY_CLOUD_NAME = "dhwelpyz";
const CLOUDINARY_UPLOAD_PRESET = "NeilNest";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

let CURRENT_USER = null;
let CURRENT_BUSINESS_ID = null;
let billingCycle = "monthly";
let liveAccount = null;
let businessVerified = false;
let pendingCheck = null;
let selectedPlanForCheckout = null;
let proofFile = null;
let accountUnsub = null;
let businessUnsub = null;

/* ---------------------------------------------------------------------
   Toasts
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
    el.style.opacity = "0"; el.style.transition = "opacity .25s";
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

function esc(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtNaira(n) { return "₦" + (Number(n) || 0).toLocaleString(); }

/* ---------------------------------------------------------------------
   Init
--------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  bindStaticUI();

  CURRENT_USER = await Promise.race([
    waitForAuthUser(),
    new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 8000))
  ]);
  if (CURRENT_USER === "TIMEOUT" || !CURRENT_USER) {
    window.location.href = "signin.html?redirect=upgrade.html";
    return;
  }

  try {
    const bizSnap = await db.collection(COLLECTIONS.businesses).where("ownerUid", "==", CURRENT_USER.uid).limit(1).get();
    CURRENT_BUSINESS_ID = bizSnap.empty ? null : bizSnap.docs[0].id;

    await seedPlansIfMissing();

    renderPlans();
    renderCompareTable();
    renderWhyUpgrade();
    loadHistory();

    accountUnsub = listenToAccountExtras(CURRENT_USER.uid, (extras) => {
      liveAccount = extras;
      renderCurrentPlanCard(extras);
      renderPlans(); // re-render so button states (Current Plan / disabled) stay accurate
    });

    if (CURRENT_BUSINESS_ID) {
      businessUnsub = db.collection(COLLECTIONS.businesses).doc(CURRENT_BUSINESS_ID).onSnapshot((snap) => {
        businessVerified = !!(snap.exists && snap.data().verified);
        renderPlans();
      });
    }

    document.getElementById("appShell").style.opacity = "1";
    document.getElementById("appShell").style.pointerEvents = "auto";
  } catch (err) {
    console.error("Upgrade page load error:", err);
    showToast("Couldn't load your plan. Check your connection.", "error");
    document.getElementById("appShell").style.opacity = "1";
    document.getElementById("appShell").style.pointerEvents = "auto";
  }
});

window.addEventListener("beforeunload", () => { if (accountUnsub) accountUnsub(); if (businessUnsub) businessUnsub(); });

/* ---------------------------------------------------------------------
   Current plan card
--------------------------------------------------------------------- */
function renderCurrentPlanCard(extras) {
  const plan = PLAN_CATALOG[extras.plan] || PLAN_CATALOG.free;
  document.getElementById("cpPlanName").textContent = plan.name;

  const pill = document.getElementById("cpStatusPill");
  const remaining = extras.planExpiresAt ? daysUntil(extras.planExpiresAt) : null;

  if (extras.plan === "free" && !extras.hasEverSubscribed) {
    pill.textContent = "Free"; pill.className = "cp-status-pill cp-status--free";
  } else if (extras.planStatus === "expired") {
    pill.textContent = "Expired"; pill.className = "cp-status-pill cp-status--expired";
  } else if (extras.planStatus === "active" && remaining !== null && remaining <= 7 && remaining >= 0) {
    pill.textContent = "Renew Soon"; pill.className = "cp-status-pill cp-status--pending";
  } else if (extras.planStatus === "active") {
    pill.textContent = "Active"; pill.className = "cp-status-pill cp-status--active";
  } else {
    pill.textContent = extras.planStatus; pill.className = "cp-status-pill cp-status--free";
  }

  const renewalEl = document.getElementById("cpRenewal");
  if (extras.planExpiresAt && extras.plan !== "free") {
    const d = extras.planExpiresAt.toDate ? extras.planExpiresAt.toDate() : new Date(extras.planExpiresAt);
    renewalEl.innerHTML = `Renews on <b>${d.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}</b>`;
    renewalEl.style.display = "block";
  } else {
    renewalEl.style.display = "none";
  }

  document.getElementById("cpBenefits").innerHTML = plan.features.slice(0, 4).map((f) => `
    <div class="cp-benefit">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5 9-10"/></svg>
      ${esc(f)}
    </div>`).join("");
}

function daysUntil(timestamp) {
  if (!timestamp) return null;
  const ms = (timestamp.toDate ? timestamp.toDate() : new Date(timestamp)) - new Date();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/* ---------------------------------------------------------------------
   Billing toggle
--------------------------------------------------------------------- */
function bindStaticUI() {
  document.getElementById("backBtn").addEventListener("click", () => history.back());

  document.querySelectorAll("#billingToggle button[data-cycle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      billingCycle = btn.dataset.cycle;
      document.querySelectorAll("#billingToggle button[data-cycle]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("billingToggle").classList.toggle("yearly", billingCycle === "yearly");
      renderPlans();
    });
  });

  document.getElementById("closeBankModal").addEventListener("click", closeBankModal);
  document.getElementById("cancelBankBtn").addEventListener("click", closeBankModal);
  document.getElementById("paidBtn").addEventListener("click", openVerifyModal);
  document.getElementById("closeVerifyModal").addEventListener("click", () => document.getElementById("verifyModal").classList.remove("open"));

  document.getElementById("copyAccountBtn").addEventListener("click", () => copyText(document.getElementById("bankAccountNumber").textContent, "Account number copied."));
  document.getElementById("copyReferenceBtn").addEventListener("click", () => copyText(document.getElementById("bankReference").textContent, "Reference copied."));

  document.getElementById("proofInput").addEventListener("change", handleProofSelect);
  document.getElementById("submitVerifyBtn").addEventListener("click", submitVerification);
  document.getElementById("returnToProfileBtn").addEventListener("click", () => { window.location.href = "business-profile.html"; });
}

function copyText(text, successMsg) {
  navigator.clipboard.writeText(text).then(() => showToast(successMsg))
    .catch(() => showToast("Couldn't copy — long-press to copy manually.", "error"));
}

/* ---------------------------------------------------------------------
   Plan cards
--------------------------------------------------------------------- */
function priceFor(planId) {
  const p = PLAN_CATALOG[planId];
  if (billingCycle === "yearly") return p.priceYearly;
  return p.priceMonthly;
}

function renderPlans() {
  const wrap = document.getElementById("plansWrap");
  const account = liveAccount || { plan: "free", planStatus: "active" };

  wrap.innerHTML = `
    ${planCardHtml("free", account)}
    ${planCardHtml("pro", account)}
    ${planCardHtml("business", account)}
  `;

  document.querySelectorAll("[data-upgrade-btn]").forEach((btn) => {
    btn.addEventListener("click", () => startCheckout(btn.dataset.upgradeBtn, !!btn.dataset.withAddon));
  });
  const addonToggle = document.getElementById("proAddonToggle");
  if (addonToggle) {
    addonToggle.addEventListener("change", () => {
      document.getElementById("proUpgradeBtn").dataset.withAddon = addonToggle.checked ? "1" : "";
    });
  }
}

function planCardHtml(planId, account) {
  const p = PLAN_CATALOG[planId];
  const isCurrent = account.plan === planId && account.planStatus === "active";
  const meetsRank = PLAN_RANK[account.plan] >= PLAN_RANK[planId];
  const priceLabel = planId === "free" ? "₦0" : `${fmtNaira(priceFor(planId))}<span>/${billingCycle === "yearly" ? "year" : "month"}</span>`;

  const featuresHtml = p.features.map((f) => `
    <div class="plan-feature"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5 9-10"/></svg>${esc(f)}</div>
  `).join("");

  let ribbon = "";
  if (planId === "pro") ribbon = `<div class="plan-ribbon">Most Popular</div>`;
  if (planId === "business") ribbon = `<div class="plan-ribbon">Premium</div>`;

  let addon = "";
  if (planId === "pro" && !isCurrent) {
    // Upgrading into Pro — bundle the badge into the same payment, as before.
    addon = `
      <label class="plan-addon" for="proAddonToggle">
        <span>Add Verified Badge (+${fmtNaira(p.verificationAddon)})</span>
        <input type="checkbox" id="proAddonToggle">
      </label>`;
  } else if (planId === "pro" && isCurrent) {
    // Already on Pro — the bundled checkbox has nothing to attach to
    // (there's no "Upgrade to PRO" button in this state). Offer a
    // standalone purchase instead, so an existing Pro user can still buy
    // the badge later.
    addon = businessVerified
      ? `<div class="plan-addon" style="cursor: default;"><span>✓ Verified Badge active</span></div>`
      : `<button class="plan-btn plan-btn--outline" id="badgeOnlyBtn" style="margin-bottom: 12px;" onclick="startBadgeOnlyCheckout()">Add Verified Badge (+${fmtNaira(p.verificationAddon)})</button>`;
  }

  let btnHtml;
  if (planId === "free") {
    btnHtml = isCurrent
      ? `<button class="plan-btn plan-btn--outline" disabled>Current Plan</button>`
      : `<button class="plan-btn plan-btn--outline" disabled>Downgrade unavailable here</button>`;
  } else if (isCurrent) {
    btnHtml = `<button class="plan-btn plan-btn--outline" disabled>Current Plan</button>`;
  } else if (meetsRank && account.planStatus === "active") {
    btnHtml = `<button class="plan-btn plan-btn--outline" disabled>Current Plan</button>`;
  } else {
    btnHtml = `<button class="plan-btn plan-btn--gold" id="${planId === "pro" ? "proUpgradeBtn" : ""}" data-upgrade-btn="${planId}">Upgrade to ${p.name.toUpperCase()}</button>`;
  }

  return `
    <div class="plan-card ${planId !== "free" ? "plan-card--" + planId : ""}">
      ${ribbon}
      <div class="plan-head">
        <div class="plan-name">${p.name}</div>
      </div>
      <div class="plan-price">${priceLabel}</div>
      ${billingCycle === "yearly" && planId !== "free" ? `<div class="plan-price-note">Billed yearly</div>` : ""}
      <div class="plan-features">${featuresHtml}</div>
      ${addon}
      ${btnHtml}
    </div>`;
}

/* ---------------------------------------------------------------------
   Comparison table
--------------------------------------------------------------------- */
function renderCompareTable() {
  const rows = [
    ["Business Listings", "1", "1", "1"],
    ["Products", "Up to 3", "Up to 30", "Unlimited"],
    ["Images per product", "3", "10", "Unlimited"],
    ["Verified Badge", false, "Optional (+₦2,500)", true],
    ["Business Learning Hub", false, true, true],
    ["Social Links", "WhatsApp + Website", "+6 platforms", "+6 platforms"]
  ];
  const cell = (v) => {
    if (v === true) return `<svg class="yes" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg>`;
    if (v === false) return `<svg class="no" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    return esc(v);
  };
  document.getElementById("compareTable").innerHTML = `
    <thead><tr><th>Feature</th><th>Free</th><th class="col-pro">Pro</th><th class="col-business">Business</th></tr></thead>
    <tbody>
      ${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${cell(r[1])}</td><td>${cell(r[2])}</td><td>${cell(r[3])}</td></tr>`).join("")}
    </tbody>`;
}

/* ---------------------------------------------------------------------
   Why upgrade
--------------------------------------------------------------------- */
function renderWhyUpgrade() {
  const items = [
    { title: "More Products", desc: "List up to 30 products on Pro, unlimited on Business.", path: "M20 7l-8-4-8 4m16 0v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4" },
    { title: "Better Photos", desc: "10 images per product on Pro, unlimited on Business.", path: "M3 3h18v18H3z M8.5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z M21 15l-5-5L5 21" },
    { title: "Verified Badge", desc: "Build trust with a verified badge on your profile.", path: "M12 2l3 6 6.5 1-4.7 4.6L18 20l-6-3.4L6 20l1.2-6.4L2.5 9l6.5-1 3-6z" },
    { title: "Business Learning Hub", desc: "Access lessons on growing your business, Pro and up.", path: "M22 10L12 5 2 10l10 5 10-5z" },
    { title: "Social Links", desc: "Add Instagram, Facebook, TikTok, LinkedIn, X, and YouTube.", path: "M18 8a3 3 0 1 0-2.83-4H15a3 3 0 0 0 0 6h.17A3 3 0 0 0 18 8z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" }
  ];
  document.getElementById("whyGrid").innerHTML = items.map((it) => `
    <div class="why-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${it.path}"/></svg></div>
      <div class="why-title">${it.title}</div>
      <div class="why-desc">${it.desc}</div>
    </div>`).join("");
}

/* ---------------------------------------------------------------------
   Payment history
--------------------------------------------------------------------- */
async function loadHistory() {
  try {
    const items = await getPaymentHistory(CURRENT_USER.uid, 20);
    const wrap = document.getElementById("historyWrap");
    if (items.length === 0) {
      wrap.innerHTML = `<div class="empty-note">No payments submitted yet.</div>`;
      return;
    }
    wrap.innerHTML = items.map((h) => {
      const plan = PLAN_CATALOG[h.plan] || { name: h.plan };
      const date = h.submittedAt && h.submittedAt.toDate ? h.submittedAt.toDate().toLocaleDateString() : "";
      const statusClass = h.status === "approved" ? "h-status--approved" : h.status === "rejected" ? "h-status--rejected" : "h-status--pending";
      return `
        <div class="history-item">
          <div>
            <div class="h-plan">${esc(plan.name)} — ${esc(h.billingCycle || "monthly")}</div>
            <div class="h-meta">Ref ${esc(h.reference)} · ${date}</div>
            ${h.status === "rejected" && h.rejectionReason ? `<div class="h-meta" style="color:#f3a89e;">${esc(h.rejectionReason)}</div>` : ""}
          </div>
          <div>
            <div class="h-amount">${fmtNaira(h.amount)}</div>
            <span class="h-status ${statusClass}">${esc(h.status)}</span>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    console.error("loadHistory error:", err);
  }
}

/* ---------------------------------------------------------------------
   Checkout: generate reference → show bank details
--------------------------------------------------------------------- */
async function startCheckout(planId, withAddon) {
  if (!CURRENT_BUSINESS_ID) {
    showToast("You need a business profile before upgrading.", "error");
    return;
  }
  const pending = await getPendingPayment(CURRENT_USER.uid);
  if (pending) {
    showToast("You already have a payment under review. Please wait for it to be verified.", "error");
    return;
  }

  const btn = document.querySelector(`[data-upgrade-btn="${planId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Preparing…"; }

  try {
    const reference = await generateUniquePaymentReference();
    const addonChecked = planId === "pro" && document.getElementById("proAddonToggle") && document.getElementById("proAddonToggle").checked;
    let amount = priceFor(planId);
    if (addonChecked) amount += PLAN_CATALOG.pro.verificationAddon;

    selectedPlanForCheckout = { planId, billingCycle, reference, amount, verificationAddon: addonChecked || planId === "business" };

    document.getElementById("bankName").textContent = BANK_DETAILS.bankName;
    document.getElementById("bankAccountName").textContent = BANK_DETAILS.accountName;
    document.getElementById("bankAccountNumber").textContent = BANK_DETAILS.accountNumber;
    document.getElementById("bankAmount").textContent = fmtNaira(amount);
    document.getElementById("bankReference").textContent = reference;
    renderSafetyNotice("bankSafetyNotice");
    document.getElementById("bankModal").classList.add("open");
  } catch (err) {
    console.error("startCheckout error:", err);
    showToast(err.message || "Couldn't start checkout. Try again.", "error");
  } finally {
    renderPlans();
  }
}

function closeBankModal() {
  document.getElementById("bankModal").classList.remove("open");
}

/* ---------------------------------------------------------------------
   Standalone Verified Badge purchase — for a user already on Pro who
   skipped the badge at signup and wants it later. Reuses the same bank
   transfer + admin-verification flow as a normal upgrade; it's the same
   verificationAddon:true payload the admin approval flow already handles,
   just without also changing the plan tier (planId stays "pro").
--------------------------------------------------------------------- */
async function startBadgeOnlyCheckout() {
  if (!CURRENT_BUSINESS_ID) {
    showToast("You need a business profile before upgrading.", "error");
    return;
  }
  const pending = await getPendingPayment(CURRENT_USER.uid);
  if (pending) {
    showToast("You already have a payment under review. Please wait for it to be verified.", "error");
    return;
  }

  const btn = document.getElementById("badgeOnlyBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Preparing…"; }

  try {
    const reference = await generateUniquePaymentReference();
    const amount = PLAN_CATALOG.pro.verificationAddon;

    selectedPlanForCheckout = { planId: "pro", billingCycle, reference, amount, verificationAddon: true, badgeOnly: true };

    document.getElementById("bankName").textContent = BANK_DETAILS.bankName;
    document.getElementById("bankAccountName").textContent = BANK_DETAILS.accountName;
    document.getElementById("bankAccountNumber").textContent = BANK_DETAILS.accountNumber;
    document.getElementById("bankAmount").textContent = fmtNaira(amount);
    document.getElementById("bankReference").textContent = reference;
    renderSafetyNotice("bankSafetyNotice");
    document.getElementById("bankModal").classList.add("open");
  } catch (err) {
    console.error("startBadgeOnlyCheckout error:", err);
    showToast(err.message || "Couldn't start checkout. Try again.", "error");
  } finally {
    renderPlans();
  }
}

/* ---------------------------------------------------------------------
   "I've Made The Transfer" → verification form (no activation happens here)
--------------------------------------------------------------------- */
function openVerifyModal() {
  closeBankModal();
  document.getElementById("vSenderName").value = "";
  document.getElementById("vPhone").value = "";
  document.getElementById("vAmount").value = selectedPlanForCheckout.amount;
  document.getElementById("vTransferDate").value = new Date().toISOString().slice(0, 10);
  document.getElementById("vReference").value = selectedPlanForCheckout.reference;
  document.getElementById("vNote").value = "";
  proofFile = null;
  document.getElementById("proofUploadWrap").classList.remove("has-image");
  document.getElementById("proofUploadWrap").innerHTML = `
    <svg class="ph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
    <div class="ph-text">Tap to upload screenshot</div>
    <div class="ph-sub">JPG or PNG, max 5MB</div>`;
  document.getElementById("verifyModal").classList.add("open");
}

function handleProofSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { showToast("Please choose an image file.", "error"); return; }
  if (file.size > 5 * 1024 * 1024) { showToast("Image is too large — max 5MB.", "error"); return; }
  proofFile = file;
  const wrap = document.getElementById("proofUploadWrap");
  wrap.classList.add("has-image");
  wrap.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Proof of payment">`;
}

async function uploadProofToCloudinary(file) {
  if (CLOUDINARY_CLOUD_NAME === "YOUR_CLOUDINARY_CLOUD_NAME") {
    throw new Error("Cloudinary isn't configured yet — set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in upgrade.js.");
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", "neilnest/payment-proofs");

  const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: formData });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody.error && errBody.error.message) || "Image upload failed.");
  }
  const data = await res.json();
  return data.secure_url;
}

async function submitVerification() {
  const senderName = document.getElementById("vSenderName").value.trim();
  const phone = document.getElementById("vPhone").value.trim();
  const amountPaid = Number(document.getElementById("vAmount").value);
  const transferDate = document.getElementById("vTransferDate").value;
  const reference = document.getElementById("vReference").value;
  const note = document.getElementById("vNote").value.trim();

  if (!senderName) return showToast("Sender name is required.", "error");
  if (!phone) return showToast("Phone number is required.", "error");
  if (!amountPaid || amountPaid <= 0) return showToast("Enter a valid amount.", "error");
  if (!transferDate) return showToast("Transfer date is required.", "error");
  if (!proofFile) return showToast("Upload your proof of payment.", "error");

  const btn = document.getElementById("submitVerifyBtn");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    const proofImage = await uploadProofToCloudinary(proofFile);

    await submitPaymentVerification({
      uid: CURRENT_USER.uid,
      businessId: CURRENT_BUSINESS_ID,
      plan: selectedPlanForCheckout.planId,
      billingCycle: selectedPlanForCheckout.billingCycle,
      verificationAddon: selectedPlanForCheckout.verificationAddon,
      badgeOnly: !!selectedPlanForCheckout.badgeOnly,
      amount: amountPaid,
      reference,
      senderName,
      phone,
      transferDate,
      proofImage,
      note
    });

    document.getElementById("verifyModal").classList.remove("open");
    document.getElementById("successModal").classList.add("open");
    loadHistory();
  } catch (err) {
    console.error("submitVerification error:", err);
    showToast(err.message || "Couldn't submit your payment. Try again.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit for Review";
  }
}
