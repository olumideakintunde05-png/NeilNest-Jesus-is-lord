/* ==========================================================================
   firebase-init.js
   Shared Firebase bootstrap for all NeilNest pages.
   Include the compat SDK scripts BEFORE this file:

   <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js"></script>
   <script src="firebase-init.js"></script>
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyDrrIHkd8Sm3OxRP3zkrYBFErgfaUrYILM",
  authDomain: "neilnest.firebaseapp.com",
  projectId: "neilnest",
  storageBucket: "neilnest.firebasestorage.app",
  messagingSenderId: "987990210901",
  appId: "1:987990210901:web:9e579f557122c0bdd5d7dc",
  measurementId: "G-GH6R4GXT58"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

const COLLECTIONS = {
  users: "users",
  businesses: "businesses",
  products: "products",   // subcollection under businesses/{id}/products
  services: "services",   // subcollection under businesses/{id}/services
  favorites: "favorites",
  messages: "messages",
  notifications: "notifications",
  reviews: "reviews",
  plans: "plans",
  subscriptions: "subscriptions",
  analytics: "analytics",
  lessons: "lessons",             // top-level catalog; per-user progress lives at users/{uid}/lessonProgress
  paymentVerifications: "paymentVerifications", // pending/approved/rejected bank-transfer submissions
  conversations: "conversations", // messages subcollection lives at conversations/{id}/messages (COLLECTIONS.messages)
  businessReports: "businessReports",
  productReports: "productReports",
  userReports: "userReports",
  moderationLogs: "moderationLogs"
  // Blocked businesses live at users/{uid}/blockedBusinesses/{businessId} —
  // no top-level collection needed, see trustsafety-core.js.
};

/* Live total unread-message count across all of a user's conversations —
   wire this to the nav-bar Messages badge on any page. */
function listenToUnreadMessageCount(uid, callback) {
  if (!uid) { callback(0); return () => {}; }
  return db.collection(COLLECTIONS.conversations)
    .where("participants", "array-contains", uid)
    .onSnapshot((snap) => {
      let total = 0;
      snap.forEach((doc) => { total += (doc.data().unread && doc.data().unread[uid]) || 0; });
      callback(total);
    }, (err) => console.error("listenToUnreadMessageCount error:", err));
}

/* ---------------------------------------------------------------------
   Subscription + Learning Hub helpers
   Schema:
     users/{uid} {
       plan: "free" | "pro" | "business",
       planStatus: "active" | "trialing" | "canceled" | "expired",
       planExpiresAt: Timestamp | null,
       planStartedAt: Timestamp | null,
       hasEverSubscribed: boolean,
       lastLearningHubVisitAt: Timestamp | null,
       learningStats: {
         completedLessons: number,
         totalLessons: number,
         certificatesEarned: number,
         currentStreak: number,
         longestStreak: number,
         lastLessonCompletedAt: Timestamp | null,
         hasUnfinishedLesson: boolean
       }
     }
     subscriptions/{uid} — full billing record, source of truth (admin-managed, see firestore.rules)
     subscriptions/{uid}/paymentHistory/{paymentId} — append-only payment log
     plans/{planId} — plan catalog (free/pro/business pricing + features) for upgrade.html
     lessons/{lessonId} — learning hub content catalog
     users/{uid}/lessonProgress/{lessonId} — per-user per-lesson progress
     users/{uid}/certificates/{certificateId} — earned certificates
--------------------------------------------------------------------- */

/* Reads the denormalized account doc used to badge the Upgrade Plan and
   Business Learning Hub cards. Returns sane defaults if the user doc
   (or any of these fields) doesn't exist yet, so brand-new accounts never
   throw — they just render as "free / never subscribed / no lessons yet". */
async function getAccountExtras(uid) {
  const defaults = {
    plan: "free",
    planStatus: "active",
    planExpiresAt: null,
    hasEverSubscribed: false,
    lastLearningHubVisitAt: null,
    learningStats: {
      completedLessons: 0,
      totalLessons: 0,
      certificatesEarned: 0,
      currentStreak: 0,
      hasUnfinishedLesson: false
    }
  };
  if (!uid) return defaults;
  try {
    const snap = await db.collection(COLLECTIONS.users).doc(uid).get();
    if (!snap.exists) return defaults;
    const d = snap.data();
    return {
      plan: d.plan || defaults.plan,
      planStatus: d.planStatus || defaults.planStatus,
      planExpiresAt: d.planExpiresAt || null,
      hasEverSubscribed: !!d.hasEverSubscribed,
      lastLearningHubVisitAt: d.lastLearningHubVisitAt || null,
      learningStats: Object.assign({}, defaults.learningStats, d.learningStats || {})
    };
  } catch (err) {
    console.error("getAccountExtras error:", err);
    return defaults;
  }
}

/* Cheap existence check: is there at least one published lesson newer than
   the user's last Learning Hub visit? Single-field range query on
   `createdAt`, no composite index required. */
async function hasNewLessonsSince(lastVisitAt) {
  try {
    let q = db.collection(COLLECTIONS.lessons).where("isPublished", "==", true);
    if (lastVisitAt) q = q.where("createdAt", ">", lastVisitAt);
    const snap = await q.limit(1).get();
    return !snap.empty;
  } catch (err) {
    console.error("hasNewLessonsSince error:", err);
    return false;
  }
}

/* Resolve the signed-in user's plan (free/pro/business/premium).
   Falls back to "free" if the user doc or plan field is missing. */
async function getCurrentUserPlan(uid) {
  if (!uid) return "free";
  try {
    const snap = await db.collection(COLLECTIONS.users).doc(uid).get();
    if (snap.exists && snap.data().plan) return snap.data().plan;
  } catch (err) {
    console.error("getCurrentUserPlan error:", err);
  }
  return "free";
}

/* Small helper other pages can reuse: wait for auth state to resolve once. */
function waitForAuthUser() {
  return new Promise((resolve) => {
    const unsub = auth.onAuthStateChanged((user) => {
      unsub();
      resolve(user);
    });
  });
}
