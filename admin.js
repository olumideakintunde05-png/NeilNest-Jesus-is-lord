/* ===========================================================================
   admin.js — NeilNest Admin Panel (merged single file)
   Combines: admin-core, admin-dashboard, admin-payments, admin-reports,
   admin-businesses, admin-catalog, admin-users, admin-learning, admin-misc.
   Requires: firebase-init.js, auth-guard.js, billing.js, trustsafety-core.js
   =========================================================================== */

/* ---------- from admin-core.js ---------- */
/* ==========================================================================
   admin-core.js — NeilNest Admin Panel shared foundation
   Requires: firebase-init.js, auth-guard.js, billing.js, trustsafety-core.js
   Loaded before every other admin-*.js file — they all depend on the
   helpers and ADMIN_STATE defined here.
   ========================================================================== */
const ADMIN_EMAIL = "olumideakintunde05@gmail.com"; // must match isAdmin() in firestore.rules exactly

const ADMIN_STATE = { user: null };

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
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtNaira(n) { return "₦" + (Number(n) || 0).toLocaleString(); }
function openFullImage(url) {
  document.getElementById("fullImageEl").src = url;
  document.getElementById("fullImageModal").classList.add("open");
}

/* ---------------------------------------------------------------------
   Generic reason-required confirmation modal — used by Businesses,
   Investigations, Users (warn/suspend/ban), Payments (reject).
--------------------------------------------------------------------- */
let _reasonModalCallback = null;
function openReasonModal(title, sub, onConfirm) {
  document.getElementById("reasonModalTitle").textContent = title;
  document.getElementById("reasonModalSub").textContent = sub || "The affected party will be notified.";
  document.getElementById("reasonModalInput").value = "";
  _reasonModalCallback = onConfirm;
  document.getElementById("reasonModal").classList.add("open");
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("closeReasonModal").addEventListener("click", () => document.getElementById("reasonModal").classList.remove("open"));
  document.getElementById("fullImageModal").addEventListener("click", () => document.getElementById("fullImageModal").classList.remove("open"));
  document.getElementById("confirmReasonBtn").addEventListener("click", async () => {
    const reason = document.getElementById("reasonModalInput").value.trim();
    if (!reason) { showToast("Enter a reason.", "error"); return; }
    const btn = document.getElementById("confirmReasonBtn");
    btn.disabled = true;
    try {
      await _reasonModalCallback(reason);
      document.getElementById("reasonModal").classList.remove("open");
    } catch (err) {
      console.error("reason modal action error:", err);
      showToast(err.message || "Action failed.", "error");
    } finally {
      btn.disabled = false;
    }
  });
});

/* ---------------------------------------------------------------------
   Init — auth gate, then nav routing
--------------------------------------------------------------------- */
const SECTION_TITLES = {
  dashboard: "Dashboard", users: "Users", businesses: "Businesses",
  addbusiness: "Add Business", claims: "Business Claims",
  products: "Products", services: "Services", payments: "Payments",
  reports: "Reports", trusted: "Trusted Sellers", investigations: "Investigations",
  learning: "Learning Hub", featured: "Featured Content", notifications: "Notifications",
  logs: "Moderation Logs", settings: "Settings"
};
const SECTION_LOADED = {};

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("adminLoginBtn").addEventListener("click", handleAdminLogin);
  document.getElementById("adminLoginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") handleAdminLogin(); });

  const user = await Promise.race([
    waitForAuthUser(),
    new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 8000))
  ]);

  if (user === "TIMEOUT" || !user) {
    showAdminGate();
    return;
  }
  if ((user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    // Signed into some other account — sign it out so the login form
    // below starts clean, rather than silently sitting on the wrong session.
    await auth.signOut().catch(() => {});
    showAdminGate("That account isn't authorized for admin access. Sign in with the admin account below.");
    return;
  }

  enterAdminPanel(user);
});

function showAdminGate(message) {
  document.getElementById("gateMessage").textContent = message || "Sign in with the admin account.";
  document.getElementById("gateWrap").style.display = "block";
}

async function handleAdminLogin() {
  const email = document.getElementById("adminLoginEmail").value.trim();
  const password = document.getElementById("adminLoginPassword").value;
  const errEl = document.getElementById("adminLoginError");
  errEl.style.display = "none";

  if (!email || !password) {
    errEl.textContent = "Enter both email and password.";
    errEl.style.display = "block";
    return;
  }

  const btn = document.getElementById("adminLoginBtn");
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    if ((cred.user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      await auth.signOut();
      errEl.textContent = "That account isn't authorized for admin access.";
      errEl.style.display = "block";
      return;
    }
    document.getElementById("gateWrap").style.display = "none";
    enterAdminPanel(cred.user);
  } catch (err) {
    console.error("admin login error:", err);
    errEl.textContent = (typeof friendlyAuthError === "function" ? friendlyAuthError(err) : null) || "Couldn't sign in — check your email and password.";
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
}

function enterAdminPanel(user) {
  ADMIN_STATE.user = user;
  document.getElementById("adminEmailLabel").textContent = user.email;
  document.getElementById("settingsAdminEmail").textContent = user.email;
  document.getElementById("layoutWrap").style.display = "flex";

  document.getElementById("signOutBtn").addEventListener("click", () => auth.signOut().then(() => window.location.reload()));
  document.getElementById("sidebarToggle").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));

  document.querySelectorAll(".nav-item[data-section]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.section));
  });

  navigateTo("dashboard");
  refreshNavBadges();
}

function navigateTo(section) {
  document.querySelectorAll(".nav-item[data-section]").forEach((b) => b.classList.toggle("active", b.dataset.section === section));
  document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
  document.getElementById(`section-${section}`).classList.add("active");
  document.getElementById("pageTitle").textContent = SECTION_TITLES[section] || section;
  document.getElementById("sidebar").classList.remove("open");

  const initFn = window[`init_${section}`];
  if (typeof initFn === "function") initFn(!SECTION_LOADED[section]);
  SECTION_LOADED[section] = true;
}

async function refreshNavBadges() {
  try {
    const pendingPayments = await db.collection(COLLECTIONS.paymentVerifications).where("status", "==", "pending").get();
    const badge1 = document.getElementById("navPaymentsBadge");
    if (pendingPayments.size > 0) { badge1.textContent = pendingPayments.size; badge1.style.display = "flex"; }

    const [bizR, prodR, userR] = await Promise.all([
      db.collection(COLLECTIONS.businessReports).where("status", "==", "pending").get(),
      db.collection(COLLECTIONS.productReports).where("status", "==", "pending").get(),
      db.collection(COLLECTIONS.userReports).where("status", "==", "pending").get()
    ]);
    const totalReports = bizR.size + prodR.size + userR.size;
    const badge2 = document.getElementById("navReportsBadge");
    if (totalReports > 0) { badge2.textContent = totalReports; badge2.style.display = "flex"; }

    const pendingClaims = await db.collection("businessClaims").where("status", "==", "pending").get();
    const badge3 = document.getElementById("navClaimsBadge");
    if (pendingClaims.size > 0) { badge3.textContent = pendingClaims.size; badge3.style.display = "flex"; }
  } catch (err) {
    console.error("refreshNavBadges error:", err);
  }
}

/* ---------- from admin-dashboard.js ---------- */
/* ==========================================================================
   admin-dashboard.js
   Every number here is a real Firestore read. Counts use .get().size rather
   than count() aggregation queries for compat-SDK-version safety — fine at
   current scale, worth switching to .count().get() once collections get
   large enough that fetching full docs just to count them gets expensive.
   ========================================================================== */
async function init_dashboard() {
  loadDashboardStats();
  loadDashboardAnalytics();
  loadDashboardActivity();
}

async function loadDashboardStats() {
  const grid = document.getElementById("dashStatGrid");
  const queries = [
    ["Total Users", db.collection(COLLECTIONS.users).get()],
    ["Total Businesses", db.collection(COLLECTIONS.businesses).get()],
    ["Total Products", db.collectionGroup(COLLECTIONS.products).get()],
    ["Total Services", db.collectionGroup(COLLECTIONS.services).get()],
    ["Pro Users", db.collection(COLLECTIONS.users).where("plan", "==", "pro").get()],
    ["Business Users", db.collection(COLLECTIONS.users).where("plan", "==", "business").get()],
    ["Pending Payments", db.collection(COLLECTIONS.paymentVerifications).where("status", "==", "pending").get()],
    ["Approved Payments", db.collection(COLLECTIONS.paymentVerifications).where("status", "==", "approved").get()],
    ["Business Reports", db.collection(COLLECTIONS.businessReports).where("status", "==", "pending").get()],
    ["Product Reports", db.collection(COLLECTIONS.productReports).where("status", "==", "pending").get()],
    ["User Reports", db.collection(COLLECTIONS.userReports).where("status", "==", "pending").get()],
    ["Under Investigation", db.collection(COLLECTIONS.businesses).where("underInvestigation", "==", true).get()],
    ["Trusted Sellers", db.collection(COLLECTIONS.businesses).where("trustedSeller", "==", true).get()],
    ["Suspended", db.collection(COLLECTIONS.businesses).where("suspended", "==", true).get()],
    ["Banned", db.collection(COLLECTIONS.businesses).where("banned", "==", true).get()]
  ];

  const results = await Promise.allSettled(queries.map((q) => q[1]));
  const failed = results.map((r, i) => ({ label: queries[i][0], r })).filter((x) => x.r.status === "rejected");

  if (failed.length) {
    console.error("loadDashboardStats — failing queries:", failed.map((f) => `${f.label}: ${f.r.reason.message}`));
    grid.innerHTML = `<div class="empty-note">Couldn't load: ${failed.map((f) => esc(f.label)).join(", ")} — ${esc(failed[0].r.reason.message)}. Check the browser console for the full list; this usually means the deployed Firestore rules don't match what you expect (confirm you clicked <strong>Publish</strong> in the Firebase console, not just saved a draft).</div>`;
    return;
  }

  const [usersSnap, businessesSnap, productsSnap, servicesSnap,
         proUsersSnap, businessUsersSnap,
         pendingPaySnap, approvedPaySnap,
         bizReportsSnap, prodReportsSnap, userReportsSnap,
         investigatingSnap, trustedSnap, suspendedSnap, bannedSnap] = results.map((r) => r.value);

  // "Free" isn't queried directly — a brand-new user doc may have no
  // `plan` field at all until they interact with billing, which a
  // where("plan","==","free") query would silently miss. Anyone not
  // explicitly Pro or Business counts as Free instead.
  const freeCount = usersSnap.size - proUsersSnap.size - businessUsersSnap.size;

  const stats = [
    { label: "Total Users", value: usersSnap.size },
    { label: "Total Businesses", value: businessesSnap.size },
    { label: "Total Products", value: productsSnap.size },
    { label: "Total Services", value: servicesSnap.size },
    { label: "Free Users", value: freeCount },
    { label: "Pro Users", value: proUsersSnap.size },
    { label: "Business Users", value: businessUsersSnap.size },
    { label: "Pending Payments", value: pendingPaySnap.size },
    { label: "Approved Payments", value: approvedPaySnap.size },
    { label: "Pending Reports", value: bizReportsSnap.size + prodReportsSnap.size + userReportsSnap.size },
    { label: "Under Investigation", value: investigatingSnap.size },
    { label: "Trusted Sellers", value: trustedSnap.size },
    { label: "Suspended", value: suspendedSnap.size },
    { label: "Banned", value: bannedSnap.size }
  ];

  grid.innerHTML = stats.map((s) => `<div class="stat-card"><div class="num">${s.value.toLocaleString()}</div><div class="lbl">${s.label}</div></div>`).join("");
}

/* 7-day activity, summed across the 30 most recently updated businesses —
   NOT the full platform. Reading 7 dailyStats docs per business for every
   business would scale terribly; this is a bounded, honest sample rather
   than a silently-incomplete "full platform" number. */
async function loadDashboardAnalytics() {
  const card = document.getElementById("dashAnalyticsCard");
  try {
    const bizSnap = await db.collection(COLLECTIONS.businesses).orderBy("updatedAt", "desc").limit(30).get();
    if (bizSnap.empty) { card.innerHTML = `<div class="empty-note">No business activity yet.</div>`; return; }

    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }

    const totals = { views: 0, whatsappClicks: 0, callClicks: 0, websiteClicks: 0, messagesReceived: 0 };
    const reads = [];
    bizSnap.docs.forEach((biz) => {
      days.forEach((day) => reads.push(
        biz.ref.collection("dailyStats").doc(day).get().then((d) => {
          if (!d.exists) return;
          const data = d.data();
          Object.keys(totals).forEach((k) => { totals[k] += data[k] || 0; });
        }).catch(() => {})
      ));
    });
    await Promise.all(reads);

    card.innerHTML = `
      <div class="card-sub" style="margin-bottom:12px;">Sampled from the ${bizSnap.size} most recently active businesses, last 7 days.</div>
      <div class="kv-row"><span class="k">Views</span><span class="v">${totals.views.toLocaleString()}</span></div>
      <div class="kv-row"><span class="k">WhatsApp Clicks</span><span class="v">${totals.whatsappClicks.toLocaleString()}</span></div>
      <div class="kv-row"><span class="k">Call Clicks</span><span class="v">${totals.callClicks.toLocaleString()}</span></div>
      <div class="kv-row"><span class="k">Website Clicks</span><span class="v">${totals.websiteClicks.toLocaleString()}</span></div>
      <div class="kv-row"><span class="k">Messages Received</span><span class="v">${totals.messagesReceived.toLocaleString()}</span></div>`;
  } catch (err) {
    console.error("loadDashboardAnalytics error:", err);
    card.innerHTML = `<div class="empty-note">Couldn't load analytics — ${esc(err.message)}</div>`;
  }
}

async function loadDashboardActivity() {
  const wrap = document.getElementById("dashActivityList");
  try {
    const snap = await db.collection(COLLECTIONS.moderationLogs).orderBy("createdAt", "desc").limit(15).get();
    if (snap.empty) { wrap.innerHTML = `<div class="empty-note">No admin activity yet.</div>`; return; }

    const actionLabels = {
      suspend: "Business Suspended", restore: "Business Restored", ban: "Business Banned",
      award_trusted_seller: "Trusted Seller Awarded", remove_trusted_seller: "Trusted Seller Removed",
      warn: "Business Warned", payment_approved: "Payment Approved", payment_rejected: "Payment Rejected"
    };

    wrap.innerHTML = snap.docs.map((d) => {
      const l = d.data();
      return `
        <div class="card" style="padding:12px 14px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;gap:10px;">
            <div style="font-size:12.5px;font-weight:700;">${actionLabels[l.action] || esc(l.action)}</div>
            <div style="font-size:11px;color:#6e6e6e;flex-shrink:0;">${fmtDate(l.createdAt)}</div>
          </div>
          ${l.reason ? `<div style="font-size:11.5px;color:#a8a8a8;margin-top:4px;">${esc(l.reason)}</div>` : ""}
          ${l.businessId ? `<a href="business-profile.html?id=${l.businessId}" style="font-size:11px;color:#e0a83c;">View Business →</a>` : ""}
        </div>`;
    }).join("");
  } catch (err) {
    console.error("loadDashboardActivity error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load activity — ${esc(err.message)}</div>`;
  }
}

/* ---------- from admin-payments.js ---------- */
/* ==========================================================================
   admin-payments.js
   ========================================================================== */
let paymentsFilterStatus = "pending";
let paymentsLastDoc = null;
const PAYMENTS_PAGE_SIZE = 20;

function init_payments(firstLoad) {
  if (firstLoad) {
    document.getElementById("paymentsFilter").addEventListener("click", (e) => {
      const chip = e.target.closest(".filter-chip");
      if (!chip) return;
      document.querySelectorAll("#paymentsFilter .filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      paymentsFilterStatus = chip.dataset.status;
      paymentsLastDoc = null;
      loadPayments(false);
    });
    document.getElementById("paymentsLoadMoreBtn").addEventListener("click", () => loadPayments(true));
  }
  paymentsLastDoc = null;
  loadPayments(false);
}

async function loadPayments(append) {
  const wrap = document.getElementById("paymentsList");
  const moreBtn = document.getElementById("paymentsLoadMoreBtn");
  if (!append) wrap.innerHTML = `<div class="skel"></div><div class="skel"></div>`;

  try {
    let q = db.collection(COLLECTIONS.paymentVerifications)
      .where("status", "==", paymentsFilterStatus)
      .orderBy("submittedAt", "desc")
      .limit(PAYMENTS_PAGE_SIZE);
    if (append && paymentsLastDoc) q = q.startAfter(paymentsLastDoc);

    const snap = await q.get();
    if (snap.empty && !append) { wrap.innerHTML = `<div class="empty-note">No ${paymentsFilterStatus} payments.</div>`; moreBtn.style.display = "none"; return; }

    paymentsLastDoc = snap.docs[snap.docs.length - 1] || paymentsLastDoc;
    moreBtn.style.display = snap.size === PAYMENTS_PAGE_SIZE ? "block" : "none";

    const html = snap.docs.map((d) => {
      const p = { id: d.id, ...d.data() };
      const planLabel = PLAN_CATALOG[p.plan] ? PLAN_CATALOG[p.plan].name : p.plan;
      const subLabel = p.badgeOnly
        ? "Verified Badge only (existing Pro plan)"
        : `${esc(planLabel)} · ${esc(p.billingCycle || "monthly")}${p.verificationAddon ? " · + Verified Badge" : ""}`;
      return `
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">${esc(p.senderName)}</div>
              <div class="card-sub">${subLabel}</div>
            </div>
            <span class="status-pill status-pill--${p.status}">${p.status}</span>
          </div>
          <div class="kv-row"><span class="k">Amount</span><span class="v">${fmtNaira(p.amount)}</span></div>
          <div class="kv-row"><span class="k">Reference</span><span class="v">${esc(p.reference)}</span></div>
          <div class="kv-row"><span class="k">Phone</span><span class="v">${esc(p.phone)}</span></div>
          <div class="kv-row"><span class="k">Transfer Date</span><span class="v">${esc(p.transferDate)}</span></div>
          <div class="kv-row"><span class="k">Submitted</span><span class="v">${fmtDate(p.submittedAt)}</span></div>
          <div class="kv-row"><span class="k">Business</span><span class="v"><a href="business-profile.html?id=${p.businessId}" style="color:#e0a83c;">View →</a></span></div>
          ${p.note ? `<div class="desc-block">${esc(p.note)}</div>` : ""}
          ${p.proofImage ? `<img class="proof-thumb" src="${p.proofImage}" onclick="openFullImage('${p.proofImage}')" alt="Proof of payment">` : ""}
          ${p.status === "rejected" && p.rejectionReason ? `<div class="desc-block" style="color:#f3a89e;">Rejected: ${esc(p.rejectionReason)}</div>` : ""}
          ${p.status === "pending" ? `
            <div class="btn-row">
              <button class="btn-sm btn-sm--reject" data-reject-payment="${p.id}">Reject</button>
              <button class="btn-sm btn-sm--approve" data-approve-payment="${p.id}">Approve</button>
            </div>` : ""}
        </div>`;
    }).join("");

    if (append) wrap.insertAdjacentHTML("beforeend", html);
    else wrap.innerHTML = html;

    wrap.querySelectorAll("[data-approve-payment]:not([data-bound])").forEach((btn) => {
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", () => handleApprovePayment(btn.dataset.approvePayment, btn));
    });
    wrap.querySelectorAll("[data-reject-payment]:not([data-bound])").forEach((btn) => {
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", () => {
        openReasonModal("Reject Payment", "The user will be notified with this reason.", async (reason) => {
          await rejectPayment(btn.dataset.rejectPayment, reason);
          showToast("Payment rejected.");
          init_payments(false);
        });
      });
    });
  } catch (err) {
    console.error("loadPayments error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load payments — ${esc(err.message)}</div>`;
  }
}

async function handleApprovePayment(paymentId, btn) {
  btn.disabled = true;
  btn.textContent = "Approving…";
  try {
    await approvePayment(paymentId);
    showToast("Subscription activated.");
    init_payments(false);
  } catch (err) {
    console.error("approvePayment error:", err);
    showToast(err.message || "Couldn't approve.", "error");
    btn.disabled = false;
    btn.textContent = "Approve";
  }
}

/* ---------- from admin-reports.js ---------- */
/* ==========================================================================
   admin-reports.js
   ========================================================================== */
let reportsTypeFilter = "all";
let reportsStatusFilter = "pending";

function init_reports(firstLoad) {
  if (firstLoad) {
    document.getElementById("reportsTypeFilter").addEventListener("click", (e) => {
      const chip = e.target.closest(".filter-chip");
      if (!chip) return;
      document.querySelectorAll("#reportsTypeFilter .filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      reportsTypeFilter = chip.dataset.type;
      loadReports();
    });
    document.getElementById("reportsStatusFilter").addEventListener("click", (e) => {
      const chip = e.target.closest(".filter-chip");
      if (!chip) return;
      document.querySelectorAll("#reportsStatusFilter .filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      reportsStatusFilter = chip.dataset.status;
      loadReports();
    });
  }
  loadReports();
}

async function loadReports() {
  const wrap = document.getElementById("reportsList");
  wrap.innerHTML = `<div class="skel"></div><div class="skel"></div>`;
  try {
    const collections = [
      { name: COLLECTIONS.businessReports, type: "business", label: "Business" },
      { name: COLLECTIONS.productReports, type: "product", label: "Product" },
      { name: COLLECTIONS.userReports, type: "user", label: "User" }
    ].filter((c) => reportsTypeFilter === "all" || c.type === reportsTypeFilter);

    const results = await Promise.all(collections.map((c) =>
      db.collection(c.name).where("status", "==", reportsStatusFilter).limit(50).get()
    ));

    let all = [];
    results.forEach((snap, i) => {
      snap.docs.forEach((d) => all.push({ id: d.id, collection: collections[i].name, type: collections[i].label, ...d.data() }));
    });
    all.sort((a, b) => (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0));

    if (all.length === 0) { wrap.innerHTML = `<div class="empty-note">No ${reportsStatusFilter} reports.</div>`; return; }

    wrap.innerHTML = all.map((r) => `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${esc(r.reason)}</div>
            <div class="card-sub">${r.type} report${r.targetName ? " · " + esc(r.targetName) : ""}</div>
          </div>
          <span class="status-pill status-pill--${r.status}">${r.status}</span>
        </div>
        <div class="kv-row"><span class="k">Reporter</span><span class="v">${esc(r.reporterUid)}</span></div>
        <div class="kv-row"><span class="k">Submitted</span><span class="v">${fmtDate(r.createdAt)}</span></div>
        ${r.businessId ? `<div class="kv-row"><span class="k">Business</span><span class="v"><a href="business-profile.html?id=${r.businessId}" style="color:#e0a83c;">View →</a></span></div>` : ""}
        ${r.description ? `<div class="desc-block">${esc(r.description)}</div>` : ""}
        ${r.screenshotUrl ? `<img class="proof-thumb" src="${r.screenshotUrl}" onclick="openFullImage('${r.screenshotUrl}')" alt="Report screenshot">` : ""}
        ${r.status === "pending" ? `
          <div class="btn-row">
            <button class="btn-sm btn-sm--outline" data-dismiss-report="${r.collection}|${r.id}">Dismiss</button>
            <button class="btn-sm btn-sm--approve" data-resolve-report="${r.collection}|${r.id}">Resolve</button>
            ${r.businessId ? `<button class="btn-sm btn-sm--reject" data-warn-business="${r.businessId}" style="flex-basis:100%;">Warn Business</button>` : ""}
          </div>` : ""}
      </div>`).join("");

    wrap.querySelectorAll("[data-resolve-report]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [coll, id] = btn.dataset.resolveReport.split("|");
        btn.disabled = true;
        try { await resolveReport(coll, id); showToast("Report resolved."); loadReports(); }
        catch (err) { showToast(err.message || "Couldn't resolve.", "error"); btn.disabled = false; }
      });
    });
    wrap.querySelectorAll("[data-dismiss-report]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [coll, id] = btn.dataset.dismissReport.split("|");
        btn.disabled = true;
        try { await dismissReport(coll, id); showToast("Report dismissed."); loadReports(); }
        catch (err) { showToast(err.message || "Couldn't dismiss.", "error"); btn.disabled = false; }
      });
    });
    wrap.querySelectorAll("[data-warn-business]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openReasonModal("Warn Business", "The business owner will be notified.", async (reason) => {
          await warnBusiness(btn.dataset.warnBusiness, reason);
          showToast("Warning sent.");
        });
      });
    });
  } catch (err) {
    console.error("loadReports error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load reports — ${esc(err.message)}</div>`;
  }
}

/* ---------- from admin-businesses.js ---------- */
/* ==========================================================================
   admin-businesses.js
   Covers three nav sections that all operate on the same business docs and
   moderation functions: Businesses, Trusted Sellers, Investigations.
   ========================================================================== */
function init_businesses(firstLoad) {
  if (firstLoad) {
    document.getElementById("businessSearchInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") searchBusinesses(e.target.value.trim());
    });
  }
}

function init_trusted() { loadTrustedSellers(); }
function init_investigations() { loadInvestigations(); }

async function searchBusinesses(term) {
  const wrap = document.getElementById("businessesList");
  if (!term) { wrap.innerHTML = `<div class="empty-note">Search for a business to view and moderate it.</div>`; return; }
  wrap.innerHTML = `<div class="skel"></div>`;
  try {
    const snap = await db.collection(COLLECTIONS.businesses).orderBy("name").startAt(term).endAt(term + "\uf8ff").limit(20).get();
    if (snap.empty) { wrap.innerHTML = `<div class="empty-note">No businesses match "${esc(term)}".</div>`; return; }
    wrap.innerHTML = snap.docs.map((d) => renderBusinessCard({ id: d.id, ...d.data() })).join("");
    wireBusinessActionButtons(wrap, () => searchBusinesses(term));
  } catch (err) {
    console.error("searchBusinesses error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't search — ${esc(err.message)}</div>`;
  }
}

/* ---------- Add Business (admin-created, unclaimed listing) ---------- */
// Same working Cloudinary account already used by add-business.js — not a
// placeholder, so this doesn't silently break if left unconfigured.
const ADMIN_CLOUDINARY_CLOUD_NAME = "dhwelpyz";
const ADMIN_CLOUDINARY_UPLOAD_PRESET = "NeilNest";

function init_addbusiness(firstLoad) {
  if (firstLoad) {
    document.getElementById("abSubmitBtn").addEventListener("click", handleAdminAddBusiness);
    document.getElementById("abAddAnotherBtn").addEventListener("click", () => {
      document.getElementById("addBizSuccessCard").style.display = "none";
      document.getElementById("addBizFormCard").style.display = "block";
      ["abName", "abCategory", "abDescription", "abState", "abCity", "abAddress", "abPhone", "abWhatsapp", "abEmail", "abWebsite", "abInstagram", "abFacebook", "abTiktok", "abHours"]
        .forEach((id) => { document.getElementById(id).value = ""; });
      document.getElementById("abLogoFile").value = "";
      document.getElementById("abImagesFile").value = "";
    });
  }
}

async function adminUploadToCloudinary(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", ADMIN_CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${ADMIN_CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Image upload failed.");
  return (await res.json()).secure_url;
}

async function handleAdminAddBusiness() {
  const name = document.getElementById("abName").value.trim();
  const category = document.getElementById("abCategory").value.trim();
  if (!name || !category) { showToast("Business Name and Category are required.", "error"); return; }

  const btn = document.getElementById("abSubmitBtn");
  btn.disabled = true; btn.textContent = "Creating…";

  try {
    const logoFile = document.getElementById("abLogoFile").files[0];
    const imageFiles = Array.from(document.getElementById("abImagesFile").files || []);
    const logoUrl = logoFile ? await adminUploadToCloudinary(logoFile) : "";
    const imageUrls = [];
    for (const f of imageFiles) imageUrls.push(await adminUploadToCloudinary(f));

    const phone = document.getElementById("abPhone").value.trim();
    const whatsapp = document.getElementById("abWhatsapp").value.trim();
    const email = document.getElementById("abEmail").value.trim();

    // Same schema as a normal self-signup business (add-business.js) — see
    // NEILNEST_FIRESTORE_REFERENCE.md. Only the fields this feature actually
    // needs are new: claimed / claimStatus / createdBy, and ownerUid is null
    // instead of a real uid until someone claims it.
    const businessDoc = {
      ownerUid: null, claimed: false, claimStatus: "unclaimed", createdBy: "admin",
      name, category,
      businessType: "service",
      description: document.getElementById("abDescription").value.trim(),
      location: { country: "Nigeria", state: document.getElementById("abState").value.trim(), city: document.getElementById("abCity").value.trim() },
      address: document.getElementById("abAddress").value.trim(),
      logoUrl, coverUrl: imageUrls[0] || "",
      contactChannels: { phone: !!phone, whatsapp: !!whatsapp, email: !!email },
      website: document.getElementById("abWebsite").value.trim(),
      hours: document.getElementById("abHours").value.trim(),
      socials: {
        instagram: document.getElementById("abInstagram").value.trim(),
        facebook: document.getElementById("abFacebook").value.trim(),
        tiktok: document.getElementById("abTiktok").value.trim()
      },
      plan: "free", visibility: "public",
      status: "pending", verified: false, trustedSeller: false, featured: false, featuredHome: false,
      followersCount: 0, viewsCount: 0, ratingAvg: 0, ratingCount: 0, completedDeals: 0,
      productsCount: 0, servicesCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const ref = await db.collection(COLLECTIONS.businesses).add(businessDoc);

    // Protected contact info, same pattern as add-business.js — never on
    // the public doc.
    if (phone || whatsapp || email) {
      await ref.collection("private").doc("contact").set({
        phone, whatsapp, email, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    document.getElementById("addBizFormCard").style.display = "none";
    document.getElementById("addBizSuccessCard").style.display = "block";
    const claimLink = `${window.location.origin}/business-profile.html?id=${ref.id}`;
    document.getElementById("abViewBtn").href = claimLink;
    document.getElementById("abCopyLinkBtn").onclick = () => {
      navigator.clipboard.writeText(claimLink).then(() => showToast("Claim link copied."));
    };
    showToast("Business created successfully.");
  } catch (err) {
    console.error("handleAdminAddBusiness error:", err);
    showToast(err.message || "Couldn't create business.", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Create Listing";
  }
}

/* ---------- Business Claims review ---------- */
let claimsFilterStatus = "pending";

function init_claims(firstLoad) {
  if (firstLoad) {
    document.getElementById("claimsFilter").addEventListener("click", (e) => {
      const chip = e.target.closest(".filter-chip");
      if (!chip) return;
      document.querySelectorAll("#claimsFilter .filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      claimsFilterStatus = chip.dataset.status;
      loadClaims();
    });
  }
  loadClaims();
}

async function loadClaims() {
  const wrap = document.getElementById("claimsList");
  wrap.innerHTML = `<div class="skel"></div><div class="skel"></div>`;
  try {
    const snap = await db.collection("businessClaims").where("status", "==", claimsFilterStatus).orderBy("submittedAt", "desc").limit(50).get();
    if (snap.empty) { wrap.innerHTML = `<div class="empty-note">No ${esc(claimsFilterStatus)} claims.</div>`; return; }

    const claims = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const bizIds = [...new Set(claims.map((c) => c.businessId))];
    const bizDocs = await Promise.all(bizIds.map((id) => db.collection(COLLECTIONS.businesses).doc(id).get()));
    const bizMap = {};
    bizDocs.forEach((d) => { bizMap[d.id] = d.exists ? d.data() : null; });

    wrap.innerHTML = claims.map((c) => {
      const biz = bizMap[c.businessId];
      return `
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">${esc(biz ? biz.name : "(business not found)")}</div>
              <div class="card-sub">Claimed by ${esc(c.claimantName || c.claimantEmail)}</div>
            </div>
            <span class="status-pill status-pill--${c.status}">${c.status}</span>
          </div>
          <div class="kv-row"><span class="k">Claimant Email</span><span class="v">${esc(c.claimantEmail)}</span></div>
          <div class="kv-row"><span class="k">Submitted</span><span class="v">${fmtDate(c.submittedAt)}</span></div>
          <div class="kv-row"><span class="k">Business</span><span class="v"><a href="business-profile.html?id=${c.businessId}" target="_blank" style="color:#e0a83c;">View →</a></span></div>
          ${c.status === "rejected" && c.rejectionReason ? `<div class="desc-block" style="color:#f3a89e;">Rejected: ${esc(c.rejectionReason)}</div>` : ""}
          ${c.status === "pending" ? `
            <div class="btn-row">
              <button class="btn-sm btn-sm--reject" data-reject-claim="${c.id}">Reject</button>
              <button class="btn-sm btn-sm--approve" data-approve-claim="${c.id}" data-business-id="${c.businessId}">Approve</button>
            </div>` : ""}
        </div>`;
    }).join("");

    wrap.querySelectorAll("[data-approve-claim]:not([data-bound])").forEach((btn) => {
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", () => handleApproveClaim(btn.dataset.approveClaim, btn.dataset.businessId, btn));
    });
    wrap.querySelectorAll("[data-reject-claim]:not([data-bound])").forEach((btn) => {
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", () => {
        openReasonModal("Reject Claim", "The claimant will be able to see this reason.", async (reason) => {
          try {
            await rejectClaim(btn.dataset.rejectClaim, reason);
            showToast("Claim rejected.");
            loadClaims();
            refreshNavBadges();
          } catch (err) {
            console.error("rejectClaim error:", err);
            showToast(err.message || "Couldn't reject claim.", "error");
          }
        });
      });
    });
  } catch (err) {
    console.error("loadClaims error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load claims — ${esc(err.message)}</div>`;
  }
}

// Transaction-based so two admins (or a duplicate click) can never both
// approve the same business — the re-read of ownerUid inside the
// transaction is the actual server-side duplicate-claim guard, not just a
// UI check.
async function handleApproveClaim(claimId, businessId, btn) {
  btn.disabled = true; btn.textContent = "Approving…";
  let claimantUid = null;
  try {
    await db.runTransaction(async (tx) => {
      const bizRef = db.collection(COLLECTIONS.businesses).doc(businessId);
      const claimRef = db.collection("businessClaims").doc(claimId);
      const [bizSnap, claimSnap] = await Promise.all([tx.get(bizRef), tx.get(claimRef)]);
      if (!bizSnap.exists) throw new Error("Business not found.");
      if (!claimSnap.exists) throw new Error("Claim not found.");
      const claim = claimSnap.data();
      if (claim.status !== "pending") throw new Error("This claim has already been reviewed.");
      if (bizSnap.data().ownerUid) throw new Error("This business has already been claimed.");

      claimantUid = claim.claimantUid;
      tx.update(bizRef, { ownerUid: claim.claimantUid, claimed: true, claimStatus: "claimed", updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      tx.update(claimRef, { status: "approved", reviewedAt: firebase.firestore.FieldValue.serverTimestamp(), reviewedBy: ADMIN_STATE.user.uid });
    });

    if (claimantUid) {
      await db.collection(COLLECTIONS.notifications).add({
        recipientUid: claimantUid, title: "Claim Approved",
        body: "You're now the owner of this business on NeilNest.",
        link: `business-profile.html?id=${businessId}`, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    showToast("Claim approved — ownership transferred.");
    loadClaims();
    refreshNavBadges();
  } catch (err) {
    console.error("handleApproveClaim error:", err);
    showToast(err.message || "Couldn't approve claim.", "error");
    btn.disabled = false; btn.textContent = "Approve";
  }
}

async function rejectClaim(claimId, reason) {
  const claimRef = db.collection("businessClaims").doc(claimId);
  const claimSnap = await claimRef.get();
  if (!claimSnap.exists) throw new Error("Claim not found.");
  const claim = claimSnap.data();
  await claimRef.update({
    status: "rejected", rejectionReason: reason || "",
    reviewedAt: firebase.firestore.FieldValue.serverTimestamp(), reviewedBy: ADMIN_STATE.user.uid
  });
  await db.collection(COLLECTIONS.notifications).add({
    recipientUid: claim.claimantUid, title: "Claim Rejected",
    body: reason ? `Your claim was rejected: ${reason}` : "Your claim was rejected.",
    link: `business-profile.html?id=${claim.businessId}`, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function loadTrustedSellers() {
  const wrap = document.getElementById("trustedList");
  wrap.innerHTML = `<div class="skel"></div>`;
  try {
    const snap = await db.collection(COLLECTIONS.businesses).where("trustedSeller", "==", true).get();
    if (snap.empty) { wrap.innerHTML = `<div class="empty-note">No Trusted Sellers yet.</div>`; return; }
    wrap.innerHTML = snap.docs.map((d) => renderBusinessCard({ id: d.id, ...d.data() })).join("");
    wireBusinessActionButtons(wrap, loadTrustedSellers);
  } catch (err) {
    console.error("loadTrustedSellers error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load — ${esc(err.message)}</div>`;
  }
}

async function loadInvestigations() {
  const wrap = document.getElementById("investigationsList");
  wrap.innerHTML = `<div class="skel"></div>`;
  try {
    const snap = await db.collection(COLLECTIONS.businesses).where("underInvestigation", "==", true).get();
    if (snap.empty) { wrap.innerHTML = `<div class="empty-note">No businesses under investigation.</div>`; return; }

    const cards = await Promise.all(snap.docs.map(async (d) => {
      const biz = { id: d.id, ...d.data() };
      const [bizR, prodR] = await Promise.all([
        db.collection(COLLECTIONS.businessReports).where("businessId", "==", biz.id).where("status", "==", "pending").get(),
        db.collection(COLLECTIONS.productReports).where("businessId", "==", biz.id).where("status", "==", "pending").get()
      ]);
      const reasons = [...bizR.docs, ...prodR.docs].map((r) => r.data().reason);
      return renderBusinessCard(biz, { reportCount: bizR.size + prodR.size, reportReasons: reasons });
    }));
    wrap.innerHTML = cards.join("");
    wireBusinessActionButtons(wrap, loadInvestigations);
  } catch (err) {
    console.error("loadInvestigations error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load — ${esc(err.message)}</div>`;
  }
}

/* ---------------------------------------------------------------------
   Shared card renderer + action wiring, used by all three sections above
--------------------------------------------------------------------- */
function renderBusinessCard(b, investigationInfo) {
  const status = getBusinessStatus(b, b.trustedSeller ? 100 : 0);
  return `
    <div class="card" data-business-id="${b.id}">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(b.name)}</div>
          <div class="card-sub">${esc(b.category || "")}${b.location && b.location.city ? " · " + esc(b.location.city) : ""}</div>
        </div>
        <span class="status-pill ${status.cls.replace('ts-status--', 'status-pill--')}">${status.label}</span>
      </div>
      <div class="kv-row"><span class="k">Owner UID</span><span class="v" style="font-size:11px;">${esc(b.ownerUid)}</span></div>
      <div class="kv-row"><span class="k">Plan</span><span class="v">${esc(b.plan || "free")}</span></div>
      <div class="kv-row"><span class="k">Verified</span><span class="v">${b.verified ? "Yes" : "No"}</span></div>
      <div class="kv-row"><span class="k">Phone / WhatsApp</span><span class="v">${esc(b.phone || "—")} / ${esc(b.whatsapp || "—")}</span></div>
      <div class="kv-row"><span class="k">Website</span><span class="v">${esc(b.website || "—")}</span></div>
      ${investigationInfo ? `<div class="desc-block">${investigationInfo.reportCount} pending report(s): ${esc(investigationInfo.reportReasons.join(", "))}</div>` : ""}
      <div class="btn-row">
        <a href="business-profile.html?id=${b.id}" class="btn-sm btn-sm--outline" style="flex-basis:100%;text-align:center;">View Profile</a>
      </div>
      <div class="btn-row">
        ${!b.trustedSeller ? `<button class="btn-sm btn-sm--gold" data-award-trusted="${b.id}">Award Trusted</button>` : `<button class="btn-sm btn-sm--outline" data-remove-trusted="${b.id}">Remove Trusted</button>`}
        ${b.suspended ? `<button class="btn-sm btn-sm--approve" data-restore="${b.id}">Restore</button>` : `<button class="btn-sm btn-sm--reject" data-suspend="${b.id}">Suspend</button>`}
        <button class="btn-sm btn-sm--reject" data-ban="${b.id}">Ban</button>
      </div>
      <div class="btn-row">
        <button class="btn-sm btn-sm--outline" data-warn="${b.id}">Warn</button>
        ${b.underInvestigation ? `<button class="btn-sm btn-sm--outline" data-resolve-investigation="${b.id}">Clear Investigation Flag</button>` : ""}
      </div>
    </div>`;
}

function wireBusinessActionButtons(wrap, refreshFn) {
  wrap.querySelectorAll("[data-award-trusted]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try { await awardTrustedSeller(btn.dataset.awardTrusted); showToast("Trusted Seller badge awarded."); refreshFn(); }
      catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
    });
  });
  wrap.querySelectorAll("[data-remove-trusted]").forEach((btn) => {
    btn.addEventListener("click", () => openReasonModal("Remove Trusted Seller", "The owner will be notified.", async (reason) => {
      await removeTrustedSeller(btn.dataset.removeTrusted, reason); showToast("Trusted Seller badge removed."); refreshFn();
    }));
  });
  wrap.querySelectorAll("[data-suspend]").forEach((btn) => {
    btn.addEventListener("click", () => openReasonModal("Suspend Business", "The owner will be notified.", async (reason) => {
      await suspendBusiness(btn.dataset.suspend, reason); showToast("Business suspended."); refreshFn();
    }));
  });
  wrap.querySelectorAll("[data-restore]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try { await restoreBusiness(btn.dataset.restore, "Restored by admin"); showToast("Business restored."); refreshFn(); }
      catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
    });
  });
  wrap.querySelectorAll("[data-ban]").forEach((btn) => {
    btn.addEventListener("click", () => openReasonModal("Ban Business", "This is a severe, visible action — the owner will be notified.", async (reason) => {
      await banBusiness(btn.dataset.ban, reason); showToast("Business banned."); refreshFn();
    }));
  });
  wrap.querySelectorAll("[data-warn]").forEach((btn) => {
    btn.addEventListener("click", () => openReasonModal("Warn Business", "The owner will be notified.", async (reason) => {
      await warnBusiness(btn.dataset.warn, reason); showToast("Warning sent."); refreshFn();
    }));
  });
  wrap.querySelectorAll("[data-resolve-investigation]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await db.collection(COLLECTIONS.businesses).doc(btn.dataset.resolveInvestigation).set({ underInvestigation: false }, { merge: true });
        showToast("Investigation flag cleared.");
        refreshFn();
      } catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
    });
  });
}

/* ---------- from admin-catalog.js ---------- */
/* ==========================================================================
   admin-catalog.js — Products & Services
   Firestore has no native "search all products across every business by
   name" query without either a third-party search index (Algolia etc,
   not in this stack) or a collectionGroup query with no useful filter.
   So this searches by BUSINESS name first, then shows that business's
   products/services — same pattern as Featured Content below. A true
   cross-business product search needs a search service this project
   doesn't have; flagging that rather than faking it with an unbounded
   collectionGroup scan.
   ========================================================================== */
function init_products(firstLoad) {
  if (firstLoad) document.getElementById("productsSearchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") searchCatalog("products", e.target.value.trim()); });
}
function init_services(firstLoad) {
  if (firstLoad) document.getElementById("servicesSearchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") searchCatalog("services", e.target.value.trim()); });
}

async function searchCatalog(kind, term) {
  const listId = kind === "products" ? "productsList" : "servicesList";
  const wrap = document.getElementById(listId);
  if (!term) { wrap.innerHTML = `<div class="empty-note">Search a business to see and moderate its ${kind}.</div>`; return; }
  wrap.innerHTML = `<div class="skel"></div>`;
  try {
    const bizSnap = await db.collection(COLLECTIONS.businesses).orderBy("name").startAt(term).endAt(term + "\uf8ff").limit(10).get();
    if (bizSnap.empty) { wrap.innerHTML = `<div class="empty-note">No businesses match "${esc(term)}".</div>`; return; }

    const groups = await Promise.all(bizSnap.docs.map(async (bizDoc) => {
      const itemsSnap = await bizDoc.ref.collection(kind === "products" ? COLLECTIONS.products : COLLECTIONS.services).get();
      return { business: { id: bizDoc.id, ...bizDoc.data() }, items: itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) };
    }));

    const nonEmpty = groups.filter((g) => g.items.length > 0);
    if (nonEmpty.length === 0) { wrap.innerHTML = `<div class="empty-note">Those businesses have no ${kind} listed.</div>`; return; }

    wrap.innerHTML = nonEmpty.map((g) => `
      <div style="margin-bottom:18px;">
        <div style="font-size:12.5px;font-weight:800;color:#e0a83c;margin-bottom:8px;">${esc(g.business.name)}</div>
        ${g.items.map((item) => renderCatalogItemCard(item, g.business.id, kind)).join("")}
      </div>`).join("");

    wireCatalogButtons(wrap, kind, () => searchCatalog(kind, term));
  } catch (err) {
    console.error("searchCatalog error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't search — ${esc(err.message)}</div>`;
  }
}

function renderCatalogItemCard(item, businessId, kind) {
  const isHiddenByOwner = !!item.hidden;
  const isHiddenByAdmin = !!item.adminHidden;
  return `
    <div class="card" data-item-id="${item.id}" data-business-id="${businessId}">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(item.name)}</div>
          <div class="card-sub">${esc(item.category || "")}${item.price ? " · " + fmtNaira(item.price) : ""}</div>
        </div>
        ${isHiddenByAdmin ? `<span class="status-pill status-pill--suspended">Admin Hidden</span>` : isHiddenByOwner ? `<span class="status-pill status-pill--free">Hidden by Owner</span>` : `<span class="status-pill status-pill--active">Visible</span>`}
      </div>
      ${item.images && item.images[0] ? `<img class="proof-thumb" src="${item.images[0]}" onclick="openFullImage('${item.images[0]}')" alt="">` : ""}
      <div class="kv-row"><span class="k">Views</span><span class="v">${(item.viewsCount || 0).toLocaleString()}</span></div>
      <div class="kv-row"><span class="k">Created</span><span class="v">${fmtDate(item.createdAt)}</span></div>
      <div class="btn-row">
        ${isHiddenByAdmin
          ? `<button class="btn-sm btn-sm--approve" data-unhide="${kind}">Unhide (Admin)</button>`
          : `<button class="btn-sm btn-sm--reject" data-hide="${kind}">Hide (Admin)</button>`}
      </div>
    </div>`;
}

function wireCatalogButtons(wrap, kind, refreshFn) {
  const collectionName = kind === "products" ? COLLECTIONS.products : COLLECTIONS.services;
  wrap.querySelectorAll("[data-hide]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-item-id]");
      btn.disabled = true;
      try {
        await db.collection(COLLECTIONS.businesses).doc(card.dataset.businessId).collection(collectionName).doc(card.dataset.itemId).set({ adminHidden: true }, { merge: true });
        showToast("Hidden from the marketplace.");
        refreshFn();
      } catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
    });
  });
  wrap.querySelectorAll("[data-unhide]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-item-id]");
      btn.disabled = true;
      try {
        await db.collection(COLLECTIONS.businesses).doc(card.dataset.businessId).collection(collectionName).doc(card.dataset.itemId).set({ adminHidden: false }, { merge: true });
        showToast("Unhidden.");
        refreshFn();
      } catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
    });
  });
}

/* ---------- from admin-users.js ---------- */
/* ==========================================================================
   admin-users.js
   SCHEMA CONFIRMED from auth.js: users/{uid} has fullName, email, phone,
   accountType ("business"|"professional"), businessName, profession,
   category, skills, bio, location, plan, emailVerified, verified,
   profileCompleted, createdAt, updatedAt. emailVerified IS denormalized
   into Firestore at signup (ensureUserDoc/createNeilNestAccount both write
   it), so it's shown here for real — earlier assumption that it was
   Auth-only and unavailable was wrong, corrected once auth.js was provided.
   ========================================================================== */
function init_users(firstLoad) {
  if (firstLoad) {
    document.getElementById("usersSearchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") searchUsers(e.target.value.trim()); });
  }
  loadRecentUsers();
}

async function loadRecentUsers() {
  const wrap = document.getElementById("usersList");
  wrap.innerHTML = `<div class="skel"></div>`;
  try {
    const snap = await db.collection(COLLECTIONS.users).orderBy("lastActiveAt", "desc").limit(20).get();
    if (snap.empty) { wrap.innerHTML = `<div class="empty-note">No users found.</div>`; return; }
    wrap.innerHTML = snap.docs.map((d) => renderUserCard({ id: d.id, ...d.data() })).join("");
    wireUserActionButtons(wrap, loadRecentUsers);
  } catch (err) {
    console.error("loadRecentUsers error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load — ${esc(err.message)}. (If this is a missing-index error, click the link Firestore gives you.)</div>`;
  }
}

async function searchUsers(term) {
  const wrap = document.getElementById("usersList");
  if (!term) { loadRecentUsers(); return; }
  wrap.innerHTML = `<div class="skel"></div>`;
  try {
    const snap = await db.collection(COLLECTIONS.users).orderBy("fullName").startAt(term).endAt(term + "\uf8ff").limit(20).get();
    if (snap.empty) { wrap.innerHTML = `<div class="empty-note">No users named "${esc(term)}".</div>`; return; }
    wrap.innerHTML = snap.docs.map((d) => renderUserCard({ id: d.id, ...d.data() })).join("");
    wireUserActionButtons(wrap, () => searchUsers(term));
  } catch (err) {
    console.error("searchUsers error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't search — ${esc(err.message)}</div>`;
  }
}

function renderUserCard(u) {
  const status = u.banned ? { label: "Banned", cls: "status-pill--banned" } : u.suspended ? { label: "Suspended", cls: "status-pill--suspended" } : { label: "Active", cls: "status-pill--active" };
  return `
    <div class="card" data-user-id="${u.id}">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(u.fullName || "(no name on file)")}</div>
          <div class="card-sub" style="font-size:11px;">${u.id}</div>
        </div>
        <span class="status-pill ${status.cls}">${status.label}</span>
      </div>
      <div class="kv-row"><span class="k">Email</span><span class="v">${esc(u.email || "—")}</span></div>
      <div class="kv-row"><span class="k">Phone</span><span class="v">${esc(u.phone || "—")}</span></div>
      <div class="kv-row"><span class="k">Account Type</span><span class="v">${esc(u.accountType || "—")}${u.businessName ? " · " + esc(u.businessName) : ""}</span></div>
      <div class="kv-row"><span class="k">Email Verified</span><span class="v">${u.emailVerified ? "Yes" : "No"}</span></div>
      <div class="kv-row"><span class="k">Plan</span><span class="v">${esc(u.plan || "free")}</span></div>
      <div class="kv-row"><span class="k">Registered</span><span class="v">${fmtDate(u.createdAt)}</span></div>
      <div class="kv-row"><span class="k">Last Active</span><span class="v">${fmtDate(u.lastActiveAt)}</span></div>
      <div class="btn-row">
        <button class="btn-sm btn-sm--outline" data-warn-user="${u.id}">Warn</button>
        ${u.suspended || u.banned
          ? `<button class="btn-sm btn-sm--approve" data-restore-user="${u.id}">Restore</button>`
          : `<button class="btn-sm btn-sm--reject" data-suspend-user="${u.id}">Suspend</button>`}
        <button class="btn-sm btn-sm--reject" data-ban-user="${u.id}">Ban</button>
      </div>
    </div>`;
}

function wireUserActionButtons(wrap, refreshFn) {
  wrap.querySelectorAll("[data-warn-user]").forEach((btn) => {
    btn.addEventListener("click", () => openReasonModal("Warn User", "They'll get a notification.", async (reason) => {
      await warnUser(btn.dataset.warnUser, reason); showToast("Warning sent.");
    }));
  });
  wrap.querySelectorAll("[data-suspend-user]").forEach((btn) => {
    btn.addEventListener("click", () => openReasonModal("Suspend User", "They'll be notified. Note: this marks the account — actual sign-in blocking needs auth-guard.js support that isn't wired up yet.", async (reason) => {
      await suspendUser(btn.dataset.suspendUser, reason); showToast("User suspended."); refreshFn();
    }));
  });
  wrap.querySelectorAll("[data-ban-user]").forEach((btn) => {
    btn.addEventListener("click", () => openReasonModal("Ban User", "Severe action. Same enforcement caveat as Suspend.", async (reason) => {
      await banUser(btn.dataset.banUser, reason); showToast("User banned."); refreshFn();
    }));
  });
  wrap.querySelectorAll("[data-restore-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try { await restoreUser(btn.dataset.restoreUser, "Restored by admin"); showToast("User restored."); refreshFn(); }
      catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
    });
  });
}

/* ---------- from admin-learning.js ---------- */
/* ==========================================================================
   admin-learning.js
   Uses the exact lessons/{lessonId} schema already defined in
   billing.js/trustsafety-core.js's comments and read by learning.js:
   title, description, category, durationMinutes, order, contentUrl,
   thumbnailUrl, isPublished, createdAt. No new fields invented.
   Note: the original spec's "Difficulty" field doesn't exist in that
   established schema — omitted rather than silently added, since
   learning.js doesn't know about it either and it would just be dead data.
   ========================================================================== */
const LESSON_CLOUDINARY_CLOUD_NAME = "YOUR_CLOUDINARY_CLOUD_NAME";
const LESSON_CLOUDINARY_UPLOAD_PRESET = "YOUR_UNSIGNED_UPLOAD_PRESET";
let editingLessonId = null;
let lessonThumbnailFile = null;

function init_learning(firstLoad) {
  if (firstLoad) {
    document.getElementById("newLessonBtn").addEventListener("click", () => openLessonModal(null));
    document.getElementById("closeLessonModal").addEventListener("click", () => document.getElementById("lessonModal").classList.remove("open"));
    document.getElementById("lessonThumbnailInput").addEventListener("change", (e) => {
      lessonThumbnailFile = e.target.files[0];
      if (lessonThumbnailFile) {
        const img = document.getElementById("lessonThumbnailPreview");
        img.src = URL.createObjectURL(lessonThumbnailFile);
        img.style.display = "block";
      }
    });
    document.getElementById("saveLessonBtn").addEventListener("click", saveLesson);
  }
  loadLessons();
}

async function loadLessons() {
  const wrap = document.getElementById("lessonsList");
  wrap.innerHTML = `<div class="skel"></div>`;
  try {
    const snap = await db.collection(COLLECTIONS.lessons).orderBy("order", "asc").get();
    if (snap.empty) { wrap.innerHTML = `<div class="empty-note">No lessons yet — create the first one.</div>`; return; }

    wrap.innerHTML = snap.docs.map((d) => {
      const l = { id: d.id, ...d.data() };
      return `
        <div class="card" data-lesson-id="${l.id}">
          <div class="card-head">
            <div style="display:flex;gap:12px;">
              ${l.thumbnailUrl ? `<img src="${l.thumbnailUrl}" style="width:50px;height:50px;border-radius:10px;object-fit:cover;flex-shrink:0;">` : ""}
              <div>
                <div class="card-title">${esc(l.title)}</div>
                <div class="card-sub">${esc(l.category || "")}${l.durationMinutes ? " · " + l.durationMinutes + " min" : ""} · Order ${l.order ?? "—"}</div>
              </div>
            </div>
            <span class="status-pill ${l.isPublished ? "status-pill--active" : "status-pill--free"}">${l.isPublished ? "Published" : "Draft"}</span>
          </div>
          <div class="btn-row">
            <button class="btn-sm btn-sm--outline" data-edit-lesson="${l.id}">Edit</button>
            <button class="btn-sm ${l.isPublished ? "btn-sm--reject" : "btn-sm--approve"}" data-toggle-publish="${l.id}">${l.isPublished ? "Unpublish" : "Publish"}</button>
            <button class="btn-sm btn-sm--reject" data-delete-lesson="${l.id}">Delete</button>
          </div>
        </div>`;
    }).join("");

    wrap.querySelectorAll("[data-edit-lesson]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const doc = await db.collection(COLLECTIONS.lessons).doc(btn.dataset.editLesson).get();
        openLessonModal({ id: doc.id, ...doc.data() });
      });
    });
    wrap.querySelectorAll("[data-toggle-publish]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const isPublished = btn.textContent.trim() === "Unpublish";
        try {
          await db.collection(COLLECTIONS.lessons).doc(btn.dataset.togglePublish).update({ isPublished: !isPublished });
          showToast(isPublished ? "Unpublished." : "Published.");
          loadLessons();
        } catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
      });
    });
    wrap.querySelectorAll("[data-delete-lesson]").forEach((btn) => {
      btn.addEventListener("click", () => openReasonModal("Delete Lesson", "This can't be undone. Enter a short note for the log.", async (reason) => {
        await db.collection(COLLECTIONS.lessons).doc(btn.dataset.deleteLesson).delete();
        await db.collection(COLLECTIONS.moderationLogs).add({
          adminUid: auth.currentUser.uid, action: "delete_lesson", reason,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast("Lesson deleted.");
        loadLessons();
      }));
    });
  } catch (err) {
    console.error("loadLessons error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load lessons — ${esc(err.message)}</div>`;
  }
}

function openLessonModal(lesson) {
  editingLessonId = lesson ? lesson.id : null;
  lessonThumbnailFile = null;
  document.getElementById("lessonModalTitle").textContent = lesson ? "Edit Lesson" : "New Lesson";
  document.getElementById("lessonTitle").value = lesson ? lesson.title || "" : "";
  document.getElementById("lessonCategory").value = lesson ? lesson.category || "" : "";
  document.getElementById("lessonDescription").value = lesson ? lesson.description || "" : "";
  document.getElementById("lessonContentUrl").value = lesson ? lesson.contentUrl || "" : "";
  document.getElementById("lessonDuration").value = lesson ? lesson.durationMinutes || "" : "";
  document.getElementById("lessonOrder").value = lesson ? (lesson.order ?? "") : "";
  document.getElementById("lessonPublished").checked = lesson ? !!lesson.isPublished : false;
  const preview = document.getElementById("lessonThumbnailPreview");
  if (lesson && lesson.thumbnailUrl) { preview.src = lesson.thumbnailUrl; preview.style.display = "block"; }
  else { preview.style.display = "none"; }
  document.getElementById("lessonThumbnailInput").value = "";
  document.getElementById("lessonModal").classList.add("open");
}

async function saveLesson() {
  const title = document.getElementById("lessonTitle").value.trim();
  if (!title) { showToast("Title is required.", "error"); return; }

  const btn = document.getElementById("saveLessonBtn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    let thumbnailUrl = document.getElementById("lessonThumbnailPreview").style.display === "block" ? document.getElementById("lessonThumbnailPreview").src : null;
    if (lessonThumbnailFile) {
      if (LESSON_CLOUDINARY_CLOUD_NAME === "YOUR_CLOUDINARY_CLOUD_NAME") throw new Error("Cloudinary isn't configured — set LESSON_CLOUDINARY_CLOUD_NAME/PRESET in admin-learning.js.");
      const fd = new FormData();
      fd.append("file", lessonThumbnailFile);
      fd.append("upload_preset", LESSON_CLOUDINARY_UPLOAD_PRESET);
      fd.append("folder", "neilnest/lesson-thumbnails");
      const res = await fetch(`https://api.cloudinary.com/v1_1/${LESSON_CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Thumbnail upload failed.");
      thumbnailUrl = (await res.json()).secure_url;
    }

    const data = {
      title, category: document.getElementById("lessonCategory").value.trim(),
      description: document.getElementById("lessonDescription").value.trim(),
      contentUrl: document.getElementById("lessonContentUrl").value.trim(),
      durationMinutes: Number(document.getElementById("lessonDuration").value) || null,
      order: Number(document.getElementById("lessonOrder").value) || 0,
      thumbnailUrl, isPublished: document.getElementById("lessonPublished").checked
    };

    if (editingLessonId) {
      await db.collection(COLLECTIONS.lessons).doc(editingLessonId).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection(COLLECTIONS.lessons).add(data);
    }

    document.getElementById("lessonModal").classList.remove("open");
    showToast("Lesson saved.");
    loadLessons();
  } catch (err) {
    console.error("saveLesson error:", err);
    showToast(err.message || "Couldn't save lesson.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Lesson";
  }
}

/* ---------- from admin-misc.js ---------- */
/* ==========================================================================
   admin-misc.js — Featured Content, Notifications, Moderation Logs

   FEATURED CONTENT — important gap to know about: this section can pin/
   unpin a product for real (writes featuredHome/featuredDirectory to
   Firestore, persists, is readable by anyone). What it does NOT do yet is
   make home.html or directory.html actually DISPLAY a featured section —
   I don't have those two files open in this pass to add that UI. The data
   layer is real; the consuming UI on Home/Directory isn't wired up yet.
   ========================================================================== */

function init_featured(firstLoad) {
  if (firstLoad) {
    document.getElementById("featuredSearchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") searchForFeaturing(e.target.value.trim()); });
  }
  loadCurrentlyFeatured();
}

async function loadCurrentlyFeatured() {
  const wrap = document.getElementById("currentFeaturedList");
  wrap.innerHTML = `<div class="skel"></div>`;
  const queries = [
    ["Featured products (Home)", db.collectionGroup(COLLECTIONS.products).where("featuredHome", "==", true).get()],
    ["Featured products (Directory)", db.collectionGroup(COLLECTIONS.products).where("featuredDirectory", "==", true).get()],
    ["Featured services (Home)", db.collectionGroup(COLLECTIONS.services).where("featuredHome", "==", true).get()],
    ["Featured services (Directory)", db.collectionGroup(COLLECTIONS.services).where("featuredDirectory", "==", true).get()],
    ["Featured businesses", db.collection(COLLECTIONS.businesses).where("featuredHome", "==", true).get()]
  ];
  const results = await Promise.allSettled(queries.map((q) => q[1]));
  const failed = results.map((r, i) => ({ label: queries[i][0], r })).filter((x) => x.r.status === "rejected");

  if (failed.length) {
    console.error("loadCurrentlyFeatured — failing queries:", failed.map((f) => `${f.label}: ${f.r.reason.message}`));
    wrap.innerHTML = `<div class="empty-note">Couldn't load: ${failed.map((f) => esc(f.label)).join(", ")} — ${esc(failed[0].r.reason.message)}. Check the browser console for the full list; this usually means the deployed Firestore rules don't match what's expected (confirm you clicked <strong>Publish</strong> in the Firebase console). If it instead mentions a missing index, click the link Firestore provides to create it.</div>`;
    return;
  }

  const [homeSnap, dirSnap, homeSvcSnap, dirSvcSnap, bizHomeSnap] = results.map((r) => r.value);
  try {
    const map = new Map();
    homeSnap.docs.forEach((d) => map.set(d.ref.path, { ref: d.ref, data: d.data() }));
    dirSnap.docs.forEach((d) => map.set(d.ref.path, { ref: d.ref, data: d.data() }));
    homeSvcSnap.docs.forEach((d) => map.set(d.ref.path, { ref: d.ref, data: d.data() }));
    dirSvcSnap.docs.forEach((d) => map.set(d.ref.path, { ref: d.ref, data: d.data() }));

    const bizCardsHtml = bizHomeSnap.docs.map((d) => `
      <div class="card">
        <div class="card-head">
          <div class="card-title">${esc(d.data().name)} <span style="color:#7a7a7a;font-weight:600;">(Business)</span></div>
          <div><span class="status-pill status-pill--featured">Home</span></div>
        </div>
        <div class="btn-row">
          <button class="btn-sm btn-sm--reject" data-unfeature-business="${d.ref.path}">Remove from Featured</button>
        </div>
      </div>`).join("");

    const itemCardsHtml = Array.from(map.values()).map(({ ref, data }) => `
      <div class="card">
        <div class="card-head">
          <div class="card-title">${esc(data.name)}</div>
          <div>
            ${data.featuredHome ? `<span class="status-pill status-pill--featured">Home</span>` : ""}
            ${data.featuredDirectory ? `<span class="status-pill status-pill--featured">Directory</span>` : ""}
          </div>
        </div>
        <div class="btn-row">
          <button class="btn-sm btn-sm--reject" data-unfeature-path="${ref.path}">Remove from Featured</button>
        </div>
      </div>`).join("");

    if (!bizCardsHtml && !itemCardsHtml) { wrap.innerHTML = `<div class="empty-note">Nothing featured yet.</div>`; return; }
    wrap.innerHTML = bizCardsHtml + itemCardsHtml;

    wrap.querySelectorAll("[data-unfeature-path]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await db.doc(btn.dataset.unfeaturePath).set({ featuredHome: false, featuredDirectory: false }, { merge: true });
          showToast("Removed from Featured.");
          loadCurrentlyFeatured();
        } catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
      });
    });
    wrap.querySelectorAll("[data-unfeature-business]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await db.doc(btn.dataset.unfeatureBusiness).set({ featuredHome: false }, { merge: true });
          showToast("Removed from Featured.");
          loadCurrentlyFeatured();
        } catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
      });
    });
  } catch (err) {
    console.error("loadCurrentlyFeatured error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load — ${esc(err.message)}. If this mentions a missing index, click the link Firestore provides to create it (collection-group index on 'products'/'services' for featuredHome/featuredDirectory).</div>`;
  }
}

async function searchForFeaturing(term) {
  const heading = document.getElementById("featuredSearchResultsHeading");
  const wrap = document.getElementById("featuredSearchResults");
  if (!term) { heading.style.display = "none"; wrap.innerHTML = ""; return; }
  heading.style.display = "block";
  wrap.innerHTML = `<div class="skel"></div>`;
  try {
    const bizSnap = await db.collection(COLLECTIONS.businesses).orderBy("name").startAt(term).endAt(term + "\uf8ff").limit(5).get();
    if (bizSnap.empty) { wrap.innerHTML = `<div class="empty-note">No businesses match "${esc(term)}".</div>`; return; }

    const groups = await Promise.all(bizSnap.docs.map(async (bizDoc) => {
      const [productsSnap, servicesSnap] = await Promise.all([
        bizDoc.ref.collection(COLLECTIONS.products).get(),
        bizDoc.ref.collection(COLLECTIONS.services).get()
      ]);
      const items = [
        ...productsSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })),
        ...servicesSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
      ];
      return { business: bizDoc.data(), businessRef: bizDoc.ref, items };
    }));

    wrap.innerHTML = groups.map((g) => `
      <div style="margin-bottom:14px;">
        <div style="font-size:12px;font-weight:800;color:#e0a83c;margin-bottom:8px;display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>${esc(g.business.name)}</span>
          <button class="btn-sm ${g.business.featuredHome ? "btn-sm--reject" : "btn-sm--gold"}" data-toggle-business="${g.businessRef.path}">${g.business.featuredHome ? "Unfeature Business" : "Feature Business on Home"}</button>
        </div>
        ${g.items.map((p) => `
          <div class="card" data-item-path="${p.ref.path}">
            <div class="card-head"><div class="card-title">${esc(p.name)}</div></div>
            <div class="btn-row">
              <button class="btn-sm ${p.featuredHome ? "btn-sm--reject" : "btn-sm--gold"}" data-toggle-home="${p.ref.path}">${p.featuredHome ? "Unpin from Home" : "Pin to Home"}</button>
              <button class="btn-sm ${p.featuredDirectory ? "btn-sm--reject" : "btn-sm--gold"}" data-toggle-directory="${p.ref.path}">${p.featuredDirectory ? "Unpin from Directory" : "Pin to Directory"}</button>
            </div>
          </div>`).join("") || `<div class="empty-note">No products or services yet.</div>`}
      </div>`).join("");

    wrap.querySelectorAll("[data-toggle-business]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const willFeature = btn.textContent.includes("Feature Business");
        try { await db.doc(btn.dataset.toggleBusiness).set({ featuredHome: willFeature }, { merge: true }); showToast(willFeature ? "Business featured on Home." : "Business unfeatured."); searchForFeaturing(term); loadCurrentlyFeatured(); }
        catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
      });
    });
    wrap.querySelectorAll("[data-toggle-home]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const willFeature = btn.textContent.includes("Pin to");
        try { await db.doc(btn.dataset.toggleHome).set({ featuredHome: willFeature }, { merge: true }); showToast(willFeature ? "Pinned to Home." : "Unpinned."); searchForFeaturing(term); loadCurrentlyFeatured(); }
        catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
      });
    });
    wrap.querySelectorAll("[data-toggle-directory]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const willFeature = btn.textContent.includes("Pin to");
        try { await db.doc(btn.dataset.toggleDirectory).set({ featuredDirectory: willFeature }, { merge: true }); showToast(willFeature ? "Pinned to Directory." : "Unpinned."); searchForFeaturing(term); loadCurrentlyFeatured(); }
        catch (err) { showToast(err.message || "Failed.", "error"); btn.disabled = false; }
      });
    });
  } catch (err) {
    console.error("searchForFeaturing error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't search — ${esc(err.message)}</div>`;
  }
}

/* ---------------------------------------------------------------------
   Notifications
--------------------------------------------------------------------- */
function init_notifications(firstLoad) {
  if (!firstLoad) return;
  document.getElementById("notifyTarget").addEventListener("change", (e) => {
    document.getElementById("notifyUidWrap").style.display = e.target.value === "user" ? "block" : "none";
    document.getElementById("notifyPlanWrap").style.display = e.target.value === "plan" ? "block" : "none";
  });
  document.getElementById("sendNotifyBtn").addEventListener("click", sendAdminNotification);
}

async function sendAdminNotification() {
  const target = document.getElementById("notifyTarget").value;
  const title = document.getElementById("notifyTitle").value.trim();
  const body = document.getElementById("notifyBody").value.trim();
  if (!title || !body) { showToast("Title and message are required.", "error"); return; }

  const btn = document.getElementById("sendNotifyBtn");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    if (target === "user") {
      const uid = document.getElementById("notifyUid").value.trim();
      if (!uid) throw new Error("Enter a user UID.");
      await db.collection(COLLECTIONS.notifications).add({ recipientUid: uid, title, body, link: null, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      showToast("Notification sent.");
    } else {
      const plan = document.getElementById("notifyPlan").value;
      const usersSnap = await db.collection(COLLECTIONS.users).where("plan", "==", plan).limit(500).get();
      if (usersSnap.empty) { showToast(`No users on the ${plan} plan.`, "error"); return; }
      const batch = db.batch();
      usersSnap.docs.forEach((d) => {
        batch.set(db.collection(COLLECTIONS.notifications).doc(), { recipientUid: d.id, title, body, link: null, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();
      showToast(`Sent to ${usersSnap.size} user(s)${usersSnap.size === 500 ? " (capped at 500 per send)" : ""}.`);
    }
    document.getElementById("notifyTitle").value = "";
    document.getElementById("notifyBody").value = "";
  } catch (err) {
    console.error("sendAdminNotification error:", err);
    showToast(err.message || "Couldn't send.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send";
  }
}

/* ---------------------------------------------------------------------
   Moderation Logs
--------------------------------------------------------------------- */
let logsActionFilter = "all";
let logsLastDoc = null;
const LOGS_PAGE_SIZE = 25;

function init_logs(firstLoad) {
  if (firstLoad) {
    document.getElementById("logsFilter").addEventListener("click", (e) => {
      const chip = e.target.closest(".filter-chip");
      if (!chip) return;
      document.querySelectorAll("#logsFilter .filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      logsActionFilter = chip.dataset.action;
      logsLastDoc = null;
      loadLogs(false);
    });
    document.getElementById("logsLoadMoreBtn").addEventListener("click", () => loadLogs(true));
  }
  logsLastDoc = null;
  loadLogs(false);
}

async function loadLogs(append) {
  const wrap = document.getElementById("logsList");
  const moreBtn = document.getElementById("logsLoadMoreBtn");
  if (!append) wrap.innerHTML = `<div class="skel"></div>`;
  try {
    let q = db.collection(COLLECTIONS.moderationLogs).orderBy("createdAt", "desc").limit(LOGS_PAGE_SIZE);
    if (logsActionFilter !== "all") q = db.collection(COLLECTIONS.moderationLogs).where("action", "==", logsActionFilter).orderBy("createdAt", "desc").limit(LOGS_PAGE_SIZE);
    if (append && logsLastDoc) q = q.startAfter(logsLastDoc);

    const snap = await q.get();
    if (snap.empty && !append) { wrap.innerHTML = `<div class="empty-note">No log entries.</div>`; moreBtn.style.display = "none"; return; }

    logsLastDoc = snap.docs[snap.docs.length - 1] || logsLastDoc;
    moreBtn.style.display = snap.size === LOGS_PAGE_SIZE ? "block" : "none";

    const html = snap.docs.map((d) => {
      const l = d.data();
      return `
        <div class="card">
          <div class="card-head">
            <div class="card-title" style="font-size:12.5px;">${esc(l.action)}</div>
            <div style="font-size:11px;color:#6e6e6e;">${fmtDate(l.createdAt)}</div>
          </div>
          <div class="kv-row"><span class="k">Admin</span><span class="v" style="font-size:11px;">${esc(l.adminUid)}</span></div>
          ${l.businessId ? `<div class="kv-row"><span class="k">Business</span><span class="v"><a href="business-profile.html?id=${l.businessId}" style="color:#e0a83c;">View →</a></span></div>` : ""}
          ${l.targetUid ? `<div class="kv-row"><span class="k">Target User</span><span class="v" style="font-size:11px;">${esc(l.targetUid)}</span></div>` : ""}
          ${l.previousStatus || l.newStatus ? `<div class="kv-row"><span class="k">Status Change</span><span class="v">${esc(l.previousStatus || "—")} → ${esc(l.newStatus || "—")}</span></div>` : ""}
          ${l.reason ? `<div class="desc-block">${esc(l.reason)}</div>` : ""}
        </div>`;
    }).join("");

    if (append) wrap.insertAdjacentHTML("beforeend", html);
    else wrap.innerHTML = html;
  } catch (err) {
    console.error("loadLogs error:", err);
    wrap.innerHTML = `<div class="empty-note">Couldn't load logs — ${esc(err.message)}</div>`;
  }
}

