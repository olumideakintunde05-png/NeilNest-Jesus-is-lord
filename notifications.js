/* ==========================================================================
   notifications.js — shared real-time notifications
   Requires firebase-init.js loaded first. Works on any page that has:
     #bellBadge (badge-dot span), #notifList (container inside #notifPanel)
   Notifications are written by your admin panel into Firestore:
     notifications/{id} = {
       recipientUid, title, body, link, read: false, createdAt
     }
   ========================================================================== */

let notifUnsub = null;
let notifFirstSnapshotLoaded = false;

function timeAgo(date) {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return days + "d ago";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderNotifList(docs) {
  const list = document.getElementById("notifList");
  if (!list) return;

  if (docs.length === 0) {
    list.innerHTML = '<div class="notif-empty" style="padding:24px 16px;text-align:center;font-size:12.5px;color:#7a7a7a;">You\'re all caught up — no notifications yet.</div>';
    return;
  }

  list.innerHTML = docs.map(doc => {
    const d = doc.data();
    const created = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate() : null;
    return `
      <div class="notif-item" data-notif data-id="${doc.id}" data-link="${d.link || ""}" tabindex="0">
        <span class="dot ${d.read ? "read" : ""}"></span>
        <div>
          <div class="title">${escapeNotifHtml(d.title || d.body || "Notification")}</div>
          <div class="time">${timeAgo(created)}</div>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll("[data-notif]").forEach(item => {
    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = item.dataset.id;
      try { await db.collection(COLLECTIONS.notifications).doc(id).update({ read: true }); }
      catch (err) { console.error("Mark read error:", err); }
      const link = item.dataset.link;
      if (link) window.location.href = link;
    });
  });
}

function escapeNotifHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function updateBadge(unreadCount) {
  const badge = document.getElementById("bellBadge");
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? "99+" : unreadCount;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

function showNotifToast(title) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.style.cssText = "position:fixed;left:50%;bottom:100px;transform:translateX(-50%);z-index:300;display:flex;flex-direction:column;gap:8px;width:calc(100% - 40px);max-width:350px;";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.style.cssText = "display:flex;align-items:center;gap:10px;background:#161616;border:1px solid rgba(224,168,60,0.4);border-radius:14px;padding:13px 16px;font-size:13px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,0.5);color:#fff;";
  el.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#e0a83c" stroke-width="1.8" style="flex-shrink:0;"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><span>' + escapeNotifHtml(title) + "</span>";
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 0.25s ease"; setTimeout(() => el.remove(), 250); }, 4000);
}

function startNotificationsListener(uid) {
  if (notifUnsub) notifUnsub();
  notifFirstSnapshotLoaded = false;

  notifUnsub = db.collection(COLLECTIONS.notifications)
    .where("recipientUid", "==", uid)
    .limit(30)
    .onSnapshot((snapshot) => {
      const sortedDocs = [...snapshot.docs].sort((a, b) => {
        const at = a.data().createdAt && a.data().createdAt.toDate ? a.data().createdAt.toDate().getTime() : 0;
        const bt = b.data().createdAt && b.data().createdAt.toDate ? b.data().createdAt.toDate().getTime() : 0;
        return bt - at;
      });

      renderNotifList(sortedDocs);
      const unread = sortedDocs.filter(d => !d.data().read).length;
      updateBadge(unread);

      if (notifFirstSnapshotLoaded) {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const d = change.doc.data();
            showNotifToast(d.title || d.body || "New notification");
          }
        });
      }
      notifFirstSnapshotLoaded = true;
    }, (err) => {
      console.error("Notifications listener error:", err);
      const list = document.getElementById("notifList");
      if (list) list.innerHTML = '<div class="notif-empty" style="padding:20px 16px;text-align:center;font-size:12px;color:#7a7a7a;">Couldn\'t load notifications.</div>';
    });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!document.getElementById("notifList") && !document.getElementById("bellBadge")) return;
  const user = await waitForAuthUser();
  if (user) startNotificationsListener(user.uid);
});
