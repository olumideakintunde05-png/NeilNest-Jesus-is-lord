/* ==========================================================================
   messages.js — NeilNest Messages
   Requires: firebase-init.js, auth-guard.js

   URL contract (already wired into business-profile.js's Message buttons):
     messages.html?to={otherUid}&business={businessId}&product={productId?}
   Conversation doc id is deterministic: `${businessId}_${buyerUid}` — so
   "if a conversation already exists, open it" is a single .doc(id).get(),
   never a query.
   ========================================================================== */

/* ⚠️ Cloudinary config — same pattern as add-product.js / upgrade.js. */
const CLOUDINARY_CLOUD_NAME = "YOUR_CLOUDINARY_CLOUD_NAME";
const CLOUDINARY_UPLOAD_PRESET = "YOUR_UNSIGNED_UPLOAD_PRESET";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // "online" = active in the last 2 minutes
const TYPING_TIMEOUT_MS = 3000;

let CURRENT_USER = null;
let allConversations = [];
let convListUnsub = null;
let activeConversationId = null;
let activeConversation = null;
let messagesUnsub = null;
let typingUnsub = null;
let typingTimeout = null;
let presenceInterval = null;

/* ---------------------------------------------------------------------
   Toast
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
function initials(name) { return (name || "?").trim().slice(0, 2).toUpperCase(); }
function fmtTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

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
    window.location.href = "signin.html?redirect=messages.html";
    return;
  }

  startPresenceHeartbeat();
  listenToConversationList();

  const params = new URLSearchParams(window.location.search);
  const toUid = params.get("to");
  const businessId = params.get("business");
  const productId = params.get("product");

  if (toUid && businessId) {
    try {
      const convId = await openOrCreateConversation(businessId, toUid, productId);
      openChat(convId);
    } catch (err) {
      console.error("openOrCreateConversation error:", err);
      showToast(err.message || "Couldn't open that conversation.", "error");
    }
  }

  document.getElementById("appShell").style.opacity = "1";
  document.getElementById("appShell").style.pointerEvents = "auto";
});

window.addEventListener("beforeunload", cleanupChat);

function startPresenceHeartbeat() {
  const beat = () => db.collection(COLLECTIONS.users).doc(CURRENT_USER.uid).set({ lastActiveAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
  beat();
  presenceInterval = setInterval(beat, 30000);
}

/* ---------------------------------------------------------------------
   Conversation list
--------------------------------------------------------------------- */
function listenToConversationList() {
  if (convListUnsub) convListUnsub();
  convListUnsub = db.collection(COLLECTIONS.conversations)
    .where("participants", "array-contains", CURRENT_USER.uid)
    .orderBy("updatedAt", "desc")
    .onSnapshot((snap) => {
      allConversations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderConversationList(document.getElementById("searchInput").value.trim().toLowerCase());
    }, (err) => {
      console.error("listenToConversationList error:", err);
      const msg = err.code === "permission-denied"
        ? "Can't load messages — Firestore rules need to be published (see NEILNEST_FIRESTORE_REFERENCE.md)."
        : "Couldn't load messages. Check your connection.";
      document.getElementById("convScroll").innerHTML = `<div class="empty-state"><div class="es-title">${msg}</div></div>`;
    });
}

function otherPartyInfo(conv) {
  const isOwnerSide = conv.businessOwnerUid === CURRENT_USER.uid;
  return isOwnerSide
    ? { name: conv.buyerName || "User", avatar: conv.buyerAvatar || "", verified: false }
    : { name: conv.businessName || "Business", avatar: conv.businessLogo || "", verified: !!conv.businessVerified };
}

function renderConversationList(filter) {
  const scroll = document.getElementById("convScroll");
  let items = allConversations;
  if (filter) {
    items = items.filter((c) => {
      const info = otherPartyInfo(c);
      return info.name.toLowerCase().includes(filter);
    });
  }

  if (items.length === 0) {
    scroll.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16v12H8l-4 4V4z"/></svg>
        <div class="es-title">${allConversations.length === 0 ? "No conversations yet" : "No matches"}</div>
        <div class="es-sub">${allConversations.length === 0 ? 'Tap "Message" on any business to start one.' : "Try a different search."}</div>
      </div>`;
    return;
  }

  const now = Date.now();
  scroll.innerHTML = items.map((c) => {
    const info = otherPartyInfo(c);
    const unread = (c.unread && c.unread[CURRENT_USER.uid]) || 0;
    const isOnline = c.otherPartyLastActiveAt && (now - toMs(c.otherPartyLastActiveAt)) < ONLINE_THRESHOLD_MS;
    const lastMsg = c.lastMessage;
    let preview = "Start the conversation";
    if (lastMsg) {
      if (lastMsg.type === "image") preview = (lastMsg.senderUid === CURRENT_USER.uid ? "You: " : "") + "📷 Photo";
      else if (lastMsg.type === "product_card") preview = "📦 Shared a product";
      else if (lastMsg.type === "business_card") preview = "🏬 Shared a business";
      else preview = (lastMsg.senderUid === CURRENT_USER.uid ? "You: " : "") + (lastMsg.text || "");
    }
    return `
      <div class="conv-item" data-conv-id="${c.id}">
        <div class="conv-avatar-wrap">
          ${info.avatar ? `<img class="conv-avatar" src="${info.avatar}" alt="">` : `<div class="conv-avatar">${initials(info.name)}</div>`}
          ${isOnline ? `<span class="conv-online-dot"></span>` : ""}
        </div>
        <div class="conv-body">
          <div class="conv-name-row">
            <span class="conv-name">${esc(info.name)}</span>
            ${info.verified ? `<svg class="conv-verified" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>` : ""}
          </div>
          <div class="conv-preview ${unread > 0 ? "unread" : ""}">${esc(preview)}</div>
        </div>
        <div class="conv-meta">
          <div class="conv-time">${lastMsg ? fmtTime(lastMsg.createdAt) : ""}</div>
          ${unread > 0 ? `<div class="conv-unread-badge">${unread > 99 ? "99+" : unread}</div>` : ""}
        </div>
      </div>`;
  }).join("");

  scroll.querySelectorAll(".conv-item").forEach((el) => {
    el.addEventListener("click", () => openChat(el.dataset.convId));
  });
}

function toMs(ts) { return ts && ts.toDate ? ts.toDate().getTime() : (ts ? new Date(ts).getTime() : 0); }

function bindStaticUI() {
  document.getElementById("searchInput").addEventListener("input", (e) => renderConversationList(e.target.value.trim().toLowerCase()));
  document.getElementById("chatBackBtn").addEventListener("click", closeChat);

  document.getElementById("chatMenuBtn").addEventListener("click", () => document.getElementById("chatMenuPanel").classList.toggle("open"));
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("chatMenuPanel");
    if (panel.classList.contains("open") && !panel.contains(e.target) && e.target.id !== "chatMenuBtn") panel.classList.remove("open");
  });

  document.getElementById("viewBusinessBtn").addEventListener("click", () => {
    if (activeConversation) window.location.href = `business-profile.html?id=${activeConversation.businessId}`;
  });
  document.getElementById("chatCallBtn").addEventListener("click", () => openGatedContact("phone"));
  document.getElementById("chatWhatsappBtn").addEventListener("click", () => openGatedContact("whatsapp"));

  document.getElementById("reportConvBtn").addEventListener("click", () => { document.getElementById("chatMenuPanel").classList.remove("open"); document.getElementById("reportModal").classList.add("open"); });
  document.getElementById("closeReportModal").addEventListener("click", () => document.getElementById("reportModal").classList.remove("open"));
  document.getElementById("submitReportBtn").addEventListener("click", submitConversationReport);

  document.getElementById("blockUserBtn").addEventListener("click", () => { document.getElementById("chatMenuPanel").classList.remove("open"); document.getElementById("blockModal").classList.add("open"); });
  document.getElementById("closeBlockModal").addEventListener("click", () => document.getElementById("blockModal").classList.remove("open"));
  document.getElementById("confirmBlockBtn").addEventListener("click", blockCurrentUser);

  document.getElementById("closeDeleteMsgModal").addEventListener("click", () => document.getElementById("deleteMsgModal").classList.remove("open"));

  document.getElementById("messageInput").addEventListener("input", handleTypingInput);
  document.getElementById("messageInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendTextMessage(); });
  document.getElementById("sendBtn").addEventListener("click", sendTextMessage);
  document.getElementById("imageBtn").addEventListener("click", () => document.getElementById("imageInput").click());
  document.getElementById("imageInput").addEventListener("change", sendImageMessage);
}

/* ---------------------------------------------------------------------
   Gated contact reveal (Call / WhatsApp)
   The buyer's plan is checked here for UX (so we don't even try a doomed
   read), but the actual security is firestore.rules on
   businesses/{id}/private/contact — a Free user gets permission-denied
   there no matter what this function does.
--------------------------------------------------------------------- */
async function openGatedContact(kind) {
  if (!activeConversation) return;

  // billing.js's requirePlan() already does exactly this: check plan,
  // toast + redirect to upgrade.html if not met. Falls back to an inline
  // version if billing.js isn't on this page.
  let authorized;
  if (typeof requirePlan === "function") {
    authorized = await requirePlan("pro", { message: "Upgrade to Pro or Business to unlock business contacts." });
  } else {
    const extras = await getAccountExtras(CURRENT_USER.uid);
    authorized = extras.planStatus === "active" && (extras.plan === "pro" || extras.plan === "business");
    if (!authorized) {
      showToast("Upgrade to Pro or Business to unlock business contacts.", "error");
      setTimeout(() => { window.location.href = "upgrade.html"; }, 900);
    }
  }
  if (!authorized) return;

  try {
    const contactSnap = await db.collection(COLLECTIONS.businesses).doc(activeConversation.businessId)
      .collection("private").doc("contact").get();
    if (!contactSnap.exists) { showToast("Contact info not available.", "error"); return; }
    const contact = contactSnap.data();
    if (kind === "phone") {
      if (!contact.phone) { showToast("No phone number on file.", "error"); return; }
      window.location.href = `tel:${contact.phone}`;
    } else {
      if (!contact.whatsapp) { showToast("No WhatsApp number on file.", "error"); return; }
      window.open(`https://wa.me/${contact.whatsapp.replace(/[^0-9]/g, "")}`, "_blank");
    }
  } catch (err) {
    console.error("openGatedContact error:", err);
    showToast("Couldn't load contact info.", "error");
  }
}

/* ---------------------------------------------------------------------
   Starting / opening a conversation
--------------------------------------------------------------------- */
async function openOrCreateConversation(businessId, otherUid, productId) {
  const bizSnap = await db.collection(COLLECTIONS.businesses).doc(businessId).get();
  if (!bizSnap.exists) throw new Error("This business no longer exists.");
  const biz = bizSnap.data();
  const businessOwnerUid = biz.ownerUid;

  if (businessOwnerUid === CURRENT_USER.uid && otherUid === CURRENT_USER.uid) {
    throw new Error("You can't message yourself.");
  }
  const buyerUid = businessOwnerUid === CURRENT_USER.uid ? otherUid : CURRENT_USER.uid;
  if (buyerUid === businessOwnerUid) throw new Error("You can't message your own business.");

  const convId = `${businessId}_${buyerUid}`;
  const convRef = db.collection(COLLECTIONS.conversations).doc(convId);
  const convSnap = await convRef.get();

  if (convSnap.exists) return convId;

  // New conversation — check blocks before creating
  const [meDoc, buyerDoc] = await Promise.all([
    db.collection(COLLECTIONS.users).doc(CURRENT_USER.uid).get(),
    db.collection(COLLECTIONS.users).doc(buyerUid).get()
  ]);
  const me = meDoc.exists ? meDoc.data() : {};
  if ((me.blockedUsers || []).includes(businessOwnerUid === CURRENT_USER.uid ? buyerUid : businessOwnerUid)) {
    throw new Error("You've blocked this user.");
  }

  const buyerData = buyerUid === CURRENT_USER.uid
    ? { name: CURRENT_USER.displayName || "You", avatar: CURRENT_USER.photoURL || "" }
    : { name: (buyerDoc.exists && buyerDoc.data().name) || "User", avatar: (buyerDoc.exists && buyerDoc.data().photoURL) || "" };

  const contactChannels = biz.contactChannels || {};
  await convRef.set({
    businessId, businessOwnerUid,
    businessName: biz.name || "Business", businessLogo: biz.logoUrl || "",
    businessVerified: !!biz.verified,
    // Booleans only — never the real number. A chat doc is readable by
    // its buyer forever, so baking the actual phone/whatsapp in here would
    // permanently bypass the contact gate the moment a Free user opens a
    // chat. The real value is fetched live and gated per-tap instead —
    // see chatCallBtn/chatWhatsappBtn below.
    businessHasPhone: !!contactChannels.phone, businessHasWhatsapp: !!contactChannels.whatsapp,
    buyerUid, buyerName: buyerData.name, buyerAvatar: buyerData.avatar,
    participants: [businessOwnerUid, buyerUid],
    lastMessage: null,
    unread: {},
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // Auto-attach business card, and product card if this chat started from a product
  await appendMessage(convId, { type: "business_card", businessCard: { businessId, name: biz.name, logo: biz.logoUrl || "", verified: !!biz.verified, category: biz.category || "" } }, buyerUid);

  if (productId) {
    try {
      const prodSnap = await db.collection(COLLECTIONS.businesses).doc(businessId).collection(COLLECTIONS.products).doc(productId).get();
      if (prodSnap.exists) {
        const p = prodSnap.data();
        await appendMessage(convId, { type: "product_card", productCard: { productId, businessId, name: p.name, image: (p.images && p.images[0]) || "", price: p.price } }, buyerUid);
      }
    } catch (err) { console.error("Product card attach error:", err); }
  }

  return convId;
}

/* ---------------------------------------------------------------------
   Chat view
--------------------------------------------------------------------- */
function openChat(convId) {
  activeConversationId = convId;
  document.getElementById("listView").style.display = "none";
  document.getElementById("chatView").style.display = "flex";
  history.pushState({ conv: convId }, "", `messages.html?c=${convId}`);

  db.collection(COLLECTIONS.conversations).doc(convId).onSnapshot((snap) => {
    if (!snap.exists) return;
    activeConversation = { id: snap.id, ...snap.data() };
    renderChatHeader(activeConversation);
  });

  listenToMessages(convId);
  listenToTyping(convId);
  markConversationRead(convId);
}

function renderChatHeader(conv) {
  const info = otherPartyInfo(conv);
  document.getElementById("chatName").textContent = info.name;
  document.getElementById("chatVerifiedBadge").style.display = info.verified ? "inline" : "none";
  document.getElementById("chatAvatar").innerHTML = info.avatar ? `<img src="${info.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : initials(info.name);
  document.getElementById("chatSub").textContent = conv.businessOwnerUid === CURRENT_USER.uid ? "Customer" : (conv.category || "Business");
  document.getElementById("chatCallBtn").style.display = conv.businessOwnerUid !== CURRENT_USER.uid && conv.businessHasPhone ? "flex" : "none";
  document.getElementById("chatWhatsappBtn").style.display = conv.businessOwnerUid !== CURRENT_USER.uid && conv.businessHasWhatsapp ? "flex" : "none";
}

function closeChat() {
  cleanupChat();
  document.getElementById("chatView").style.display = "none";
  document.getElementById("listView").style.display = "flex";
  history.pushState({}, "", "messages.html");
}

function cleanupChat() {
  if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
  if (typingUnsub) { typingUnsub(); typingUnsub = null; }
  activeConversationId = null;
  activeConversation = null;
}

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  if (!params.get("c") && activeConversationId) closeChat();
});

/* ---------------------------------------------------------------------
   Messages
--------------------------------------------------------------------- */
function listenToMessages(convId) {
  if (messagesUnsub) messagesUnsub();
  messagesUnsub = db.collection(COLLECTIONS.conversations).doc(convId).collection(COLLECTIONS.messages)
    .orderBy("createdAt", "asc")
    .onSnapshot((snap) => {
      renderMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      markConversationRead(convId);
    }, (err) => console.error("listenToMessages error:", err));
}

function renderMessages(msgs) {
  const scroll = document.getElementById("chatScroll");
  const wasAtBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 40;

  scroll.innerHTML = msgs.map((m) => {
    const mine = m.senderUid === CURRENT_USER.uid;
    if (m.type === "business_card") {
      const bc = m.businessCard || {};
      return `<div class="msg-row ${mine ? "mine" : "theirs"}"><div class="card-bubble" data-open-business="${bc.businessId}">
        ${bc.logo ? `<img src="${bc.logo}">` : `<div class="card-bubble-icon"></div>`}
        <div class="card-bubble-body"><div class="card-bubble-tag">Business</div><div class="card-bubble-title">${esc(bc.name)}</div><div class="card-bubble-sub">${esc(bc.category || "")}</div></div>
      </div></div>`;
    }
    if (m.type === "product_card") {
      const pc = m.productCard || {};
      return `<div class="msg-row ${mine ? "mine" : "theirs"}"><div class="card-bubble" data-open-product="${pc.productId}" data-product-business="${pc.businessId || ""}">
        ${pc.image ? `<img src="${pc.image}">` : `<div class="card-bubble-icon"></div>`}
        <div class="card-bubble-body"><div class="card-bubble-tag">Product</div><div class="card-bubble-title">${esc(pc.name)}</div><div class="card-bubble-sub">₦${(pc.price || 0).toLocaleString()}</div></div>
      </div></div>`;
    }
    if (m.deleted) {
      return `<div class="msg-row ${mine ? "mine" : "theirs"}"><div class="msg-bubble deleted">Message deleted</div></div>`;
    }
    const readByOther = (m.readBy || []).some((uid) => uid !== CURRENT_USER.uid);
    const meta = mine ? `<div class="msg-meta">${fmtTime(m.createdAt)} ${readByOther ? '<svg class="read" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M2 12l5 5L22 3M2 17l5 5"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5 9-10"/></svg>'}</div>` : `<div class="msg-meta">${fmtTime(m.createdAt)}</div>`;

    if (m.type === "image") {
      return `<div class="msg-row ${mine ? "mine" : "theirs"}" data-msg-id="${m.id}" data-mine="${mine}"><div><img class="msg-image" src="${m.imageUrl}" alt="Image message">${meta}</div></div>`;
    }
    return `<div class="msg-row ${mine ? "mine" : "theirs"}" data-msg-id="${m.id}" data-mine="${mine}"><div><div class="msg-bubble">${esc(m.text)}</div>${meta}</div></div>`;
  }).join("");

  scroll.querySelectorAll("[data-open-business]").forEach((el) => el.addEventListener("click", () => window.location.href = `business-profile.html?id=${el.dataset.openBusiness}`));
  scroll.querySelectorAll("[data-open-product]").forEach((el) => el.addEventListener("click", () => window.location.href = `product-details.html?id=${el.dataset.openProduct}&business=${el.dataset.productBusiness}`));

  scroll.querySelectorAll('[data-mine="true"]').forEach((el) => {
    let pressTimer;
    el.addEventListener("touchstart", () => { pressTimer = setTimeout(() => promptDeleteMessage(el.dataset.msgId), 500); });
    el.addEventListener("touchend", () => clearTimeout(pressTimer));
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); promptDeleteMessage(el.dataset.msgId); });
  });

  if (wasAtBottom) scroll.scrollTop = scroll.scrollHeight;
}

async function appendMessage(convId, data, autoSenderUid) {
  const convRef = db.collection(COLLECTIONS.conversations).doc(convId);
  const msgData = Object.assign({
    senderUid: autoSenderUid || CURRENT_USER.uid,
    deleted: false,
    readBy: [CURRENT_USER.uid],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, data);

  await convRef.collection(COLLECTIONS.messages).add(msgData);

  let previewText = data.text;
  if (data.type === "image") previewText = "📷 Photo";
  if (data.type === "product_card") previewText = "📦 Shared a product";
  if (data.type === "business_card") previewText = "🏬 Shared a business";

  const convSnap = await convRef.get();
  const conv = convSnap.data();
  const otherUid = conv.participants.find((uid) => uid !== msgData.senderUid);
  const unread = Object.assign({}, conv.unread || {});
  unread[otherUid] = (unread[otherUid] || 0) + 1;

  await convRef.update({
    lastMessage: { text: previewText, type: data.type, senderUid: msgData.senderUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() },
    unread,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // Analytics: only count messages flowing customer → business owner, not
  // the owner's own replies or the auto-attached business/product cards.
  const isAutoMessage = !!autoSenderUid;
  if (!isAutoMessage && msgData.senderUid !== conv.businessOwnerUid && typeof trackAnalyticsEvent === "function") {
    trackAnalyticsEvent(conv.businessId, "messagesReceived");
  }
}

async function sendTextMessage() {
  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text || !activeConversationId) return;

  const blocked = await checkBlocked();
  if (blocked) { showToast("You can't message this user.", "error"); return; }

  input.value = "";
  document.getElementById("sendBtn").disabled = true;
  clearTyping();
  try {
    await appendMessage(activeConversationId, { type: "text", text });
  } catch (err) {
    console.error("sendTextMessage error:", err);
    showToast("Message failed to send.", "error");
  }
}

async function sendImageMessage(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !activeConversationId) return;
  if (!file.type.startsWith("image/")) return showToast("Please choose an image file.", "error");
  if (file.size > 5 * 1024 * 1024) return showToast("Image too large — max 5MB.", "error");

  const blocked = await checkBlocked();
  if (blocked) { showToast("You can't message this user.", "error"); return; }

  showToast("Sending image…");
  try {
    if (CLOUDINARY_CLOUD_NAME === "YOUR_CLOUDINARY_CLOUD_NAME") {
      throw new Error("Cloudinary isn't configured yet — set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in messages.js.");
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("folder", "neilnest/chat-images");
    const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: formData });
    if (!res.ok) throw new Error("Image upload failed.");
    const data = await res.json();
    await appendMessage(activeConversationId, { type: "image", imageUrl: data.secure_url });
  } catch (err) {
    console.error("sendImageMessage error:", err);
    showToast(err.message || "Couldn't send image.", "error");
  }
}

async function checkBlocked() {
  if (!activeConversation) return false;
  const otherUid = activeConversation.participants.find((uid) => uid !== CURRENT_USER.uid);
  const [meDoc, themDoc] = await Promise.all([
    db.collection(COLLECTIONS.users).doc(CURRENT_USER.uid).get(),
    db.collection(COLLECTIONS.users).doc(otherUid).get()
  ]);
  const me = meDoc.exists ? meDoc.data() : {};
  const them = themDoc.exists ? themDoc.data() : {};
  return (me.blockedUsers || []).includes(otherUid) || (them.blockedUsers || []).includes(CURRENT_USER.uid);
}

function markConversationRead(convId) {
  const ref = db.collection(COLLECTIONS.conversations).doc(convId);
  ref.update({ [`unread.${CURRENT_USER.uid}`]: 0 }).catch(() => {});
  ref.collection(COLLECTIONS.messages).where("senderUid", "!=", CURRENT_USER.uid).limit(30).get().then((snap) => {
    snap.forEach((doc) => {
      const readBy = doc.data().readBy || [];
      if (!readBy.includes(CURRENT_USER.uid)) {
        doc.ref.update({ readBy: firebase.firestore.FieldValue.arrayUnion(CURRENT_USER.uid) }).catch(() => {});
      }
    });
  }).catch((err) => console.error("markConversationRead error:", err));
}

/* ---------------------------------------------------------------------
   Typing indicator
--------------------------------------------------------------------- */
function handleTypingInput() {
  document.getElementById("sendBtn").disabled = !document.getElementById("messageInput").value.trim();
  if (!activeConversationId) return;
  db.collection(COLLECTIONS.conversations).doc(activeConversationId).collection("typing").doc(CURRENT_USER.uid)
    .set({ typing: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(clearTyping, TYPING_TIMEOUT_MS);
}

function clearTyping() {
  if (!activeConversationId) return;
  db.collection(COLLECTIONS.conversations).doc(activeConversationId).collection("typing").doc(CURRENT_USER.uid)
    .set({ typing: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
}

function listenToTyping(convId) {
  if (typingUnsub) typingUnsub();
  typingUnsub = db.collection(COLLECTIONS.conversations).doc(convId).collection("typing")
    .onSnapshot((snap) => {
      let othersTyping = false;
      snap.forEach((doc) => {
        if (doc.id === CURRENT_USER.uid) return;
        const d = doc.data();
        if (d.typing && d.updatedAt && (Date.now() - toMs(d.updatedAt)) < TYPING_TIMEOUT_MS + 1000) othersTyping = true;
      });
      document.getElementById("typingRow").style.display = othersTyping ? "flex" : "none";
    });
}

/* ---------------------------------------------------------------------
   Delete / Report / Block
--------------------------------------------------------------------- */
let pendingDeleteMsgId = null;
function promptDeleteMessage(msgId) {
  pendingDeleteMsgId = msgId;
  document.getElementById("deleteMsgModal").classList.add("open");
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("confirmDeleteMsgBtn").addEventListener("click", async () => {
    if (!pendingDeleteMsgId || !activeConversationId) return;
    try {
      await db.collection(COLLECTIONS.conversations).doc(activeConversationId).collection(COLLECTIONS.messages).doc(pendingDeleteMsgId)
        .update({ deleted: true, text: "", deletedAt: firebase.firestore.FieldValue.serverTimestamp() });
      document.getElementById("deleteMsgModal").classList.remove("open");
    } catch (err) {
      console.error("delete message error:", err);
      showToast("Couldn't delete that message.", "error");
    }
  });
});

async function submitConversationReport() {
  const reason = document.getElementById("reportReason").value.trim();
  if (!reason) return showToast("Please describe the issue.", "error");
  if (!activeConversation) return;
  try {
    const isOwnerSide = activeConversation.businessOwnerUid === CURRENT_USER.uid;
    await submitReport(
      isOwnerSide ? "user" : "business",
      isOwnerSide
        ? { targetId: activeConversation.buyerUid, targetName: activeConversation.buyerName }
        : { targetId: activeConversation.businessId, targetName: activeConversation.businessName, businessId: activeConversation.businessId },
      "Other",
      reason
    );
    document.getElementById("reportModal").classList.remove("open");
    document.getElementById("reportReason").value = "";
    showToast("Report submitted. Our team will review it.");
  } catch (err) {
    console.error("submitConversationReport error:", err);
    showToast(err.message || "Couldn't submit report.", "error");
  }
}

async function blockCurrentUser() {
  if (!activeConversation) return;
  try {
    if (activeConversation.businessOwnerUid === CURRENT_USER.uid) {
      // Owner blocking a customer — no business record to attach to, just the chat-level block.
      await db.collection(COLLECTIONS.users).doc(CURRENT_USER.uid).set({
        blockedUsers: firebase.firestore.FieldValue.arrayUnion(activeConversation.buyerUid)
      }, { merge: true });
    } else {
      await blockBusiness(activeConversation.businessId, activeConversation.businessName, activeConversation.businessLogo);
    }
    document.getElementById("blockModal").classList.remove("open");
    showToast("User blocked.");
    closeChat();
  } catch (err) {
    console.error("blockCurrentUser error:", err);
    showToast(err.message || "Couldn't block this user.", "error");
  }
}
