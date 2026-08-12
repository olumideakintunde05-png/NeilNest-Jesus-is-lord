/* ==========================================================================
   business-profile.js
   URL: business-profile.html            → shows the signed-in user's own business
        business-profile.html?id=XYZ     → shows a specific business (public view)
   ========================================================================== */

let PROFILE = { business: null, businessId: null, isOwner: false, products: [], services: [], reviews: [], currentUser: null, contactAccess: false, contact: null };
let lightboxImages = [];
let lightboxIndex = 0;

function esc(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtNaira(n) { return "₦" + (Number(n) || 0).toLocaleString(); }
function fmtCount(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function ptoast(msg, type) {
  const host = document.getElementById("toast-host");
  const el = document.createElement("div");
  el.className = "toast";
  el.style.borderColor = type === "error" ? "rgba(225,75,75,0.4)" : "rgba(55,198,95,0.4)";
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .25s"; setTimeout(() => el.remove(), 250); }, 3000);
}

/* ---------------------------------------------------------------------
   Init
--------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  PROFILE.currentUser = await Promise.race([
    waitForAuthUser(),
    new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 8000))
  ]);

  if (PROFILE.currentUser === "TIMEOUT") {
    renderLoadErrorState({ message: "Taking too long to check your sign-in status. Check your connection and try again." });
    return;
  }
  if (!PROFILE.currentUser) {
    window.location.href = "signin.html?redirect=business-profile.html" + window.location.search;
    return;
  }

  const params = new URLSearchParams(window.location.search);
  let id = params.get("id");

  try {
    if (!id) {
      const snap = await db.collection(COLLECTIONS.businesses).where("ownerUid", "==", PROFILE.currentUser.uid).limit(1).get();
      if (snap.empty) {
        renderNoBusinessState();
        return;
      }
      id = snap.docs[0].id;
    }

    const bizSnap = await db.collection(COLLECTIONS.businesses).doc(id).get();
    if (!bizSnap.exists) { renderNotFoundState(); return; }

    PROFILE.businessId = id;
    PROFILE.business = bizSnap.data();
    PROFILE.isOwner = PROFILE.business.ownerUid === PROFILE.currentUser.uid;
    if (!PROFILE.isOwner) {
      const viewedKey = `neilnest_viewed_${id}`;
      if (!sessionStorage.getItem(viewedKey)) {
        trackAnalyticsEvent(id, "views");
        sessionStorage.setItem(viewedKey, "1");
      }
    }

    await Promise.all([loadProducts(), loadServices(), loadReviews(), loadProtectedContact()]);

    renderHeader();
    checkPendingClaimResume();
    renderQuickContact();
    renderStats();
    renderAboutPreview();
    renderOwnerActions();
    renderProductsTab();
    renderServicesTab();
    renderGalleryTab();
    renderReviewsTab();
    renderAboutTab();
    bindTabs();
    bindHeaderActions();
    bindModals();
    bindBell();

    document.getElementById("appShell").style.opacity = "1";
    document.getElementById("appShell").style.pointerEvents = "auto";

    registerView();
  } catch (err) {
    console.error("Profile load error:", err);
    renderLoadErrorState(err);
  }
});

function renderLoadErrorState(err) {
  document.getElementById("appShell").style.opacity = "1";
  document.getElementById("appShell").style.pointerEvents = "auto";
  document.getElementById("coverImg").style.display = "none";
  document.getElementById("profileMain").innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:65vh;padding:40px;text-align:center;">
      <div style="width:72px;height:72px;border-radius:50%;background:rgba(225,75,75,0.1);display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#e14b4b" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      </div>
      <h2 style="font-size:18px;font-weight:800;margin-bottom:8px;">Couldn't load this profile</h2>
      <p style="color:#a8a8a8;font-size:13px;margin-bottom:24px;">${esc((err && err.message) || "Something went wrong.")}</p>
      <button onclick="window.location.reload()" style="height:50px;padding:0 28px;border-radius:14px;background:linear-gradient(135deg,#f0bd5a,#d99a2b);color:#1a1200;font-weight:800;border:none;">Try Again</button>
    </div>`;
}

function renderNoBusinessState() {
  document.getElementById("appShell").style.opacity = "1";
  document.getElementById("appShell").style.pointerEvents = "auto";
  document.getElementById("coverImg").style.display = "none";
  document.getElementById("profileMain").innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:65vh;padding:40px;text-align:center;">
      <div style="width:72px;height:72px;border-radius:50%;background:rgba(224,168,60,0.1);display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#e0a83c" stroke-width="1.6"><path d="M4 21V7l8-4 8 4v14"/><path d="M9 21v-6h6v6"/></svg>
      </div>
      <h2 style="font-size:19px;font-weight:800;margin-bottom:8px;">You haven't added a business yet</h2>
      <p style="color:#a8a8a8;font-size:13px;margin-bottom:24px;">Create your business profile to start connecting with customers.</p>
      <a href="add-business.html" style="height:50px;padding:0 28px;border-radius:14px;background:linear-gradient(135deg,#f0bd5a,#d99a2b);color:#1a1200;font-weight:800;display:flex;align-items:center;">Add Your Business</a>
      <button id="noBizSignOutBtn" style="margin-top:16px;font-size:13px;font-weight:700;color:#a8a8a8;">Log Out</button>
    </div>`;
  document.getElementById("noBizSignOutBtn").addEventListener("click", () => auth.signOut().then(() => window.location.href = "signin.html"));
}
function renderNotFoundState() {
  document.getElementById("appShell").style.opacity = "1";
  document.getElementById("appShell").style.pointerEvents = "auto";
  document.getElementById("coverImg").style.display = "none";
  document.getElementById("profileMain").innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:65vh;padding:40px;text-align:center;">
      <h2 style="font-size:18px;font-weight:800;margin-bottom:8px;">Business not found</h2>
      <p style="color:#a8a8a8;font-size:13px;">This listing may have been removed.</p>
    </div>`;
}

/* ---------------------------------------------------------------------
   Data loading
--------------------------------------------------------------------- */
let productsUnsub = null;
function loadProducts() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    if (productsUnsub) productsUnsub();
    productsUnsub = db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).collection(COLLECTIONS.products)
      .orderBy("createdAt", "desc")
      .onSnapshot((snap) => {
        PROFILE.products = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => PROFILE.isOwner || !p.adminHidden);
        if (!resolved) { resolved = true; resolve(); return; }
        // Live update after initial load: re-render products + stats so a
        // newly published product (or edit/delete) appears without a refresh.
        renderProductsTab();
        renderStats();
      }, (err) => {
        console.error("Products listener error:", err);
        if (!resolved) { resolved = true; reject(err); }
      });
  });
}
async function loadServices() {
  const snap = await db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).collection(COLLECTIONS.services).orderBy("createdAt", "desc").get();
  PROFILE.services = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => PROFILE.isOwner || !s.adminHidden);
}
async function loadReviews() {
  const snap = await db.collection(COLLECTIONS.reviews).where("businessId", "==", PROFILE.businessId).limit(50).get();
  PROFILE.reviews = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const at = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
      const bt = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
      return bt - at;
    });
}

/* ---------------------------------------------------------------------
   Header
--------------------------------------------------------------------- */
function renderHeader() {
  const b = PROFILE.business;
  document.getElementById("coverImg").src = b.coverUrl || b.logoUrl || "";
  const logoInner = document.getElementById("logoInner");
  if (b.logoUrl) logoInner.innerHTML = `<img src="${b.logoUrl}" alt="">`;
  else logoInner.textContent = (b.name || "?").slice(0, 2).toUpperCase();

  document.getElementById("verifiedRingBadge").style.display = b.verified ? "flex" : "none";
  document.getElementById("verifiedChip").style.display = b.verified ? "inline-flex" : "none";
  document.getElementById("trustedChip").style.display = b.trustedSeller ? "inline-flex" : "none";
  const statusChip = document.getElementById("statusChip");
  if (b.suspended) { statusChip.textContent = "Suspended"; statusChip.style.display = "inline-flex"; statusChip.style.color = "#f3a89e"; statusChip.style.borderColor = "rgba(220,80,70,0.3)"; }
  else if (b.underInvestigation) { statusChip.textContent = "Under Investigation"; statusChip.style.display = "inline-flex"; statusChip.style.color = "#f0cf8e"; statusChip.style.borderColor = "rgba(224,168,60,0.3)"; }
  else { statusChip.style.display = "none"; }

  // Claimed/Unclaimed — a separate state from Verified. A claimed business
  // is not automatically verified, and vice versa.
  const claimChip = document.getElementById("claimChip");
  if (b.claimed === false) {
    claimChip.textContent = "Unclaimed";
    claimChip.style.display = "inline-flex";
    claimChip.style.background = "rgba(224,168,60,0.1)"; claimChip.style.borderColor = "rgba(224,168,60,0.3)"; claimChip.style.color = "#e0a83c";
  } else if (b.claimed === true) {
    claimChip.textContent = "Claimed";
    claimChip.style.display = "inline-flex";
    claimChip.style.background = "rgba(255,255,255,0.06)"; claimChip.style.borderColor = "rgba(255,255,255,0.14)"; claimChip.style.color = "#cfcfcf";
  } else {
    claimChip.style.display = "none"; // pre-existing businesses without the field — say nothing rather than guess
  }

  document.getElementById("bizName").textContent = b.name || "Untitled Business";
  document.getElementById("bizCategory").textContent = b.category || (b.businessType === "product" ? "Product Business" : "Service Business");
  document.getElementById("bizLocation").textContent = [b.location && b.location.city, b.location && b.location.state].filter(Boolean).join(", ") || "—";
  document.getElementById("bizFollowers").textContent = fmtCount(b.followersCount || 0) + " Followers";
  document.getElementById("bizRating").textContent = (b.ratingAvg ? b.ratingAvg.toFixed(1) : "0.0") + " ★";

  const cta = document.getElementById("headCtaRow");
  if (PROFILE.isOwner) {
  
  
  

   cta.innerHTML = `<div class="owner-cta-stack">
      <a href="add-business.html?businessId=${PROFILE.businessId}" class="btn-edit-profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>Edit Profile</a>
      <button id="ownerSignOutBtn" class="btn-owner-signout">Log Out</button>
    </div>`;
   
   
   
    document.getElementById("ownerSignOutBtn").addEventListener("click", () => auth.signOut().then(() => window.location.href = "signin.html"));
  } else if (b.claimed === false) {
    document.getElementById("moreMenuBtn").style.display = "flex";
    renderSafetyNotice("bizSafetyNotice");
    cta.innerHTML = `<button class="modal-submit-btn" id="claimBusinessBtn" style="width:100%;">Is this your business? Claim This Business</button>`;
    document.getElementById("claimBusinessBtn").addEventListener("click", openClaimFlow);
  } else {
    checkFollowState();
    document.getElementById("moreMenuBtn").style.display = "flex";
    renderSafetyNotice("bizSafetyNotice");
  }
}

async function checkFollowState() {
  const cta = document.getElementById("headCtaRow");
  let following = false;
  try {
    const fdoc = await db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).collection("followers").doc(PROFILE.currentUser.uid).get();
    following = fdoc.exists;
  } catch (e) { console.error(e); }
  cta.innerHTML = `
    <button class="btn-follow ${following ? "following" : ""}" id="followBtn">
      ${following ? "Following" : "Follow"}
    </button>
    <button class="btn-message" id="messageOwnerBtn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16v12H8l-4 4V4z"/></svg> Message
    </button>`;
  document.getElementById("followBtn").addEventListener("click", toggleFollow);
  document.getElementById("messageOwnerBtn").addEventListener("click", () => {
    window.location.href = `messages.html?to=${PROFILE.business.ownerUid}&business=${PROFILE.businessId}`;
  });
}

async function toggleFollow() {
  const btn = document.getElementById("followBtn");
  const ref = db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).collection("followers").doc(PROFILE.currentUser.uid);
  const bizRef = db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId);
  try {
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      await bizRef.update({ followersCount: firebase.firestore.FieldValue.increment(-1) });
      btn.textContent = "Follow"; btn.classList.remove("following");
      PROFILE.business.followersCount = (PROFILE.business.followersCount || 1) - 1;
    } else {
      await ref.set({ uid: PROFILE.currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      await bizRef.update({ followersCount: firebase.firestore.FieldValue.increment(1) });
      btn.textContent = "Following"; btn.classList.add("following");
      PROFILE.business.followersCount = (PROFILE.business.followersCount || 0) + 1;
    }
    document.getElementById("bizFollowers").textContent = fmtCount(PROFILE.business.followersCount || 0) + " Followers";
  } catch (err) { console.error(err); ptoast("Something went wrong.", "error"); }
}

/* ---------------------------------------------------------------------
   Contact gate — Free users don't get Call/WhatsApp/Email.
   This check is convenience only (decides what to render); the real
   enforcement is firestore.rules on businesses/{id}/private/contact,
   which denies the read server-side regardless of PROFILE.contactAccess.
--------------------------------------------------------------------- */
async function resolveContactAccess() {
  if (PROFILE.isOwner) return true;
  try {
    const extras = await getAccountExtras(PROFILE.currentUser.uid);
    return extras.planStatus === "active" && (extras.plan === "pro" || extras.plan === "business");
  } catch (err) {
    console.error("resolveContactAccess error:", err);
    return false;
  }
}

async function loadProtectedContact() {
  PROFILE.contactAccess = await resolveContactAccess();
  if (!PROFILE.contactAccess) { PROFILE.contact = null; return; }
  try {
    const snap = await db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).collection("private").doc("contact").get();
    PROFILE.contact = snap.exists ? snap.data() : { phone: "", whatsapp: "", email: "" };
  } catch (err) {
    // Rules denied it (or something else went wrong) — treat as locked
    // rather than throwing, so the rest of the page still loads.
    console.error("loadProtectedContact error:", err);
    PROFILE.contact = null;
    PROFILE.contactAccess = false;
  }
}

function openContactUpgradeModal() {
  document.getElementById("contactUpgradeModal").classList.add("open");
}

/* ---------------------------------------------------------------------
   Claim Business flow
--------------------------------------------------------------------- */
async function openClaimFlow() {
  if (!PROFILE.currentUser) {
    // Not signed in — send to the existing sign-in flow. No second auth
    // system: this just remembers which business to come back to.
    sessionStorage.setItem("nn_pending_claim", PROFILE.businessId);
    window.location.href = "signin.html";
    return;
  }
  await showClaimModal();
}

async function showClaimModal() {
  const modal = document.getElementById("claimModal");
  const body = document.getElementById("claimModalBody");
  body.innerHTML = `<div style="text-align:center;padding:10px 0;color:#7a7a7a;font-size:13px;">Checking claim status…</div>`;
  modal.classList.add("open");

  try {
    const existing = await db.collection("businessClaims")
      .where("businessId", "==", PROFILE.businessId)
      .where("claimantUid", "==", PROFILE.currentUser.uid)
      .orderBy("submittedAt", "desc")
      .limit(1)
      .get();

    if (!existing.empty) {
      const claim = existing.docs[0].data();
      if (claim.status === "pending") {
        body.innerHTML = `<div style="text-align:center;padding:10px 0;color:#cfcfcf;font-size:13px;line-height:1.6;">Claim request submitted.<br>Your request is waiting for admin verification.</div>`;
        return;
      }
      if (claim.status === "rejected") {
        body.innerHTML = `
          <div style="text-align:center;padding:10px 0 16px;color:#f3a89e;font-size:13px;line-height:1.6;">Your claim request was rejected.${claim.rejectionReason ? `<br><span style="color:#a8a8a8;">"${esc(claim.rejectionReason)}"</span>` : ""}</div>
          <button class="modal-submit-btn" id="submitClaimBtn2" style="width:100%;">Submit a New Claim</button>`;
        document.getElementById("submitClaimBtn2").addEventListener("click", submitClaim);
        return;
      }
      // approved — shouldn't normally reach here since the business would
      // already show as claimed, but handle gracefully just in case.
      body.innerHTML = `<div style="text-align:center;padding:10px 0;color:#37c65f;font-size:13px;">This business has already been claimed.</div>`;
      return;
    }

    body.innerHTML = `<button class="modal-submit-btn" id="submitClaimBtn2" style="width:100%;">Claim This Business</button>`;
    document.getElementById("submitClaimBtn2").addEventListener("click", submitClaim);
  } catch (err) {
    console.error("showClaimModal error:", err);
    body.innerHTML = `<div style="text-align:center;padding:10px 0;color:#f3a89e;font-size:13px;">Couldn't check claim status. Try again.</div>`;
  }
}

async function submitClaim() {
  const body = document.getElementById("claimModalBody");
  body.innerHTML = `<div style="text-align:center;padding:10px 0;color:#7a7a7a;font-size:13px;">Submitting…</div>`;
  try {
    await db.collection("businessClaims").add({
      businessId: PROFILE.businessId,
      claimantUid: PROFILE.currentUser.uid,
      claimantName: PROFILE.currentUser.displayName || PROFILE.currentUser.email || "",
      claimantEmail: PROFILE.currentUser.email || "",
      status: "pending",
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    body.innerHTML = `<div style="text-align:center;padding:10px 0;color:#cfcfcf;font-size:13px;line-height:1.6;">Claim request submitted.<br>Your request is waiting for admin verification.</div>`;
  } catch (err) {
    console.error("submitClaim error:", err);
    body.innerHTML = `<div style="text-align:center;padding:10px 0;color:#f3a89e;font-size:13px;">Couldn't submit your claim. Try again.</div>`;
  }
}

// Resume flow: if the user was sent to sign in from a claim attempt and
// has now landed back on this exact business (e.g. via browser back, or
// once signin.html is wired to redirect here), pick the claim flow back
// up automatically instead of making them find the button again.
function checkPendingClaimResume() {
  const pending = sessionStorage.getItem("nn_pending_claim");
  if (pending && pending === PROFILE.businessId && PROFILE.currentUser) {
    sessionStorage.removeItem("nn_pending_claim");
    showClaimModal();
  }
}

/* ---------------------------------------------------------------------
   Quick contact
--------------------------------------------------------------------- */
function renderQuickContact() {
  const b = PROFILE.business;
  const channels = b.contactChannels || {};
  const locked = !PROFILE.contactAccess;
  const contact = PROFILE.contact || {};
  const items = [];

  if (channels.whatsapp) items.push({
    label: "WhatsApp", locked, icon: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20l1-5.4A8.5 8.5 0 1 1 21 11.5z"/>',
    action: locked ? openContactUpgradeModal : () => { if (!PROFILE.isOwner) trackAnalyticsEvent(PROFILE.businessId, "whatsappClicks"); window.open(`https://wa.me/${(contact.whatsapp || "").replace(/[^0-9]/g, "")}`, "_blank"); }
  });
  if (channels.phone) items.push({
    label: "Call", locked, icon: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.4 2.1L8.1 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.9 2.2z"/>',
    action: locked ? openContactUpgradeModal : () => { if (!PROFILE.isOwner) trackAnalyticsEvent(PROFILE.businessId, "callClicks"); window.location.href = `tel:${contact.phone || ""}`; }
  });
  if (channels.email) items.push({
    label: "Email", locked, icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    action: locked ? openContactUpgradeModal : () => window.location.href = `mailto:${contact.email || ""}`
  });
  if (b.website) items.push({
  label: "Website",
  locked,
  icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  action: locked
    ? openContactUpgradeModal
    : () => {
        if (!PROFILE.isOwner) {
          trackAnalyticsEvent(PROFILE.businessId, "websiteClicks");
        }
        window.open(
          b.website.startsWith("http") ? b.website : "https://" + b.website,
          "_blank"
        );
      }
});
  if (b.mapsLink) items.push({ label: "Directions", icon: '<path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/>', action: () => window.open(b.mapsLink, "_blank") });

  // Social links — only ever populated if the owner is on Pro/Business
  // (enforced when the profile is edited, not here — this just renders
  // whatever's on the doc).
  const social = b.socials || {};
  const socialPlatforms = [
    { key: "instagram", label: "Instagram", icon: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/>', base: "https://instagram.com/" },
    { key: "facebook", label: "Facebook", icon: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>', base: "https://facebook.com/" },
    { key: "tiktok", label: "TikTok", icon: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>', base: "https://tiktok.com/@" },
    { key: "linkedin", label: "LinkedIn", icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 11v5M8 8v.01M12 16v-3a2 2 0 0 1 4 0v3"/>', base: "https://linkedin.com/in/" },
    { key: "x", label: "X", icon: '<path d="M4 4l16 16M20 4L4 20"/>', base: "https://x.com/" },
    { key: "youtube", label: "YouTube", icon: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>', base: "https://youtube.com/@" }
  ];
  socialPlatforms.forEach((p) => {
    const handle = social[p.key];
    if (handle) items.push({ label: p.label, icon: p.icon, action: () => window.open(handle.startsWith("http") ? handle : p.base + handle.replace(/^@/, ""), "_blank") });
  });

  items.push({ label: "Share", icon: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6l6.8-3.8M8.6 13.4l6.8 3.8"/>', action: shareProfile });

  const wrap = document.getElementById("quickContact");
  wrap.innerHTML = items.map((it, i) => `
    <button class="qc-btn${it.locked ? " locked" : ""}" data-qc="${i}"><span class="qc-btn__circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${it.icon}</svg></span><span class="label">${it.locked ? "🔒 " : ""}${it.label}</span></button>
  `).join("");
  wrap.querySelectorAll("[data-qc]").forEach((btn, i) => btn.addEventListener("click", items[i].action));
}

function shareProfile() {
  const url = window.location.origin + window.location.pathname + "?id=" + PROFILE.businessId;
  if (navigator.share) {
    navigator.share({ title: PROFILE.business.name, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => ptoast("Link copied to clipboard."));
  }
}

/* ---------------------------------------------------------------------
   Stats
--------------------------------------------------------------------- */
function renderStats() {
  const b = PROFILE.business;
  const stats = [
    { num: PROFILE.products.length, lbl: "Products" },
    { num: PROFILE.services.length, lbl: "Services" },
    { num: fmtCount(b.viewsCount || 0), lbl: "Views" },
    { num: fmtCount(b.followersCount || 0), lbl: "Followers" },
    { num: (b.ratingAvg ? b.ratingAvg.toFixed(1) : "0.0"), lbl: "Rating" },
    { num: fmtCount(b.completedDeals || 0), lbl: "Deals" }
  ];
  document.getElementById("statsGrid").innerHTML = stats.map(s => `<div class="stat-card"><div class="num">${s.num}</div><div class="lbl">${s.lbl}</div></div>`).join("");
}

/* ---------------------------------------------------------------------
   About preview + owner actions
--------------------------------------------------------------------- */
function renderAboutPreview() {
  const desc = PROFILE.business.description || "This business hasn't added a description yet.";
  document.getElementById("aboutPreviewText").textContent = desc.length > 120 ? desc.slice(0, 120) + "…" : desc;
  document.getElementById("readMoreBtn").addEventListener("click", (e) => {
    e.preventDefault();
    switchTab("about");
    document.querySelector(".tabs-sticky").scrollIntoView({ behavior: "smooth" });
  });
}

function renderOwnerActions() {
  if (!PROFILE.isOwner) return;
  document.getElementById("ownerActions").style.display = "block";
  document.getElementById("settingsTabBtn").style.display = "flex";
  initAppearanceSettings();
  document.getElementById("fabAdd").style.display = "flex";
  document.querySelector('.owner-actions-grid a[href="add-business.html"]').href = `add-business.html?businessId=${PROFILE.businessId}`;
  document.querySelector('[data-scroll-tab="products"]').addEventListener("click", (e) => {
    e.preventDefault();
    switchTab(PROFILE.business.businessType === "product" ? "products" : "services");
    document.querySelector(".tabs-sticky").scrollIntoView({ behavior: "smooth" });
  });
  document.getElementById("analyticsCard").addEventListener("click", async () => {
    const extras = await getAccountExtras(PROFILE.currentUser.uid);
    if (PLAN_RANK[extras.plan] < PLAN_RANK.pro) {
      ptoast("Analytics is a Pro/Business feature.", "error");
      setTimeout(() => { window.location.href = "upgrade.html"; }, 700);
      return;
    }
    window.location.href = `analytics.html?businessId=${PROFILE.businessId}`;
  });
  document.getElementById("upgradeCard").addEventListener("click", () => { window.location.href = "upgrade.html"; });
  document.getElementById("learningHubCard").addEventListener("click", async () => {
    const extras = await getAccountExtras(PROFILE.currentUser.uid);
    if (!(PLAN_CATALOG[extras.plan] || PLAN_CATALOG.free).learningHub) {
      ptoast("Business Learning Hub is a Pro/Business feature.", "error");
      setTimeout(() => { window.location.href = "upgrade.html"; }, 700);
      return;
    }
    window.location.href = "learning.html";
  });
  document.getElementById("fastSupportCard").addEventListener("click", async () => {
    const extras = await getAccountExtras(PROFILE.currentUser.uid);
    if (PLAN_RANK[extras.plan] < PLAN_RANK.pro) {
      ptoast("Fast Support is a Pro/Business feature.", "error");
      setTimeout(() => { window.location.href = "upgrade.html"; }, 700);
      return;
    }
    document.getElementById("supportEmailBtn").href = `mailto:${SUPPORT_CONTACT.email}?subject=${encodeURIComponent("NeilNest Support — " + (PROFILE.business.name || "My Business"))}`;
    document.getElementById("supportWhatsappBtn").href = `https://wa.me/${SUPPORT_CONTACT.whatsapp}`;
    document.getElementById("fastSupportModal").classList.add("open");
  });
  document.getElementById("closeFastSupportModal").addEventListener("click", () => document.getElementById("fastSupportModal").classList.remove("open"));

  document.getElementById("moreMenuBtn").addEventListener("click", () => document.getElementById("moreMenuPanel").style.display = document.getElementById("moreMenuPanel").style.display === "block" ? "none" : "block");
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("moreMenuPanel");
    if (panel.style.display === "block" && !panel.contains(e.target) && e.target.id !== "moreMenuBtn") panel.style.display = "none";
  });
  document.getElementById("reportBusinessBtn").addEventListener("click", () => {
    document.getElementById("moreMenuPanel").style.display = "none";
    openReportModal({ type: "business", targetId: PROFILE.businessId, targetName: PROFILE.business.name, businessId: PROFILE.businessId });
  });

  loadAccountExtras();
  document.getElementById("fabAdd").addEventListener("click", () => { window.location.href = `add-business.html?businessId=${PROFILE.businessId}&jumpToStep=2`; });
}

/* ---------------------------------------------------------------------
   Upgrade Plan + Business Learning Hub badges
   Reads users/{uid} (see getAccountExtras in firebase-init.js) plus a
   cheap "any new lessons?" check, then renders the corner badge for each
   Quick Actions card. Never blocks the rest of the page — badges just
   stay hidden if a read fails.
--------------------------------------------------------------------- */
let accountExtrasUnsub = null;
async function loadAccountExtras() {
  try {
    if (accountExtrasUnsub) accountExtrasUnsub();
    accountExtrasUnsub = listenToAccountExtras(PROFILE.currentUser.uid, (extras) => {
      renderPlanBadge(extras);
      renderLearningBadge(extras);
      renderSupportBadge(extras);
    });
  } catch (err) {
    console.error("loadAccountExtras error:", err);
  }
}

function daysUntil(timestamp) {
  if (!timestamp) return null;
  const ms = (timestamp.toDate ? timestamp.toDate() : new Date(timestamp)) - new Date();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function setBadge(el, text, cls) {
  el.textContent = text;
  el.className = "card-badge " + cls;
  el.style.display = "inline-block";
}

function renderPlanBadge(extras) {
  const badge = document.getElementById("upgradeBadge");
  const hint = document.getElementById("upgradeHint");
  const remaining = daysUntil(extras.planExpiresAt);

  if (extras.planStatus === "expired") {
    setBadge(badge, "Subscription Expired", "card-badge--red");
  } else if (extras.planStatus === "active" && remaining !== null && remaining <= 7 && remaining >= 0) {
    setBadge(badge, "Renew Soon", "card-badge--amber");
  } else if (extras.plan === "business") {
    setBadge(badge, "Business", "card-badge--premium");
  } else if (extras.plan === "pro") {
    setBadge(badge, "Pro", "card-badge--gold");
  } else if (extras.hasEverSubscribed) {
    setBadge(badge, "Free Plan", "card-badge--gray");
  } else {
    hint.textContent = "Upgrade to unlock premium features.";
    hint.style.display = "block";
  }
}

function renderSupportBadge(extras) {
  const badge = document.getElementById("supportBadge");
  const hint = document.getElementById("supportHint");
  if (PLAN_RANK[extras.plan] < PLAN_RANK.pro) {
    setBadge(badge, "Pro Feature", "card-badge--gray");
    hint.style.display = "none";
  } else {
    badge.style.display = "none";
    hint.style.display = "block";
  }
}

async function renderLearningBadge(extras) {
  const badge = document.getElementById("learningBadge");
  const hint = document.getElementById("learningHint");
  const stats = extras.learningStats;

  if (!(PLAN_CATALOG[extras.plan] || PLAN_CATALOG.free).learningHub) {
    setBadge(badge, "Pro Feature", "card-badge--gray");
    return;
  }

  const isNew = await hasNewLessonsSince(extras.lastLearningHubVisitAt);
  if (isNew) {
    setBadge(badge, "New", "card-badge--gold");
  } else if (stats.hasUnfinishedLesson) {
    setBadge(badge, "Continue Learning", "card-badge--amber");
  } else if (stats.completedLessons > 0 && stats.totalLessons > 0 && stats.completedLessons >= stats.totalLessons) {
    setBadge(badge, "Completed", "card-badge--gold");
  } else {
    hint.style.display = "block";
  }
}

/* ---------------------------------------------------------------------
   Tabs
--------------------------------------------------------------------- */
function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
}
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === tab));
  document.getElementById("fabAdd").style.display = (PROFILE.isOwner && (tab === "products" || tab === "services")) ? "flex" : "none";
}

/* ---------------------------------------------------------------------
   Appearance (theme) settings — owner-only, drives the site-wide theme
   via the shared window.NNTheme API from theme.js. This is the ONLY
   place a theme control should exist; every other page just reads the
   global state theme.js already applies on load.
--------------------------------------------------------------------- */
function initAppearanceSettings() {
  const wrap = document.getElementById("appearanceOptions");
  if (!wrap || wrap.dataset.wired) return;
  wrap.dataset.wired = "1";

  function paint() {
    const current = window.NNTheme ? window.NNTheme.get() : "system";
    wrap.querySelectorAll(".appearance-option").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.themeOption === current);
    });
  }

  wrap.querySelectorAll(".appearance-option").forEach(btn => {
    btn.addEventListener("click", () => {
      if (window.NNTheme) window.NNTheme.set(btn.dataset.themeOption);
      paint();
    });
  });

  paint();
}

/* ---------------------------------------------------------------------
   Products / Services tabs
--------------------------------------------------------------------- */
function renderProductsTab() {
  const panel = document.getElementById("panelProducts");
  const visible = PROFILE.products.filter(p => PROFILE.isOwner || !p.hidden);
  if (visible.length === 0) { panel.innerHTML = '<div class="tab-empty">No products listed yet.</div>'; return; }
  panel.innerHTML = visible.map(p => listingCardHtml(p, "product")).join("");
  wireListingCards(panel, "product");
}
function renderServicesTab() {
  const panel = document.getElementById("panelServices");
  const visible = PROFILE.services.filter(s => PROFILE.isOwner || !s.hidden);
  if (visible.length === 0) { panel.innerHTML = '<div class="tab-empty">No services listed yet.</div>'; return; }
  panel.innerHTML = visible.map(s => listingCardHtml(s, "service")).join("");
  wireListingCards(panel, "service");
}

function listingCardHtml(item, kind) {
  const img = (item.images && item.images[0]) || "";
  const price = kind === "product" ? fmtNaira(item.price) : "From " + fmtNaira(item.startingPrice);
  const cat = kind === "product" ? item.category : item.pricingType;
  return `
    <div class="listing-card" data-id="${item.id}" data-kind="${kind}">
      ${item.hidden ? '<span class="hidden-tag">Hidden</span>' : ""}
      ${!PROFILE.isOwner ? `<button class="bookmark-fab" data-action="bookmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg></button>` : ""}
      <div class="listing-card__img">${img ? `<img src="${img}" alt="">` : ""}</div>
      <div class="listing-card__body">
        <div class="listing-card__top">
          <div class="listing-card__name">${esc(item.name)}</div>
          <div class="listing-card__price">${price}</div>
        </div>
        <div class="listing-card__cat">${esc(cat || "")}</div>
        <div class="listing-card__desc">${esc(item.description || "")}</div>
        <div class="listing-card__actions">
          <button data-action="view" class="${kind === "product" ? "btn-view-details" : "btn-book"}">${kind === "product" ? "View Details" : "Book"}</button>
          ${kind === "service" && !PROFILE.isOwner ? '<button data-action="message" class="btn-message-sm">Message</button>' : ""}
        </div>
        ${PROFILE.isOwner ? `
        <div class="owner-row">
          <button data-action="edit">Edit</button>
          <button data-action="hide">${item.hidden ? "Unhide" : "Hide"}</button>
          <button data-action="delete" class="danger">Delete</button>
        </div>` : ""}
      </div>
    </div>`;
}

function wireListingCards(panel, kind) {
  panel.querySelectorAll(".listing-card").forEach(card => {
    const id = card.dataset.id;
    const list = kind === "product" ? PROFILE.products : PROFILE.services;
    const item = list.find(x => x.id === id);

    const viewBtn = card.querySelector('[data-action="view"]');
    if (viewBtn) viewBtn.addEventListener("click", () => openQuickView(item, kind));

    const msgBtn = card.querySelector('[data-action="message"]');
    if (msgBtn) msgBtn.addEventListener("click", () => { window.location.href = `messages.html?to=${PROFILE.business.ownerUid}&business=${PROFILE.businessId}${kind === "product" ? "&product=" + item.id : ""}`; });

    const bookmarkBtn = card.querySelector('[data-action="bookmark"]');
    if (bookmarkBtn) bookmarkBtn.addEventListener("click", () => toggleBookmark(item, kind, bookmarkBtn));

    const editBtn = card.querySelector('[data-action="edit"]');
    if (editBtn) editBtn.addEventListener("click", () => {
      window.location.href = `add-business.html?businessId=${PROFILE.businessId}&editItem=${kind}:${item.id}`;
    });

    const hideBtn = card.querySelector('[data-action="hide"]');
    if (hideBtn) hideBtn.addEventListener("click", () => toggleHideListing(item, kind));

    const delBtn = card.querySelector('[data-action="delete"]');
    if (delBtn) delBtn.addEventListener("click", () => deleteListing(item, kind));
  });
}

function openQuickView(item, kind) {
  if (kind === "product" && !PROFILE.isOwner) {
    db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).collection(COLLECTIONS.products).doc(item.id)
      .set({ viewsCount: firebase.firestore.FieldValue.increment(1) }, { merge: true }).catch((err) => console.error("product view tracking error:", err));
  }
  const modal = document.getElementById("quickViewModal");
  const body = document.getElementById("quickViewBody");
  const img = (item.images && item.images[0]) || "";
  const price = kind === "product" ? fmtNaira(item.price) : "From " + fmtNaira(item.startingPrice) + " · " + esc(item.pricingType || "");
  body.innerHTML = `
    <button class="modal-close" id="closeQuickView"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    ${img ? `<img src="${img}" style="width:100%;border-radius:14px;margin-bottom:14px;aspect-ratio:16/10;object-fit:cover;">` : ""}
    <h3>${esc(item.name)}</h3>
    <div style="color:#e0a83c;font-weight:800;font-size:16px;margin:6px 0 12px;">${price}</div>
    <p style="font-size:13px;color:#cfcfcf;line-height:1.6;">${esc(item.description || "No description provided.")}</p>
    ${kind === "product" ? `<p style="font-size:12px;color:#8a8a8a;margin-top:10px;">Stock: ${esc(item.stockStatus || "—")} ${item.negotiable ? "· Negotiable" : ""}</p>` : ""}
    ${!PROFILE.isOwner ? `<button class="modal-submit-btn" style="margin-top:18px;" id="qvMessageBtn">${kind === "product" ? "Message Seller" : "Book Now"}</button>` : ""}
    ${(!PROFILE.isOwner && kind === "product") ? `<button style="width:100%;margin-top:10px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);color:#a8a8a8;font-size:12.5px;font-weight:600;" id="qvReportBtn">Report Product</button>` : ""}
  `;
  document.getElementById("closeQuickView").addEventListener("click", () => modal.classList.remove("open"));
  const qvBtn = document.getElementById("qvMessageBtn");
  if (qvBtn) qvBtn.addEventListener("click", () => { window.location.href = `messages.html?to=${PROFILE.business.ownerUid}&business=${PROFILE.businessId}${kind === "product" ? "&product=" + item.id : ""}`; });
  const qvReportBtn = document.getElementById("qvReportBtn");
  if (qvReportBtn) qvReportBtn.addEventListener("click", () => openReportModal({ type: "product", targetId: item.id, targetName: item.name, businessId: PROFILE.businessId }));
  modal.classList.add("open");
}

async function toggleBookmark(item, kind, btn) {
  const favId = `${PROFILE.currentUser.uid}_${PROFILE.businessId}_${item.id}`;
  const ref = db.collection(COLLECTIONS.favorites).doc(favId);
  try {
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      btn.style.opacity = "0.6";
      ptoast("Removed from saved.");
    } else {
      await ref.set({ uid: PROFILE.currentUser.uid, businessId: PROFILE.businessId, itemId: item.id, type: kind, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      btn.style.opacity = "1";
      ptoast("Saved.");
    }
  } catch (err) { console.error(err); ptoast("Something went wrong.", "error"); }
}

async function toggleHideListing(item, kind) {
  const coll = kind === "product" ? COLLECTIONS.products : COLLECTIONS.services;
  try {
    await db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).collection(coll).doc(item.id).update({ hidden: !item.hidden });
    item.hidden = !item.hidden;
    kind === "product" ? renderProductsTab() : renderServicesTab();
    ptoast(item.hidden ? "Listing hidden." : "Listing visible again.");
  } catch (err) { console.error(err); ptoast("Something went wrong.", "error"); }
}

async function deleteListing(item, kind) {
  if (!confirm(`Delete "${item.name}"? This can't be undone.`)) return;
  const coll = kind === "product" ? COLLECTIONS.products : COLLECTIONS.services;
  try {
    await db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).collection(coll).doc(item.id).delete();
    if (kind === "product") { PROFILE.products = PROFILE.products.filter(p => p.id !== item.id); renderProductsTab(); }
    else { PROFILE.services = PROFILE.services.filter(s => s.id !== item.id); renderServicesTab(); }
    renderStats();
    ptoast("Listing deleted.");
  } catch (err) { console.error(err); ptoast("Something went wrong.", "error"); }
}

/* ---------------------------------------------------------------------
   Gallery tab
--------------------------------------------------------------------- */
function renderGalleryTab() {
  const panel = document.getElementById("panelGallery");
  const images = [];
  if (PROFILE.business.coverUrl) images.push(PROFILE.business.coverUrl);
  PROFILE.products.forEach(p => (p.images || []).forEach(i => images.push(i)));
  PROFILE.services.forEach(s => (s.images || []).forEach(i => images.push(i)));
  lightboxImages = images;

  if (images.length === 0) { panel.innerHTML = '<div class="tab-empty">No photos yet.</div>'; return; }
  panel.innerHTML = `<div class="gallery-grid">${images.map((src, i) => `<img src="${src}" data-idx="${i}" oncontextmenu="return false;">`).join("")}</div>`;
  panel.querySelectorAll("img").forEach(img => img.addEventListener("click", () => openLightbox(parseInt(img.dataset.idx, 10))));
}

function openLightbox(idx) {
  lightboxIndex = idx;
  document.getElementById("lightboxImg").src = lightboxImages[idx];
  document.getElementById("lightbox").classList.add("open");
}
function bindLightbox() {
  document.getElementById("lightboxClose").addEventListener("click", () => document.getElementById("lightbox").classList.remove("open"));
  document.getElementById("lightboxPrev").addEventListener("click", () => { lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length; document.getElementById("lightboxImg").src = lightboxImages[lightboxIndex]; });
  document.getElementById("lightboxNext").addEventListener("click", () => { lightboxIndex = (lightboxIndex + 1) % lightboxImages.length; document.getElementById("lightboxImg").src = lightboxImages[lightboxIndex]; });

  let touchStartX = 0;
  const lb = document.getElementById("lightbox");
  lb.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; });
  lb.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) { dx > 0 ? document.getElementById("lightboxPrev").click() : document.getElementById("lightboxNext").click(); }
  });
}

/* ---------------------------------------------------------------------
   Reviews tab
--------------------------------------------------------------------- */
function renderReviewsTab() {
  const panel = document.getElementById("panelReviews");
  const reviews = PROFILE.reviews;
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const breakdown = [5, 4, 3, 2, 1].map(star => reviews.filter(r => r.rating === star).length);

  const hasReviewed = reviews.some(r => r.uid === PROFILE.currentUser.uid);
  const writeReviewBtn = (!PROFILE.isOwner && !hasReviewed)
    ? `<button class="btn-write-review" id="openReviewModalBtn">✍️ Write Review</button>` : "";

  panel.innerHTML = `
    <div class="rating-summary">
      <div class="rating-big">
        <div class="num">${avg.toFixed(1)}</div>
        <div class="stars">${"★".repeat(Math.round(avg))}${"☆".repeat(5 - Math.round(avg))}</div>
        <div class="count">${reviews.length} reviews</div>
      </div>
      <div class="rating-bars">
        ${[5, 4, 3, 2, 1].map((star, i) => `
          <div class="rating-bar-row">
            <span>${star}★</span>
            <div class="rating-bar-track"><div class="rating-bar-fill" style="width:${reviews.length ? (breakdown[i] / reviews.length * 100) : 0}%"></div></div>
            <span>${breakdown[i]}</span>
          </div>`).join("")}
      </div>
    </div>
    ${writeReviewBtn}
    <div id="reviewsList">${reviews.length === 0 ? '<div class="tab-empty">No reviews yet.</div>' : reviews.map(reviewCardHtml).join("")}</div>
  `;

  const openBtn = document.getElementById("openReviewModalBtn");
  if (openBtn) openBtn.addEventListener("click", openReviewModal);

  panel.querySelectorAll("[data-helpful]").forEach(btn => btn.addEventListener("click", () => markHelpful(btn.dataset.helpful, btn)));
  panel.querySelectorAll("[data-report]").forEach(btn => btn.addEventListener("click", () => ptoast("Reported. Our team will review this.")));
}

function reviewCardHtml(r) {
  const date = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "";
  return `
    <div class="review-card">
      <div class="review-head">
        <div class="review-avatar">${r.authorPhoto ? `<img src="${r.authorPhoto}">` : esc((r.authorName || "?").slice(0, 2).toUpperCase())}</div>
        <div>
          <div class="review-name">${esc(r.authorName || "Anonymous")}</div>
          <div class="review-stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</div>
        </div>
        <span class="review-date">${date}</span>
      </div>
      <div class="review-text">${esc(r.text || "")}</div>
      ${r.photos && r.photos.length ? `<div class="review-photos">${r.photos.map(p => `<img src="${p}">`).join("")}</div>` : ""}
      <div class="review-actions">
        <button data-helpful="${r.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 22V11M2 13v7a2 2 0 0 0 2 2h12.5a2 2 0 0 0 2-1.6l1.4-7A2 2 0 0 0 18 11h-5V5a2 2 0 0 0-4 0v2L7 11"/></svg> Helpful ${r.helpfulCount ? "(" + r.helpfulCount + ")" : ""}</button>
        <button data-report="${r.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg> Report</button>
      </div>
    </div>`;
}

async function markHelpful(reviewId, btn) {
  try {
    await db.collection(COLLECTIONS.reviews).doc(reviewId).update({ helpfulCount: firebase.firestore.FieldValue.increment(1) });
    btn.disabled = true;
    ptoast("Thanks for the feedback.");
  } catch (err) { console.error(err); }
}

let selectedStars = 0;
function openReviewModal() {
  const modal = document.getElementById("reviewModal");
  const starWrap = document.getElementById("starInput");
  selectedStars = 0;
  starWrap.innerHTML = [1, 2, 3, 4, 5].map(n => `<svg data-star="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l3 6 6.5 1-4.7 4.6L18 20l-6-3.4L6 20l1.2-6.4L2.5 9l6.5-1 3-6z"/></svg>`).join("");
  starWrap.querySelectorAll("svg").forEach(svg => svg.addEventListener("click", () => {
    selectedStars = parseInt(svg.dataset.star, 10);
    starWrap.querySelectorAll("svg").forEach(s => s.classList.toggle("filled", parseInt(s.dataset.star, 10) <= selectedStars));
  }));
  document.getElementById("reviewText").value = "";
  modal.classList.add("open");
}

async function submitReview() {
  const text = document.getElementById("reviewText").value.trim();
  if (selectedStars === 0) { ptoast("Please select a star rating.", "error"); return; }
  if (!text) { ptoast("Please write a short review.", "error"); return; }

  const btn = document.getElementById("submitReviewBtn");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    await db.collection(COLLECTIONS.reviews).add({
      businessId: PROFILE.businessId,
      uid: PROFILE.currentUser.uid,
      authorName: PROFILE.currentUser.displayName || "NeilNest User",
      authorPhoto: PROFILE.currentUser.photoURL || "",
      rating: selectedStars,
      text,
      photos: [],
      helpfulCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Recompute business rating aggregate
    const allSnap = await db.collection(COLLECTIONS.reviews).where("businessId", "==", PROFILE.businessId).get();
    const ratings = allSnap.docs.map(d => d.data().rating);
    const avg = ratings.reduce((a, b2) => a + b2, 0) / ratings.length;
    await db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).update({ ratingAvg: avg, ratingCount: ratings.length });

    ptoast("Review submitted. Thank you!");
    document.getElementById("reviewModal").classList.remove("open");
    await loadReviews();
    PROFILE.business.ratingAvg = avg;
    renderReviewsTab();
    renderStats();
    document.getElementById("bizRating").textContent = avg.toFixed(1) + " ★";
  } catch (err) {
    console.error(err);
    ptoast("Couldn't submit your review.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Review";
  }
}

/* ---------------------------------------------------------------------
   About tab
--------------------------------------------------------------------- */
function renderAboutTab() {
  const b = PROFILE.business;
  const panel = document.getElementById("panelAbout");
  const joined = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().toLocaleDateString([], { month: "long", year: "numeric" }) : "—";
  const socials = Object.entries(b.socials || {}).filter(([, v]) => v);
  const channels = b.contactChannels || {};
  const contactLocked = !PROFILE.contactAccess;
  const contact = PROFILE.contact || {};

  panel.innerHTML = `
    <p style="font-size:13.5px;color:#cfcfcf;line-height:1.7;margin-bottom:6px;">${esc(b.description || "No description provided.")}</p>

    ${channels.phone ? (contactLocked ? lockedAboutRow("Phone", '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.4 2.1L8.1 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.9 2.2z"/>') : aboutRow("Phone", contact.phone, '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.4 2.1L8.1 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.9 2.2z"/>')) : ""}
    ${channels.whatsapp ? (contactLocked ? lockedAboutRow("WhatsApp", '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20l1-5.4A8.5 8.5 0 1 1 21 11.5z"/>') : aboutRow("WhatsApp", contact.whatsapp, '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20l1-5.4A8.5 8.5 0 1 1 21 11.5z"/>')) : ""}
    ${channels.email ? (contactLocked ? lockedAboutRow("Email", '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>') : aboutRow("Email", contact.email, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>')) : ""}
    ${b.website ? aboutRow("Website", b.website, '<circle cx="12" cy="12" r="9"/>') : ""}
    ${b.address ? aboutRow("Address", b.address, '<path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/>') : ""}
    ${b.hours ? aboutRow("Business Hours", b.hours, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>') : ""}
    ${aboutRow("Owner", b.ownerName || "NeilNest Business Owner", '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>')}
    ${aboutRow("Date Joined", joined, '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>')}
    ${aboutRow("Verification Status", b.verified ? "Verified ✅" : "Pending Verification", '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/>')}

    ${socials.length ? `<div style="margin-top:16px;"><div style="font-size:11.5px;color:#8a8a8a;margin-bottom:8px;">Social Links</div><div class="social-chip-row">${socials.map(([k]) => `<span class="social-chip">${esc(k)}</span>`).join("")}</div></div>` : ""}

    ${b.mapsLink ? `<a href="${b.mapsLink}" target="_blank" style="display:block;margin-top:18px;height:46px;border-radius:12px;background:#141414;border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;font-weight:700;color:#e0a83c;">Open in Google Maps</a>` : ""}
  `;
}
function aboutRow(k, v, icon) {
  return `<div class="about-detail-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${icon}</svg><div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div></div>`;
}
function lockedAboutRow(k, icon) {
  return `<div class="about-detail-row locked" onclick="openContactUpgradeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${icon}</svg><div><div class="k">${esc(k)}</div><div class="v">🔒 Upgrade to view</div></div></div>`;
}

/* ---------------------------------------------------------------------
   View counter
--------------------------------------------------------------------- */
function registerView() {
  if (PROFILE.isOwner) return;
  const sessionKey = "neilnest_viewed_" + PROFILE.businessId;
  if (sessionStorage.getItem(sessionKey)) return;
  sessionStorage.setItem(sessionKey, "1");
  db.collection(COLLECTIONS.businesses).doc(PROFILE.businessId).update({ viewsCount: firebase.firestore.FieldValue.increment(1) }).catch(err => console.error(err));
}

/* ---------------------------------------------------------------------
   Misc bindings
--------------------------------------------------------------------- */
function bindHeaderActions() {
  document.getElementById("shareBtn").addEventListener("click", shareProfile);
}
function bindModals() {
  document.getElementById("closeReviewModal").addEventListener("click", () => document.getElementById("reviewModal").classList.remove("open"));
  document.getElementById("submitReviewBtn").addEventListener("click", submitReview);
  [document.getElementById("reviewModal"), document.getElementById("quickViewModal"), document.getElementById("contactUpgradeModal")].forEach(m => {
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); });
  });
  document.getElementById("closeContactUpgradeModal").addEventListener("click", () => document.getElementById("contactUpgradeModal").classList.remove("open"));
  document.getElementById("contactMaybeLaterBtn").addEventListener("click", () => document.getElementById("contactUpgradeModal").classList.remove("open"));
  document.getElementById("closeClaimModal").addEventListener("click", () => document.getElementById("claimModal").classList.remove("open"));
  bindLightbox();
}
function bindBell() {
  const bellBtn = document.getElementById("bellBtn");
  const panel = document.getElementById("notifPanel");
  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", () => { panel.style.display = "none"; });
  panel.addEventListener("click", (e) => e.stopPropagation());
}
