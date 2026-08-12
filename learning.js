/* ==========================================================================
   learning.js — NeilNest Business Learning Hub
   Requires: firebase-init.js, auth-guard.js, billing.js
   ========================================================================== */

let CURRENT_USER = null;

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
    window.location.href = "signin.html?redirect=learning.html";
    return;
  }

  try {
    const extras = await getAccountExtras(CURRENT_USER.uid);
    const plan = PLAN_CATALOG[extras.plan] || PLAN_CATALOG.free;

    if (!plan.learningHub) {
      document.getElementById("lockedState").style.display = "block";
    } else {
      document.getElementById("hubState").style.display = "block";
      // Mark this visit so the "New" badge on the profile card clears —
      // this is the only place that ever writes lastLearningHubVisitAt.
      db.collection(COLLECTIONS.users).doc(CURRENT_USER.uid)
        .set({ lastLearningHubVisitAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});

      await loadLessons(extras);
    }
  } catch (err) {
    console.error("Learning Hub load error:", err);
    showToast("Couldn't load the Learning Hub. Check your connection.", "error");
  }

  document.getElementById("appShell").style.opacity = "1";
  document.getElementById("appShell").style.pointerEvents = "auto";
});

async function loadLessons(extras) {
  const stats = extras.learningStats || {};
  document.getElementById("statCompleted").textContent = stats.completedLessons || 0;
  document.getElementById("statCertificates").textContent = stats.certificatesEarned || 0;
  document.getElementById("statStreak").textContent = stats.currentStreak || 0;

  const [lessonsSnap, progressSnap] = await Promise.all([
    db.collection(COLLECTIONS.lessons).where("isPublished", "==", true).orderBy("order", "asc").get(),
    db.collection(COLLECTIONS.users).doc(CURRENT_USER.uid).collection("lessonProgress").get()
  ]);

  const progressMap = {};
  progressSnap.forEach((d) => { progressMap[d.id] = d.data(); });

  const wrap = document.getElementById("lessonsList");
  if (lessonsSnap.empty) {
    wrap.innerHTML = `<div class="empty-note">No lessons published yet — check back soon.</div>`;
    return;
  }

  wrap.innerHTML = lessonsSnap.docs.map((d) => {
    const l = { id: d.id, ...d.data() };
    const status = (progressMap[d.id] && progressMap[d.id].status) || "not_started";
    const statusLabel = status === "completed" ? "Completed" : status === "in_progress" ? "In Progress" : "Not Started";
    return `
      <div class="lesson-card" data-lesson-id="${l.id}">
        <div class="lesson-thumb">${l.thumbnailUrl ? `<img src="${l.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>`}</div>
        <div class="lesson-body">
          <div class="lesson-title">${esc(l.title)}</div>
          <div class="lesson-meta">${esc(l.category || "")}${l.durationMinutes ? " · " + l.durationMinutes + " min" : ""}</div>
          <span class="lesson-status lesson-status--${status}">${statusLabel}</span>
        </div>
      </div>`;
  }).join("");

  wrap.querySelectorAll("[data-lesson-id]").forEach((el) => {
    el.addEventListener("click", () => openLesson(el.dataset.lessonId, lessonsSnap.docs.find((d) => d.id === el.dataset.lessonId).data(), progressMap[el.dataset.lessonId]));
  });
}

async function openLesson(lessonId, lesson, existingProgress) {
  if (lesson.contentUrl) window.open(lesson.contentUrl, "_blank");

  const progRef = db.collection(COLLECTIONS.users).doc(CURRENT_USER.uid).collection("lessonProgress").doc(lessonId);
  const wasCompleted = existingProgress && existingProgress.status === "completed";

  try {
    await progRef.set({
      status: wasCompleted ? "completed" : "in_progress",
      startedAt: existingProgress ? existingProgress.startedAt : firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (!wasCompleted) {
      showToast("Lesson opened — tap again once you're done to mark it complete.");
    }
  } catch (err) {
    console.error("openLesson progress write error:", err);
  }
}

/* Call this (e.g. wire a "Mark Complete" button inside your lesson content
   page, or open lessons in-app instead of a new tab) to actually record
   completion, streak, and stats. Kept separate from openLesson() since
   right now lessons open in a new tab and there's no in-app "done" event
   to hook — this is real, callable code waiting for that UI. */
async function markLessonComplete(lessonId) {
  const userRef = db.collection(COLLECTIONS.users).doc(CURRENT_USER.uid);
  const progRef = userRef.collection("lessonProgress").doc(lessonId);

  const [userSnap, progSnap] = await Promise.all([userRef.get(), progRef.get()]);
  if (progSnap.exists && progSnap.data().status === "completed") return; // already counted

  const stats = (userSnap.exists && userSnap.data().learningStats) || {};
  const lastCompleted = stats.lastLessonCompletedAt ? stats.lastLessonCompletedAt.toDate() : null;
  const now = new Date();
  const isConsecutiveDay = lastCompleted && (now - lastCompleted) < 48 * 60 * 60 * 1000 && now.toDateString() !== lastCompleted.toDateString();
  const isSameDay = lastCompleted && now.toDateString() === lastCompleted.toDateString();
  const newStreak = isSameDay ? (stats.currentStreak || 0) : isConsecutiveDay ? (stats.currentStreak || 0) + 1 : 1;

  const batch = db.batch();
  batch.set(progRef, { status: "completed", completedAt: firebase.firestore.FieldValue.serverTimestamp(), progressPercent: 100 }, { merge: true });
  batch.set(userRef, {
    learningStats: {
      completedLessons: (stats.completedLessons || 0) + 1,
      totalLessons: stats.totalLessons || 0,
      certificatesEarned: stats.certificatesEarned || 0,
      currentStreak: newStreak,
      longestStreak: Math.max(newStreak, stats.longestStreak || 0),
      lastLessonCompletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      hasUnfinishedLesson: false
    }
  }, { merge: true });
  await batch.commit();
}
