/* ==========================================================================
   trust-safety.js — NeilNest Trust & Safety page
   Requires: firebase-init.js, auth-guard.js, billing.js, trustsafety-core.js
   ========================================================================== */

let CURRENT_USER = null;

function esc(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("backBtn").addEventListener("click", () => history.back());
  bindTabs();
  renderSafetyTips();
  renderMarketplaceRules();
  renderFAQ();

  CURRENT_USER = await Promise.race([
    waitForAuthUser(),
    new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 8000))
  ]);
  if (CURRENT_USER === "TIMEOUT" || !CURRENT_USER) {
    window.location.href = "signin.html?redirect=trust-safety.html";
    return;
  }

  loadMyReports();
  loadBlockedBusinesses();

  document.getElementById("appShell").style.opacity = "1";
  document.getElementById("appShell").style.pointerEvents = "auto";
});

function bindTabs() {
  document.getElementById("tabBar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
  });
}

/* ---------------------------------------------------------------------
   Static content
--------------------------------------------------------------------- */
function renderSafetyTips() {
  const tips = [
    { title: "Meet in safe, public places", desc: "For local pickups, choose busy, well-lit locations — and let someone know where you're going.", path: "M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z" },
    { title: "Inspect before you pay", desc: "Check the product matches photos and description before handing over money.", path: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
    { title: "Be wary of deals that seem too good", desc: "Unusually low prices for in-demand items are a common scam pattern.", path: "M12 2l3 6 6.5 1-4.7 4.6L18 20l-6-3.4L6 20l1.2-6.4L2.5 9l6.5-1 3-6z" },
    { title: "Keep communication on NeilNest", desc: "Our chat keeps a record. Deals pushed off-platform are harder to trace if something goes wrong.", path: "M4 4h16v12H8l-4 4V4z" },
    { title: "Check the badges, but verify anyway", desc: "Verified and Trusted Seller badges help, but always use your own judgment before paying.", path: "M12 2l2.4 4.8 5.3.8-3.85 3.75.9 5.3L12 14.2l-4.75 2.45.9-5.3L4.3 7.6l5.3-.8z" },
    { title: "Report anything suspicious", desc: "Reporting helps us investigate and protect other buyers and sellers.", path: "M12 9v4M12 17h.01M10.3 3.9L2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" }
  ];
  document.getElementById("panel-tips").innerHTML = tips.map((t) => `
    <div class="safety-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${t.path}"/></svg></div>
      <div class="sc-title">${t.title}</div>
      <div class="sc-desc">${t.desc}</div>
    </div>`).join("") + `
    <div class="safety-card" style="border-color:rgba(224,168,60,0.25);">
      <div class="sc-title">How to spot a scam</div>
      <div class="sc-desc">Pressure to pay immediately, refusal to meet or video call, requests for payment outside NeilNest, prices far below market value, and sellers with no reviews or activity are all red flags. Trust your instincts — if something feels off, don't proceed.</div>
    </div>`;
}

function renderMarketplaceRules() {
  const rules = [
    "Every listing must accurately represent the product or service being offered.",
    "No counterfeit, stolen, or illegal items may be listed.",
    "Businesses must respond to buyer messages honestly and in good faith.",
    "No harassment, threats, or abusive language toward other users.",
    "No requesting or sharing another person's private information without consent.",
    "No spam, repeated duplicate listings, or manipulating views/ratings.",
    "Payments happen directly between buyer and seller — NeilNest is not a party to the transaction.",
    "Violating these rules can result in a warning, suspension, or permanent ban."
  ];
  document.getElementById("panel-rules").innerHTML = `
    <div class="safety-card">
      ${rules.map((r, i) => `<div class="rule-row"><span class="num">${i + 1}</span><span class="txt">${r}</span></div>`).join("")}
    </div>`;
}

function renderFAQ() {
  const faqs = [
    { q: "Does NeilNest process payments?", a: "No. NeilNest is a directory that connects buyers and sellers. All payments happen directly between the two parties — NeilNest never holds or processes funds." },
    { q: "What does the Verified badge mean?", a: "Verified means the business has an active Pro (with the verification add-on) or Business subscription and was approved during payment review. It is not a guarantee of product quality or conduct." },
    { q: "What does Trusted Seller mean?", a: "Trusted Seller is awarded manually by a NeilNest administrator after reviewing a business's activity, reviews, and history. It's optional and can be removed at any time." },
    { q: "What happens after I report someone?", a: "Your report is saved and reviewed. If a business receives multiple reports, it's automatically flagged for investigation — nothing is removed or suspended automatically." },
    { q: "Can I get my money back if I get scammed?", a: "NeilNest doesn't process payments, so we can't reverse a bank transfer. Report the business immediately so we can investigate and protect other users." },
    { q: "How do I block someone?", a: "Open your conversation with them in Messages, tap the menu (⋮), and choose Block User. You can manage all blocked businesses from the Blocked tab above." }
  ];
  document.getElementById("panel-faq").innerHTML = faqs.map((f, i) => `
    <div class="faq-item" data-idx="${i}">
      <div class="faq-q">${f.q}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></div>
      <div class="faq-a"><p>${f.a}</p></div>
    </div>`).join("");
  document.getElementById("panel-faq").addEventListener("click", (e) => {
    const item = e.target.closest(".faq-item");
    if (item) item.classList.toggle("open");
  });
}

/* ---------------------------------------------------------------------
   My Reports — merged from businessReports, productReports, userReports
--------------------------------------------------------------------- */
async function loadMyReports() {
  const panel = document.getElementById("panel-reports");
  try {
    const [biz, prod, user] = await Promise.all([
      db.collection(COLLECTIONS.businessReports).where("reporterUid", "==", CURRENT_USER.uid).get(),
      db.collection(COLLECTIONS.productReports).where("reporterUid", "==", CURRENT_USER.uid).get(),
      db.collection(COLLECTIONS.userReports).where("reporterUid", "==", CURRENT_USER.uid).get()
    ]);

    const all = [
      ...biz.docs.map((d) => ({ id: d.id, type: "Business", ...d.data() })),
      ...prod.docs.map((d) => ({ id: d.id, type: "Product", ...d.data() })),
      ...user.docs.map((d) => ({ id: d.id, type: "User", ...d.data() }))
    ].sort((a, b) => (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0));

    if (all.length === 0) {
      panel.innerHTML = `<div class="empty-note">You haven't submitted any reports.</div>`;
      return;
    }

    const iconPath = { Business: "M4 21V7a2 2 0 0 1 2-2h4V3h4v2h4a2 2 0 0 1 2 2v14M9 21v-4h6v4", Product: "M20 7l-8-4-8 4m16 0v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4", User: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" };

    panel.innerHTML = all.map((r) => `
      <div class="report-item">
        <div class="r-type"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${iconPath[r.type]}"/></svg></div>
        <div class="r-body">
          <div class="r-reason">${esc(r.reason)}</div>
          <div class="r-meta">${r.type}${r.targetName ? " · " + esc(r.targetName) : ""} · ${fmtDate(r.createdAt)}</div>
        </div>
        <span class="r-status r-status--${r.status}">${r.status}</span>
      </div>`).join("");
  } catch (err) {
    console.error("loadMyReports error:", err);
    panel.innerHTML = `<div class="empty-note">Couldn't load your reports.</div>`;
  }
}

/* ---------------------------------------------------------------------
   Blocked businesses
--------------------------------------------------------------------- */
async function loadBlockedBusinesses() {
  const panel = document.getElementById("panel-blocked");
  try {
    const items = await listBlockedBusinesses(CURRENT_USER.uid);
    if (items.length === 0) {
      panel.innerHTML = `<div class="empty-note">You haven't blocked anyone.</div>`;
      return;
    }
    panel.innerHTML = items.map((b) => `
      <div class="blocked-item">
        <img src="${b.businessLogo || ""}" alt="" onerror="this.style.background='#1e1e1e'">
        <div class="b-name">${esc(b.businessName)}</div>
        <button class="unblock-btn" data-id="${b.id}" data-owner="${b.ownerUid || ""}">Unblock</button>
      </div>`).join("");

    panel.querySelectorAll(".unblock-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await unblockBusiness(btn.dataset.id, btn.dataset.owner || null);
          showToast("Unblocked.");
          loadBlockedBusinesses();
        } catch (err) {
          console.error("unblock error:", err);
          showToast("Couldn't unblock. Try again.", "error");
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    console.error("loadBlockedBusinesses error:", err);
    panel.innerHTML = `<div class="empty-note">Couldn't load blocked businesses.</div>`;
  }
}
