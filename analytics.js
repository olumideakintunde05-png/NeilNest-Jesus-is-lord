/* ==========================================================================
   analytics.js — NeilNest Analytics (Pro/Business gated)
   Requires: firebase-init.js, auth-guard.js, billing.js
   Reads the counters written by trackAnalyticsEvent() in billing.js, which
   business-profile.js and messages.js call on real page views, contact
   clicks, and customer messages.
   ========================================================================== */

let CURRENT_USER = null;
let BUSINESS_ID = null;

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

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("backBtn").addEventListener("click", () => history.back());

  CURRENT_USER = await Promise.race([
    waitForAuthUser(),
    new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 8000))
  ]);
  if (CURRENT_USER === "TIMEOUT" || !CURRENT_USER) {
    window.location.href = "signin.html?redirect=analytics.html" + window.location.search;
    return;
  }

  const params = new URLSearchParams(window.location.search);
  BUSINESS_ID = params.get("businessId");

  try {
    if (!BUSINESS_ID) {
      const snap = await db.collection(COLLECTIONS.businesses).where("ownerUid", "==", CURRENT_USER.uid).limit(1).get();
      if (snap.empty) { showToast("You need a business profile first.", "error"); window.location.href = "business-profile.html"; return; }
      BUSINESS_ID = snap.docs[0].id;
    }

    const bizSnap = await db.collection(COLLECTIONS.businesses).doc(BUSINESS_ID).get();
    if (!bizSnap.exists || bizSnap.data().ownerUid !== CURRENT_USER.uid) {
      showToast("You don't have access to this business's analytics.", "error");
      window.location.href = "business-profile.html";
      return;
    }
    const business = bizSnap.data();

    const extras = await getAccountExtras(CURRENT_USER.uid);
    if (PLAN_RANK[extras.plan] < PLAN_RANK.pro) {
      document.getElementById("lockedState").style.display = "block";
    } else {
      document.getElementById("dashboardState").style.display = "block";
      await Promise.all([
        renderSummary(business),
        renderChart(),
        renderTopProducts()
      ]);
    }

    document.getElementById("appShell").style.opacity = "1";
    document.getElementById("appShell").style.pointerEvents = "auto";
  } catch (err) {
    console.error("Analytics load error:", err);
    showToast("Couldn't load analytics. Check your connection.", "error");
    document.getElementById("appShell").style.opacity = "1";
    document.getElementById("appShell").style.pointerEvents = "auto";
  }
});

/* ---------------------------------------------------------------------
   Summary cards
--------------------------------------------------------------------- */
function renderSummary(business) {
  const stats = business.stats || {};
  const cards = [
    { label: "Profile Views", value: stats.viewsTotal || 0, path: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
    { label: "WhatsApp Clicks", value: stats.whatsappClicksTotal || 0, path: "M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20l1-5.4A8.5 8.5 0 1 1 21 11.5z" },
    { label: "Call Clicks", value: stats.callClicksTotal || 0, path: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.4 2.1L8.1 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.9 2.2z" },
    { label: "Website Clicks", value: stats.websiteClicksTotal || 0, path: "M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z" },
    { label: "Messages Received", value: stats.messagesReceivedTotal || 0, path: "M4 4h16v12H8l-4 4V4z" },
    { label: "Followers", value: business.followersCount || 0, path: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" }
  ];
  document.getElementById("summaryGrid").innerHTML = cards.map((c) => `
    <div class="summary-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${c.path}"/></svg></div>
      <div class="num">${c.value.toLocaleString()}</div>
      <div class="lbl">${c.label}</div>
    </div>`).join("");
}

/* ---------------------------------------------------------------------
   7-day views chart — dailyStats doc ids are YYYY-MM-DD, so this is
   7 direct .doc(id).get() reads, no range query or index needed.
--------------------------------------------------------------------- */
async function renderChart() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const reads = await Promise.all(days.map((d) => {
    const key = d.toISOString().slice(0, 10);
    return db.collection(COLLECTIONS.businesses).doc(BUSINESS_ID).collection("dailyStats").doc(key).get();
  }));

  const values = reads.map((snap) => (snap.exists && snap.data().views) || 0);
  const max = Math.max(...values, 1);

  document.getElementById("chartBars").innerHTML = days.map((d, i) => {
    const heightPct = Math.max((values[i] / max) * 100, 3);
    return `
      <div class="chart-bar-col">
        <span class="chart-bar-value">${values[i]}</span>
        <div class="chart-bar" style="height:${heightPct}%;"></div>
        <span class="chart-bar-label">${d.toLocaleDateString([], { weekday: "short" })}</span>
      </div>`;
  }).join("");
}

/* ---------------------------------------------------------------------
   Top products by view count
--------------------------------------------------------------------- */
async function renderTopProducts() {
  const snap = await db.collection(COLLECTIONS.businesses).doc(BUSINESS_ID).collection(COLLECTIONS.products)
    .orderBy("viewsCount", "desc").limit(5).get();

  const wrap = document.getElementById("topProductsWrap");
  if (snap.empty) { wrap.innerHTML = `<div class="empty-note">No products yet.</div>`; return; }

  const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (products.every((p) => !(p.viewsCount > 0))) {
    wrap.innerHTML = `<div class="empty-note">No product views yet.</div>`;
    return;
  }

  wrap.innerHTML = products.map((p) => `
    <div class="product-row">
      ${p.images && p.images[0] ? `<img src="${p.images[0]}" alt="">` : `<div class="ph"></div>`}
      <div>
        <div class="p-name">${esc(p.name)}</div>
        <div class="p-views">₦${(p.price || 0).toLocaleString()}</div>
      </div>
      <div class="p-count">${(p.viewsCount || 0).toLocaleString()}<div style="font-size:9.5px;font-weight:600;color:#6e6e6e;">views</div></div>
    </div>`).join("");
}
