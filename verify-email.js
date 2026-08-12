/* ==========================================================================
   verify-email.js — NeilNest email verification screen
   Requires firebase-init.js and auth.js loaded first.
   ========================================================================== */

let verifyCurrentUser = null;
const RESEND_COOLDOWN_SECONDS = 60;

function webmailUrlForEmail(email) {
  const domain = (email.split("@")[1] || "").toLowerCase();
  if (domain.includes("gmail.com")) return "https://mail.google.com/mail/u/0/#inbox";
  if (domain.includes("outlook.com") || domain.includes("hotmail.com") || domain.includes("live.com")) return "https://outlook.live.com/mail/0/inbox";
  if (domain.includes("yahoo.com")) return "https://mail.yahoo.com";
  if (domain.includes("icloud.com") || domain.includes("me.com")) return "https://www.icloud.com/mail";
  return null;
}

function openEmailApp() {
  const email = verifyCurrentUser ? verifyCurrentUser.email : "";
  const webmail = webmailUrlForEmail(email);
  if (webmail) {
    window.open(webmail, "_blank");
  } else {
    window.location.href = "mailto:";
  }
}

function startResendCooldown() {
  const btn = document.getElementById("resendBtn");
  const label = document.getElementById("resendLabel");
  let secondsLeft = RESEND_COOLDOWN_SECONDS;
  btn.disabled = true;
  label.textContent = `Resend Email (${secondsLeft}s)`;
  const interval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(interval);
      btn.disabled = false;
      label.textContent = "Resend Email";
    } else {
      label.textContent = `Resend Email (${secondsLeft}s)`;
    }
  }, 1000);
}

async function handleResend() {
  if (!verifyCurrentUser) return;
  const btn = document.getElementById("resendBtn");
  try {
    btn.disabled = true;
    await verifyCurrentUser.sendEmailVerification();
    showToast("Verification email sent.", "success");
    startResendCooldown();
  } catch (err) {
    console.error("Resend error:", err);
    showToast(friendlyAuthError(err), "error");
    btn.disabled = false;
  }
}

async function handleVerifiedCheck() {
  if (!verifyCurrentUser) return;
  const btn = document.getElementById("verifiedBtn");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>Checking…</span>';

  try {
    await verifyCurrentUser.reload();
    const freshUser = auth.currentUser;

    if (freshUser && freshUser.emailVerified) {
      const userRef = db.collection(COLLECTIONS.users).doc(freshUser.uid);
      await userRef.update({
        emailVerified: true,
        profileCompleted: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      showToast("✅ Email verified successfully.", "success");

      const snap = await userRef.get();
      const accountType = (snap.exists && snap.data().accountType) || "business";

      setTimeout(() => {
        window.location.href = accountType === "business" ? "add-business.html" : "add-business.html";
      }, 700);
    } else {
      showToast("❌ Your email has not been verified yet.", "error");
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  } catch (err) {
    console.error("Verify check error:", err);
    showToast(friendlyAuthError(err), "error");
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function handleBackToLogin(e) {
  e.preventDefault();
  try { await auth.signOut(); } catch (err) { console.error("Sign out error:", err); }
  window.location.href = "signin.html";
}

document.addEventListener("DOMContentLoaded", async () => {
  verifyCurrentUser = await waitForAuthUser();

  if (!verifyCurrentUser) {
    window.location.href = "signin.html";
    return;
  }

  document.getElementById("userEmail").textContent = verifyCurrentUser.email || "—";

  // If already verified when landing here, no need to wait — send them onward.
  await verifyCurrentUser.reload();
  if (auth.currentUser && auth.currentUser.emailVerified) {
    const userRef = db.collection(COLLECTIONS.users).doc(auth.currentUser.uid);
    const snap = await userRef.get();
    const accountType = (snap.exists && snap.data().accountType) || "business";
    if (snap.exists && !snap.data().profileCompleted) {
      await userRef.update({ emailVerified: true, profileCompleted: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
    window.location.href = accountType === "business" ? "add-business.html" : "professional-dashboard.html";
    return;
  }

  document.getElementById("openEmailBtn").addEventListener("click", openEmailApp);
  document.getElementById("resendBtn").addEventListener("click", handleResend);
  document.getElementById("verifiedBtn").addEventListener("click", handleVerifiedCheck);
  document.getElementById("backToLoginLink").addEventListener("click", handleBackToLogin);

  startResendCooldown();
});
