/* ==========================================================================
   billing.js — NeilNest subscription/billing logic, shared across pages.

   Consolidates what would otherwise be plan-manager.js + subscription.js +
   permissions.js + gatekeeper.js into one file: for a vanilla-JS project
   this size, five tiny files importing from each other is more indirection
   than value. Everything here is namespaced so it's still easy to split
   later if the app grows into it.

   Include AFTER firebase-init.js, BEFORE any page script that uses it:
   <script src="firebase-init.js"></script>
   <script src="billing.js"></script>
   ========================================================================== */

/* ---------------------------------------------------------------------
   ⚠️ BANK DETAILS — fill in with your real account before this goes live.
--------------------------------------------------------------------- */
const BANK_DETAILS = {
  bankName: "opay",
  accountName: "Akintunde olumide Daniel",
  accountNumber: "7034352292"
};

/* ⚠️ Fast Support contact — Pro/Business users get direct access to these.
   Fill in your real support email and WhatsApp number. */
const SUPPORT_CONTACT = {
  email: "olumideakintunde84@gmail.com",
  whatsapp: "2349056604227" // digits only, e.g. "2348012345678"
};

/* ---------------------------------------------------------------------
   Plan catalog — static business data, not worth a Firestore round-trip
   on every page load. seedPlansIfMissing() still writes this to the
   `plans` collection so upgrade.html's Firestore integration is real
   and an admin panel can read/override pricing later.
--------------------------------------------------------------------- */
const PLAN_RANK = { free: 0, pro: 1, business: 2 };

/* Every entry below reflects something that actually exists in the app.
   Cut from the original spec because nothing behind them is built yet:
   Featured Listings, AI Business Recommendation, AI Outreach, Advanced/
   Premium Analytics, Priority Ranking, CRM & Lead Management, Priority/
   Premium Support, and the extra social platforms (only whatsapp/website/
   phone/email exist on the business schema). Add them back here once
   they're real — a feature on this page that isn't real anywhere else
   in the product is just a broken promise. */
const PLAN_CATALOG = {
  free: {
    planId: "free", name: "Free", order: 0,
    priceMonthly: 0, priceYearly: 0,
    limits: { businessListings: 1, products: 3, imagesPerProduct: 3 },
    learningHub: false, socialLinks: false,
    features: [
      "1 Business Listing", "Up to 3 Products", "Maximum 3 Images Per Product",
      "WhatsApp Link", "Website Link", "Receive Messages", "Receive Reviews"
    ],
    blocked: ["Business Learning Hub", "Verified Badge", "Social Media Links", "More Products", "More Images Per Product"]
  },
  pro: {
    planId: "pro", name: "Pro", order: 1,
    priceMonthly: 8700, priceYearly: 83520, // 8700 * 12 * 0.8, rounded
    verificationAddon: 2500,
    limits: { businessListings: 1, products: 30, imagesPerProduct: 10 },
    learningHub: true, socialLinks: true,
    features: [
      "1 Business Listing", "Up to 30 Products", "10 Images Per Product",
      "WhatsApp Link", "Website Link", "Receive Messages", "Receive Reviews",
      "Business Learning Hub", "Social Links (Instagram, Facebook, TikTok, LinkedIn, X, YouTube)",
      "Verified Badge (optional add-on)"
    ],
    blocked: []
  },
  business: {
    planId: "business", name: "Business", order: 2,
    priceMonthly: 24900, priceYearly: 239040,
    limits: { businessListings: 1, products: null, imagesPerProduct: null }, // null = unlimited
    learningHub: true, socialLinks: true,
    features: [
      "1 Business Listing", "Unlimited Products", "Unlimited Images Per Product",
      "WhatsApp Link", "Website Link", "Receive Messages", "Receive Reviews",
      "Business Learning Hub", "Social Links (Instagram, Facebook, TikTok, LinkedIn, X, YouTube)",
      "Verified Badge Included"
    ],
    blocked: []
  }
};

async function seedPlansIfMissing() {
  try {
    const snap = await db.collection(COLLECTIONS.plans).limit(1).get();
    if (!snap.empty) return;
    const batch = db.batch();
    Object.values(PLAN_CATALOG).forEach((p) => {
      batch.set(db.collection(COLLECTIONS.plans).doc(p.planId), p);
    });
    await batch.commit();
  } catch (err) {
    console.error("seedPlansIfMissing error:", err);
  }
}

/* ---------------------------------------------------------------------
   Payment reference: NN-YYYYMMDD-XXXXX, checked against Firestore for
   collisions (astronomically unlikely, but this is a payment reference,
   so we check anyway).
--------------------------------------------------------------------- */
function randomRefSuffix() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function generateUniquePaymentReference() {
  const today = new Date();
  const datePart = today.getFullYear().toString()
    + String(today.getMonth() + 1).padStart(2, "0")
    + String(today.getDate()).padStart(2, "0");
  // No live uniqueness check against Firestore here on purpose — querying
  // *other users'* payment docs to check for a collision would need a read
  // rule that exposes everyone's payment details to everyone, which is a
  // worse problem than the near-zero chance of a collision. 32 characters ^
  // 5 slots = ~33.6 million combinations per day, checked against at most a
  // handful of pending payments — this is safe to trust as-is.
  return `NN-${datePart}-${randomRefSuffix()}`;
}

/* ---------------------------------------------------------------------
   Anti-fraud: one pending payment per user at a time.
--------------------------------------------------------------------- */
async function getPendingPayment(uid) {
  const snap = await db.collection(COLLECTIONS.paymentVerifications)
    .where("uid", "==", uid)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/* ---------------------------------------------------------------------
   Save a payment verification request. Never touches `subscriptions` or
   `users.plan` — those only change when an admin approves.
--------------------------------------------------------------------- */
async function submitPaymentVerification(payload) {
  const pending = await getPendingPayment(payload.uid);
  if (pending) {
    throw new Error("You already have a payment under review. Please wait for it to be verified before submitting another.");
  }

  const docData = {
    uid: payload.uid,
    businessId: payload.businessId,
    plan: payload.plan,
    billingCycle: payload.billingCycle,
    verificationAddon: !!payload.verificationAddon,
    badgeOnly: !!payload.badgeOnly,
    amount: payload.amount,
    reference: payload.reference,
    senderName: payload.senderName,
    phone: payload.phone,
    transferDate: payload.transferDate,
    proofImage: payload.proofImage,
    note: payload.note || null,
    status: "pending",
    submittedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const ref = await db.collection(COLLECTIONS.paymentVerifications).add(docData);
  return ref.id;
}

async function getPaymentHistory(uid, max) {
  const snap = await db.collection(COLLECTIONS.paymentVerifications)
    .where("uid", "==", uid)
    .orderBy("submittedAt", "desc")
    .limit(max || 20)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ---------------------------------------------------------------------
   Live account status — same shape as getAccountExtras() in
   firebase-init.js, but as a listener so upgrade.html and the profile
   page update the instant an admin approves/rejects, no refresh needed.
--------------------------------------------------------------------- */
function listenToAccountExtras(uid, callback) {
  return db.collection(COLLECTIONS.users).doc(uid).onSnapshot((snap) => {
    const d = snap.exists ? snap.data() : {};
    callback({
      plan: d.plan || "free",
      planStatus: d.planStatus || "active",
      planExpiresAt: d.planExpiresAt || null,
      planStartedAt: d.planStartedAt || null,
      hasEverSubscribed: !!d.hasEverSubscribed,
      lastLearningHubVisitAt: d.lastLearningHubVisitAt || null,
      learningStats: Object.assign({
        completedLessons: 0, totalLessons: 0, certificatesEarned: 0,
        currentStreak: 0, hasUnfinishedLesson: false
      }, d.learningStats || {})
    });
  }, (err) => console.error("listenToAccountExtras error:", err));
}

/* ---------------------------------------------------------------------
   Analytics — lightweight event counters, no Cloud Functions needed.
   Two writes per event: a running total on the business doc (cheap reads
   for badges/summary cards) and a per-day bucket (for the trend chart on
   analytics.html). Valid types: views, whatsappClicks, callClicks,
   websiteClicks, messagesReceived.
--------------------------------------------------------------------- */
function trackAnalyticsEvent(businessId, type) {
  if (!businessId || !type) return;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const bizRef = db.collection(COLLECTIONS.businesses).doc(businessId);
  bizRef.set({ stats: { [`${type}Total`]: firebase.firestore.FieldValue.increment(1) } }, { merge: true }).catch((err) => console.error("trackAnalyticsEvent (total) error:", err));
  bizRef.collection("dailyStats").doc(today).set({ [type]: firebase.firestore.FieldValue.increment(1), date: today }, { merge: true }).catch((err) => console.error("trackAnalyticsEvent (daily) error:", err));
}

/* ---------------------------------------------------------------------
   Gatekeeper — call this before letting a user use a premium-only
   feature anywhere in the app (featured listing toggle, AI tools, CRM…).
   Blocks and redirects to upgrade.html if their plan isn't high enough,
   or if their subscription isn't active (expired Pro/Business = blocked
   until they renew, same as Free).
--------------------------------------------------------------------- */
async function requirePlan(requiredPlanId, options) {
  options = options || {};
  const user = auth.currentUser;
  if (!user) {
    window.location.href = "signin.html?redirect=" + encodeURIComponent(window.location.pathname);
    return false;
  }

  const extras = await getAccountExtras(user.uid);
  const hasActivePlan = extras.planStatus === "active";
  const meetsRank = PLAN_RANK[extras.plan] >= PLAN_RANK[requiredPlanId];

  if (hasActivePlan && meetsRank) return true;

  if (options.silent) return false;

  const msg = options.message || `This feature needs the ${PLAN_CATALOG[requiredPlanId].name} plan or higher.`;
  if (typeof showToast === "function") showToast(msg, "error");
  else alert(msg);

  setTimeout(() => { window.location.href = "upgrade.html"; }, 900);
  return false;
}

/* ---------------------------------------------------------------------
   Admin approve/reject — real logic for whenever admin.html gets built.
   Firestore rules (see SUBSCRIPTION_LEARNING_SCHEMA.md) enforce that only
   a user with the `admin` custom claim can actually write these; this
   function just gives that future page something real to call instead of
   hand-rolling the batch write again.
--------------------------------------------------------------------- */
async function approvePayment(paymentId) {
  const payRef = db.collection(COLLECTIONS.paymentVerifications).doc(paymentId);
  const paySnap = await payRef.get();
  if (!paySnap.exists) throw new Error("Payment not found.");
  const payment = paySnap.data();
  if (payment.status !== "pending") throw new Error("This payment has already been reviewed.");

  const batch = db.batch();
  batch.update(payRef, { status: "approved", reviewedAt: firebase.firestore.FieldValue.serverTimestamp() });

  // Badge-only purchase (an existing Pro user buying the add-on later,
  // not a plan upgrade/renewal): grant the badge only. Do NOT touch
  // subscriptions/users planExpiresAt — that would silently reset their
  // current plan's remaining time as a side effect of a ₦2,500 add-on.
  if (payment.badgeOnly) {
    if (payment.businessId) {
      batch.set(db.collection(COLLECTIONS.businesses).doc(payment.businessId), { verified: true }, { merge: true });
    }
    await batch.commit();

    await db.collection(COLLECTIONS.notifications).add({
      recipientUid: payment.uid, title: "Verified Badge Activated",
      body: "Your business now has the Verified Badge.",
      link: "business-profile.html", read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection(COLLECTIONS.moderationLogs).add({
      adminUid: auth.currentUser ? auth.currentUser.uid : null, businessId: payment.businessId || null,
      action: "payment_approved", reason: `verified badge (standalone) · ${payment.reference}`,
      previousStatus: "pending", newStatus: "approved",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return;
  }

  const now = firebase.firestore.Timestamp.now();
  const periodDays = payment.billingCycle === "yearly" ? 365 : 30;
  const expiresAt = firebase.firestore.Timestamp.fromMillis(now.toMillis() + periodDays * 24 * 60 * 60 * 1000);

  batch.set(db.collection(COLLECTIONS.subscriptions).doc(payment.uid), {
    uid: payment.uid, plan: payment.plan, status: "active",
    startedAt: firebase.firestore.FieldValue.serverTimestamp(),
    currentPeriodEnd: expiresAt, autoRenew: false,
    amount: payment.amount, currency: "NGN", provider: "bank_transfer",
    providerRef: payment.reference, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  batch.set(db.collection(COLLECTIONS.users).doc(payment.uid), {
    plan: payment.plan, planStatus: "active",
    planExpiresAt: expiresAt, planStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
    hasEverSubscribed: true
  }, { merge: true });

  // Verified badge: Business plan includes it outright; on Pro it only
  // activates if the ₦2,500 add-on was checked and paid for. This is the
  // only place in the app that ever sets `verified: true` — there's no
  // other trigger, so it can't happen any other way.
  const grantsVerification = payment.plan === "business" || (payment.plan === "pro" && payment.verificationAddon === true);
  if (grantsVerification && payment.businessId) {
    batch.set(db.collection(COLLECTIONS.businesses).doc(payment.businessId), { verified: true }, { merge: true });
  }
  if (payment.businessId) {
    batch.set(db.collection(COLLECTIONS.businesses).doc(payment.businessId), { plan: payment.plan }, { merge: true });
  }

  await batch.commit();

  await db.collection(COLLECTIONS.notifications).add({
    recipientUid: payment.uid, title: "Subscription Activated",
    body: `Your ${payment.plan.toUpperCase()} plan is now active.`,
    link: "business-profile.html", read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  await db.collection(COLLECTIONS.moderationLogs).add({
    adminUid: auth.currentUser ? auth.currentUser.uid : null, businessId: payment.businessId || null,
    action: "payment_approved", reason: `${payment.plan} plan · ${payment.reference}`,
    previousStatus: "pending", newStatus: "approved",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function rejectPayment(paymentId, reason) {
  const payRef = db.collection(COLLECTIONS.paymentVerifications).doc(paymentId);
  const paySnap = await payRef.get();
  if (!paySnap.exists) throw new Error("Payment not found.");
  const payment = paySnap.data();
  if (payment.status !== "pending") throw new Error("This payment has already been reviewed.");

  await payRef.update({
    status: "rejected",
    rejectionReason: reason || "Payment could not be verified.",
    reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  await db.collection(COLLECTIONS.notifications).add({
    recipientUid: payment.uid, title: "Payment Could Not Be Verified",
    body: `Reason: ${reason || "Payment could not be verified."}`,
    link: "upgrade.html", read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  await db.collection(COLLECTIONS.moderationLogs).add({
    adminUid: auth.currentUser ? auth.currentUser.uid : null, businessId: payment.businessId || null,
    action: "payment_rejected", reason,
    previousStatus: "pending", newStatus: "rejected",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
