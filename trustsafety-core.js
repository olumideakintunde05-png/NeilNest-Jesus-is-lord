/* ==========================================================================
   trustsafety-core.js — NeilNest Trust & Safety shared logic
   Requires: firebase-init.js, auth-guard.js, billing.js (for showToast if
   the host page hasn't defined its own — most pages define their own, this
   only defines one as a fallback).

   Include this on ANY page that needs a Report button, a blocked-business
   check, a Trusted Seller/Verified badge, or the safety notice — it's
   self-contained and injects its own modal DOM on demand, so no page HTML
   needs to be edited to use it.

   NOT wired to any UI yet: suspendBusiness, banBusiness, restoreBusiness,
   awardTrustedSeller, removeTrustedSeller, resolveReport, dismissReport,
   warnBusiness. These are real, complete Firestore operations (same
   pattern as approvePayment/rejectPayment in billing.js) for whenever the
   admin panel gets built — calling them today just means calling them from
   the browser console or a temporary button, since Firestore rules only
   allow admins to write these fields regardless of who calls the function.
   ========================================================================== */

/* ⚠️ Cloudinary config — same pattern as every other file, fill in your
   real values. Report screenshots upload here. */
const TS_CLOUDINARY_CLOUD_NAME = "YOUR_CLOUDINARY_CLOUD_NAME";
const TS_CLOUDINARY_UPLOAD_PRESET = "YOUR_UNSIGNED_UPLOAD_PRESET";

const REPORT_REASONS = [
  "Scam", "Fake Business", "Fake Product", "Counterfeit Product",
  "Misleading Information", "Harassment", "Spam", "Illegal Product", "Other"
];

/* Shown on Business Profile, Product Details, Messages, and the Upgrade
   payment-confirmation modal — call renderSafetyNotice(elementId) to drop
   it into any page, or just read SAFETY_NOTICE_TEXT directly. */
const SAFETY_NOTICE_TEXT = "NeilNest is an online marketplace connecting buyers and sellers. NeilNest does not process payments between users and does not guarantee product quality, authenticity, delivery, or future conduct. Verify products and businesses before paying, and report anything that looks wrong.";

function renderSafetyNotice(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;color:#6e6e6e;flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
    <span>${SAFETY_NOTICE_TEXT}</span>`;
}

/* Fallback toast if the host page doesn't already define showToast(). */
if (typeof showToast !== "function") {
  window.showToast = function (msg, type) {
    let host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      host.style.cssText = "position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:300;display:flex;flex-direction:column;gap:8px;width:calc(100% - 40px);max-width:350px;";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.style.cssText = `display:flex;align-items:center;gap:10px;background:#161616;border:1px solid ${type === "error" ? "rgba(225,75,75,0.4)" : "rgba(255,255,255,0.1)"};border-radius:14px;padding:13px 16px;font-size:13px;font-weight:600;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,0.5);`;
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .25s"; setTimeout(() => el.remove(), 250); }, 3200);
  };
}

/* ---------------------------------------------------------------------
   Badges — Verified (subscription-based, see billing.js) and Trusted
   Seller (admin-awarded, independent of plan) are two separate things
   and a business can have either, both, or neither.
--------------------------------------------------------------------- */
function renderTrustBadges(business) {
  let html = "";
  if (business.verified) {
    html += `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;color:#37c65f;" title="Verified"><circle cx="12" cy="12" r="10"/></svg>`;
  }
  if (business.trustedSeller) {
    html += `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;color:#e0a83c;" title="Trusted Seller"><path d="M12 2l2.4 4.8 5.3.8-3.85 3.75.9 5.3L12 14.2l-4.75 2.45.9-5.3L4.3 7.6l5.3-.8z"/></svg>`;
  }
  return html;
}

/* ---------------------------------------------------------------------
   Business status + profile completion
--------------------------------------------------------------------- */
function calculateProfileCompletion(business, hasAtLeastOneProduct, hasAtLeastOneProductImage) {
  const checks = [
    !!business.logoUrl,
    !!business.coverUrl,
    !!(business.description && business.description.trim().length > 10),
    !!business.category,
    !!(business.address && business.address.trim()),
    !!business.phone,
    !!business.hours,
    !!hasAtLeastOneProduct,
    !!hasAtLeastOneProductImage
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}

function getBusinessStatus(business, completionPct) {
  if (business.suspended) return { label: "Suspended", cls: "ts-status--suspended" };
  if (business.underInvestigation) return { label: "Under Investigation", cls: "ts-status--investigating" };
  if (business.trustedSeller) return { label: "Trusted Seller", cls: "ts-status--trusted" };
  if (completionPct >= 100) return { label: "Profile Completed", cls: "ts-status--complete" };
  return { label: "New Business", cls: "ts-status--new" };
}

/* ---------------------------------------------------------------------
   Report submission — businessReports / productReports / userReports
--------------------------------------------------------------------- */
async function uploadReportScreenshot(file) {
  if (TS_CLOUDINARY_CLOUD_NAME === "YOUR_CLOUDINARY_CLOUD_NAME") {
    throw new Error("Cloudinary isn't configured yet — set TS_CLOUDINARY_CLOUD_NAME/PRESET in trustsafety-core.js.");
  }
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", TS_CLOUDINARY_UPLOAD_PRESET);
  fd.append("folder", "neilnest/report-screenshots");
  const res = await fetch(`https://api.cloudinary.com/v1_1/${TS_CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Screenshot upload failed.");
  const data = await res.json();
  return data.secure_url;
}

/* type: "business" | "product" | "user"
   target: { targetId, targetName, businessId (required for business/product) } */
async function submitReport(type, target, reason, description, screenshotFile) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to submit a report.");
  if (!reason) throw new Error("Please choose a reason.");

  let screenshotUrl = null;
  if (screenshotFile) screenshotUrl = await uploadReportScreenshot(screenshotFile);

  const collectionName = type === "business" ? COLLECTIONS.businessReports : type === "product" ? COLLECTIONS.productReports : COLLECTIONS.userReports;

  const docData = {
    reporterUid: user.uid,
    targetId: target.targetId,
    targetName: target.targetName || null,
    businessId: target.businessId || null,
    reason, description: description || null,
    screenshotUrl,
    status: "pending",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  await db.collection(collectionName).add(docData);

  // Multiple reports -> auto-flag "Under Investigation", never auto-suspend.
  // Applies to business and product reports (product reports flag the
  // parent business, since that's who gets moderated).
  const flagBusinessId = type === "user" ? null : target.businessId;
  if (flagBusinessId) checkUnderInvestigationThreshold(flagBusinessId);

  return true;
}

const UNDER_INVESTIGATION_THRESHOLD = 3;
async function checkUnderInvestigationThreshold(businessId) {
  try {
    const [bizReports, prodReports] = await Promise.all([
      db.collection(COLLECTIONS.businessReports).where("businessId", "==", businessId).where("status", "==", "pending").get(),
      db.collection(COLLECTIONS.productReports).where("businessId", "==", businessId).where("status", "==", "pending").get()
    ]);
    const total = bizReports.size + prodReports.size;
    if (total >= UNDER_INVESTIGATION_THRESHOLD) {
      await db.collection(COLLECTIONS.businesses).doc(businessId).set({ underInvestigation: true }, { merge: true });
    }
  } catch (err) {
    console.error("checkUnderInvestigationThreshold error:", err);
  }
}

/* ---------------------------------------------------------------------
   Report modal — self-injecting, no HTML edits needed on the host page.
   Call: openReportModal({ type: "business"|"product"|"user", targetId, targetName, businessId })
--------------------------------------------------------------------- */
function ensureReportModalDOM() {
  if (document.getElementById("tsReportModal")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <style>
      #tsReportModal { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 400; display: none; align-items: flex-end; justify-content: center; font-family: -apple-system, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif; }
      #tsReportModal.open { display: flex; }
      #tsReportModal .ts-sheet { width: 100%; max-width: 390px; background: #0c0c0c; border-radius: 20px 20px 0 0; padding: 20px; max-height: 85vh; overflow-y: auto; position: relative; color: #fff; }
      #tsReportModal h3 { font-size: 16px; font-weight: 800; margin-bottom: 4px; }
      #tsReportModal .ts-sub { font-size: 12px; color: #a8a8a8; margin-bottom: 16px; }
      #tsReportModal .ts-close { position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; color: #fff; }
      #tsReportModal .ts-reasons { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
      #tsReportModal .ts-reason-chip { font-size: 12px; font-weight: 600; padding: 8px 13px; border-radius: 999px; background: #141414; border: 1px solid rgba(255,255,255,0.08); color: #d8d8d8; cursor: pointer; }
      #tsReportModal .ts-reason-chip.selected { background: rgba(224,168,60,0.12); border-color: #e0a83c; color: #e0a83c; }
      #tsReportModal textarea { width: 100%; background: #141414; border: 1px solid rgba(255,255,255,0.08); border-radius: 13px; padding: 13px 14px; font-size: 13.5px; color: #fff; outline: none; resize: none; min-height: 80px; margin-bottom: 14px; font-family: inherit; }
      #tsReportModal .ts-upload { border: 1.5px dashed rgba(255,255,255,0.15); border-radius: 13px; padding: 16px; text-align: center; cursor: pointer; font-size: 12px; color: #a8a8a8; margin-bottom: 16px; }
      #tsReportModal .ts-upload.has-image { padding: 0; border-style: solid; overflow: hidden; }
      #tsReportModal .ts-upload img { width: 100%; max-height: 140px; object-fit: cover; display: block; }
      #tsReportModal .ts-submit { width: 100%; height: 50px; border-radius: 14px; background: #c0392b; color: #ffe8e4; font-weight: 800; font-size: 14px; border: none; cursor: pointer; }
      #tsReportModal .ts-submit[disabled] { opacity: 0.6; pointer-events: none; }
    </style>
    <div id="tsReportModal">
      <div class="ts-sheet">
        <button class="ts-close" id="tsReportClose">&#10005;</button>
        <h3>Report <span id="tsReportTargetLabel"></span></h3>
        <div class="ts-sub">Reports are reviewed by our team. False reports may affect your account.</div>
        <div class="ts-reasons" id="tsReasons"></div>
        <textarea id="tsReportDesc" placeholder="Optional — describe what happened"></textarea>
        <label class="ts-upload" id="tsUploadWrap" for="tsReportScreenshot">Tap to add a screenshot (optional)</label>
        <input type="file" id="tsReportScreenshot" accept="image/*" style="display:none;">
        <button class="ts-submit" id="tsReportSubmit">Submit Report</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  document.getElementById("tsReasons").innerHTML = REPORT_REASONS.map((r) => `<button type="button" class="ts-reason-chip" data-reason="${r}">${r}</button>`).join("");
  document.getElementById("tsReasons").addEventListener("click", (e) => {
    const chip = e.target.closest(".ts-reason-chip");
    if (!chip) return;
    document.querySelectorAll(".ts-reason-chip").forEach((c) => c.classList.remove("selected"));
    chip.classList.add("selected");
  });
  document.getElementById("tsReportClose").addEventListener("click", closeReportModal);
  document.getElementById("tsReportScreenshot").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const wrap = document.getElementById("tsUploadWrap");
    wrap.classList.add("has-image");
    wrap.innerHTML = `<img src="${URL.createObjectURL(file)}">`;
    wrap._file = file;
  });
}

let _tsReportContext = null;
function openReportModal(context) {
  ensureReportModalDOM();
  _tsReportContext = context;
  document.getElementById("tsReportTargetLabel").textContent = context.targetName || (context.type === "user" ? "User" : "Item");
  document.querySelectorAll(".ts-reason-chip").forEach((c) => c.classList.remove("selected"));
  document.getElementById("tsReportDesc").value = "";
  const uploadWrap = document.getElementById("tsUploadWrap");
  uploadWrap.classList.remove("has-image");
  uploadWrap.innerHTML = "Tap to add a screenshot (optional)";
  uploadWrap._file = null;
  document.getElementById("tsReportScreenshot").value = "";

  const submitBtn = document.getElementById("tsReportSubmit");
  submitBtn.onclick = handleReportSubmit;

  document.getElementById("tsReportModal").classList.add("open");
}
function closeReportModal() {
  const modal = document.getElementById("tsReportModal");
  if (modal) modal.classList.remove("open");
}

async function handleReportSubmit() {
  const selected = document.querySelector(".ts-reason-chip.selected");
  if (!selected) { showToast("Please choose a reason.", "error"); return; }
  const reason = selected.dataset.reason;
  const description = document.getElementById("tsReportDesc").value.trim();
  const file = document.getElementById("tsUploadWrap")._file;

  const btn = document.getElementById("tsReportSubmit");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    await submitReport(_tsReportContext.type, _tsReportContext, reason, description, file);
    closeReportModal();
    showToast("Report submitted. Thanks for helping keep NeilNest safe.");
  } catch (err) {
    console.error("Report submit error:", err);
    showToast(err.message || "Couldn't submit report.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Report";
  }
}

/* ---------------------------------------------------------------------
   Blocked businesses — dual-write: a rich subcollection for the "Manage
   Blocked" list on Trust & Safety page, plus the users/{uid}.blockedUsers
   array (already used by messages.js's chat-blocking check) kept in sync
   so blocking a business here also blocks its owner in chat.
--------------------------------------------------------------------- */
async function blockBusiness(businessId, businessName, businessLogo) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to block a business.");

  const bizSnap = await db.collection(COLLECTIONS.businesses).doc(businessId).get();
  const ownerUid = bizSnap.exists ? bizSnap.data().ownerUid : null;

  const batch = db.batch();
  batch.set(db.collection(COLLECTIONS.users).doc(user.uid).collection("blockedBusinesses").doc(businessId), {
    businessId, businessName: businessName || (bizSnap.exists ? bizSnap.data().name : ""), businessLogo: businessLogo || (bizSnap.exists ? bizSnap.data().logoUrl : ""),
    ownerUid, blockedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  if (ownerUid) {
    batch.set(db.collection(COLLECTIONS.users).doc(user.uid), { blockedUsers: firebase.firestore.FieldValue.arrayUnion(ownerUid) }, { merge: true });
  }
  await batch.commit();
}

async function unblockBusiness(businessId, ownerUid) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in required.");
  const batch = db.batch();
  batch.delete(db.collection(COLLECTIONS.users).doc(user.uid).collection("blockedBusinesses").doc(businessId));
  if (ownerUid) {
    batch.set(db.collection(COLLECTIONS.users).doc(user.uid), { blockedUsers: firebase.firestore.FieldValue.arrayRemove(ownerUid) }, { merge: true });
  }
  await batch.commit();
}

async function listBlockedBusinesses(uid) {
  const snap = await db.collection(COLLECTIONS.users).doc(uid).collection("blockedBusinesses").orderBy("blockedAt", "desc").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ---------------------------------------------------------------------
   Moderation actions (admin-only per Firestore rules) — not wired to any
   UI yet since there's no admin panel. Every action writes an audit log
   entry, same pattern as approvePayment/rejectPayment in billing.js.
--------------------------------------------------------------------- */
async function logModerationAction(businessId, action, reason, previousStatus, newStatus) {
  const admin = auth.currentUser;
  await db.collection(COLLECTIONS.moderationLogs).add({
    adminUid: admin ? admin.uid : null, businessId, action, reason: reason || null,
    previousStatus: previousStatus || null, newStatus: newStatus || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function suspendBusiness(businessId, reason) {
  await db.collection(COLLECTIONS.businesses).doc(businessId).set({ suspended: true, underInvestigation: false }, { merge: true });
  await logModerationAction(businessId, "suspend", reason, null, "suspended");
  await notifyBusinessOwner(businessId, "Business Suspended", `Your business was suspended. Reason: ${reason || "Policy violation."}`);
}
async function restoreBusiness(businessId, reason) {
  await db.collection(COLLECTIONS.businesses).doc(businessId).set({ suspended: false, underInvestigation: false }, { merge: true });
  await logModerationAction(businessId, "restore", reason, "suspended", "active");
}
async function banBusiness(businessId, reason) {
  await db.collection(COLLECTIONS.businesses).doc(businessId).set({ banned: true, suspended: true, visibility: "hidden" }, { merge: true });
  await logModerationAction(businessId, "ban", reason, null, "banned");
  await notifyBusinessOwner(businessId, "Business Banned", `Your business was banned. Reason: ${reason || "Severe policy violation."}`);
}
async function awardTrustedSeller(businessId) {
  await db.collection(COLLECTIONS.businesses).doc(businessId).set({ trustedSeller: true }, { merge: true });
  await logModerationAction(businessId, "award_trusted_seller", null, null, "trusted_seller");
  await notifyBusinessOwner(businessId, "Trusted Seller Badge Awarded", "Congratulations — your business is now a NeilNest Trusted Seller.");
}
async function removeTrustedSeller(businessId, reason) {
  await db.collection(COLLECTIONS.businesses).doc(businessId).set({ trustedSeller: false }, { merge: true });
  await logModerationAction(businessId, "remove_trusted_seller", reason, "trusted_seller", null);
  await notifyBusinessOwner(businessId, "Trusted Seller Badge Removed", `Reason: ${reason || "Policy violation."}`);
}
async function warnBusiness(businessId, reason) {
  await logModerationAction(businessId, "warn", reason, null, null);
  await notifyBusinessOwner(businessId, "Warning from NeilNest", reason || "Please review our marketplace policies.");
}
async function resolveReport(collectionName, reportId) {
  await db.collection(collectionName).doc(reportId).update({ status: "resolved", resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });
}
async function dismissReport(collectionName, reportId) {
  await db.collection(collectionName).doc(reportId).update({ status: "dismissed", resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });
}
async function notifyBusinessOwner(businessId, title, body) {
  try {
    const bizSnap = await db.collection(COLLECTIONS.businesses).doc(businessId).get();
    if (!bizSnap.exists) return;
    await db.collection(COLLECTIONS.notifications).add({
      recipientUid: bizSnap.data().ownerUid, title, body, link: `business-profile.html?id=${businessId}`,
      read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) { console.error("notifyBusinessOwner error:", err); }
}

/* ---------------------------------------------------------------------
   User-level moderation — mirrors the business functions above, but acts
   directly on a users/{uid} doc. Sets the flag and logs/notifies for
   real. Does NOT stop the user from doing anything — that enforcement
   piece belongs in auth-guard.js (not among this project's uploaded
   files) or in per-collection write rules checking !banned, neither of
   which exists yet. Treat these as "mark the account," not "lock the
   account," until that's built.
--------------------------------------------------------------------- */
async function logUserModerationAction(uid, action, reason, newStatus) {
  const admin = auth.currentUser;
  await db.collection(COLLECTIONS.moderationLogs).add({
    adminUid: admin ? admin.uid : null, targetUid: uid, action, reason: reason || null,
    newStatus: newStatus || null, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
async function notifyUser(uid, title, body) {
  await db.collection(COLLECTIONS.notifications).add({
    recipientUid: uid, title, body, link: "profile.html", read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
async function suspendUser(uid, reason) {
  await db.collection(COLLECTIONS.users).doc(uid).set({ suspended: true }, { merge: true });
  await logUserModerationAction(uid, "suspend_user", reason, "suspended");
  await notifyUser(uid, "Account Suspended", `Reason: ${reason || "Policy violation."}`);
}
async function restoreUser(uid, reason) {
  await db.collection(COLLECTIONS.users).doc(uid).set({ suspended: false, banned: false }, { merge: true });
  await logUserModerationAction(uid, "restore_user", reason, "active");
}
async function banUser(uid, reason) {
  await db.collection(COLLECTIONS.users).doc(uid).set({ banned: true, suspended: true }, { merge: true });
  await logUserModerationAction(uid, "ban_user", reason, "banned");
  await notifyUser(uid, "Account Banned", `Reason: ${reason || "Severe policy violation."}`);
}
async function warnUser(uid, reason) {
  await logUserModerationAction(uid, "warn_user", reason, null);
  await notifyUser(uid, "Warning from NeilNest", reason || "Please review our marketplace policies.");
}
