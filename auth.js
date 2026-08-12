/* ==========================================================================
   auth.js — NeilNest sign-in / sign-up logic
   Requires firebase-init.js loaded first (exposes global `auth`, `db`, COLLECTIONS).
   Works with signin.html (#signin-form) and signup.html (#signup-form) —
   detects which one is present and wires only that page.
   ========================================================================== */

/* ---------------------------------------------------------------------
   Toast (these auth pages don't ship a toast host, so create one)
--------------------------------------------------------------------- */
function ensureToastHost() {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:300;display:flex;flex-direction:column;gap:8px;width:calc(100% - 40px);max-width:350px;";
    document.body.appendChild(host);
  }
  return host;
}
function showToast(message, type) {
  const host = ensureToastHost();
  const el = document.createElement("div");
  el.style.cssText = "display:flex;align-items:center;gap:10px;background:#161616;border:1px solid " +
    (type === "error" ? "rgba(225,75,75,0.4)" : "rgba(55,198,95,0.4)") +
    ";border-radius:14px;padding:13px 16px;font-size:13px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,0.5);color:#fff;";
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 0.25s ease"; setTimeout(() => el.remove(), 250); }, 3600);
}

/* ---------------------------------------------------------------------
   Friendly error messages for common Firebase Auth error codes
--------------------------------------------------------------------- */
function friendlyAuthError(err) {
  const code = err && err.code;
  switch (code) {
    case "auth/invalid-email": return "That email address doesn't look right.";
    case "auth/user-disabled": return "This account has been disabled.";
    case "auth/user-not-found": return "No account found with that email.";
    case "auth/wrong-password": return "Incorrect password. Please try again.";
    case "auth/invalid-credential": return "Incorrect email or password.";
    case "auth/email-already-in-use": return "An account already exists with that email.";
    case "auth/weak-password": return "Please choose a stronger password (at least 6 characters).";
    case "auth/too-many-requests": return "Too many attempts. Please wait a moment and try again.";
    case "auth/popup-closed-by-user": return "Sign-in was cancelled.";
    case "auth/network-request-failed": return "Network error. Check your connection and try again.";
    case "auth/account-exists-with-different-credential": return "An account already exists using a different sign-in method.";
    default: return (err && err.message) || "Something went wrong. Please try again.";
  }
}

/* ---------------------------------------------------------------------
   Button loading state helper
--------------------------------------------------------------------- */
function setButtonLoading(btn, loading, loadingLabel) {
  if (loading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="auth-spinner" style="width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,0.25);border-top-color:#fff;display:inline-block;animation:auth-spin 0.7s linear infinite;margin-right:8px;"></span>${loadingLabel || "Please wait…"}`;
    if (!document.getElementById("auth-spin-style")) {
      const style = document.createElement("style");
      style.id = "auth-spin-style";
      style.textContent = "@keyframes auth-spin{to{transform:rotate(360deg)}}";
      document.head.appendChild(style);
    }
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

/* ---------------------------------------------------------------------
   Ensure a users/{uid} Firestore doc exists (used after any sign-in path)
--------------------------------------------------------------------- */
async function ensureUserDoc(user, extra) {
  const ref = db.collection(COLLECTIONS.users).doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      uid: user.uid,
      fullName: user.displayName || (extra && extra.fullName) || "",
      email: user.email || "",
      phone: (extra && extra.phone) || "",
      accountType: (extra && extra.accountType) || "business",
      businessName: (extra && extra.businessName) || "",
      profession: (extra && extra.profession) || "",
      category: (extra && extra.category) || "",
      skills: (extra && extra.skills) || "",
      bio: (extra && extra.bio) || "",
      location: (extra && extra.location) || { country: "", state: "", city: "" },
      profileImage: "",
      interests: [],
      notificationPreferences: { email: true, push: true, sms: false },
      plan: "free",
      emailVerified: !!user.emailVerified,
      verified: false,
      profileCompleted: !!user.emailVerified,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

/* ---------------------------------------------------------------------
   Full account creation — called from signup.html's Step 4 "Create Account"
--------------------------------------------------------------------- */
async function createNeilNestAccount(data) {
  const cred = await auth.createUserWithEmailAndPassword(data.email, data.password);
  await cred.user.updateProfile({ displayName: data.fullName });

  await db.collection(COLLECTIONS.users).doc(cred.user.uid).set({
    uid: cred.user.uid,
    fullName: data.fullName,
    email: data.email,
    phone: data.phone,
    accountType: data.accountType,
    businessName: data.businessName || "",
    profession: data.profession || "",
    category: data.category || "",
    skills: data.skills || "",
    bio: data.bio || "",
    location: data.location || { country: "", state: "", city: "" },
    profileImage: "",
    interests: [],
    notificationPreferences: { email: true, push: true, sms: false },
    plan: "free",
    emailVerified: false,
    verified: false,
    profileCompleted: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  await cred.user.sendEmailVerification();
  return cred.user;
}
window.createNeilNestAccount = createNeilNestAccount;
window.friendlyAuthError = friendlyAuthError;
window.showToast = showToast;

/* ---------------------------------------------------------------------
   Redirect target after successful auth
--------------------------------------------------------------------- */
function getRedirectTarget() {
  const params = new URLSearchParams(window.location.search);
  return params.get("redirect") || "home.html";
}

/* ---------------------------------------------------------------------
   Social providers
--------------------------------------------------------------------- */
async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  const result = await auth.signInWithPopup(provider);
  await ensureUserDoc(result.user);
  return result.user;
}
async function signInWithFacebook() {
  const provider = new firebase.auth.FacebookAuthProvider();
  const result = await auth.signInWithPopup(provider);
  await ensureUserDoc(result.user);
  return result.user;
}
async function signInWithApple() {
  // Requires "Sign in with Apple" enabled under Firebase Console → Authentication → Sign-in method.
  const provider = new firebase.auth.OAuthProvider("apple.com");
  const result = await auth.signInWithPopup(provider);
  await ensureUserDoc(result.user);
  return result.user;
}

function bindSocialButtons() {
  const googleBtn = document.getElementById("btn-google");
  const appleBtn = document.getElementById("btn-apple");
  const fbBtn = document.getElementById("btn-facebook");

  if (googleBtn) googleBtn.addEventListener("click", async () => {
    try {
      setButtonLoading(googleBtn, true, "");
      await signInWithGoogle();
      showToast("Signed in successfully.", "success");
      window.location.href = getRedirectTarget();
    } catch (err) {
      console.error("Google sign-in error:", err);
      if (err.code !== "auth/popup-closed-by-user") showToast(friendlyAuthError(err), "error");
    } finally { setButtonLoading(googleBtn, false); }
  });

  if (fbBtn) fbBtn.addEventListener("click", async () => {
    try {
      setButtonLoading(fbBtn, true, "");
      await signInWithFacebook();
      showToast("Signed in successfully.", "success");
      window.location.href = getRedirectTarget();
    } catch (err) {
      console.error("Facebook sign-in error:", err);
      if (err.code !== "auth/popup-closed-by-user") showToast(friendlyAuthError(err), "error");
    } finally { setButtonLoading(fbBtn, false); }
  });

  if (appleBtn) appleBtn.addEventListener("click", async () => {
    try {
      setButtonLoading(appleBtn, true, "");
      await signInWithApple();
      showToast("Signed in successfully.", "success");
      window.location.href = getRedirectTarget();
    } catch (err) {
      console.error("Apple sign-in error:", err);
      if (err.code !== "auth/popup-closed-by-user") showToast(friendlyAuthError(err), "error");
    } finally { setButtonLoading(appleBtn, false); }
  });
}

/* ---------------------------------------------------------------------
   Sign-in page wiring
--------------------------------------------------------------------- */
function wireSignInForm() {
  const form = document.getElementById("signin-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const rememberMe = document.getElementById("remember-me").checked;
    const submitBtn = form.querySelector('button[type="submit"]');

    if (!email || !password) { showToast("Please enter your email and password.", "error"); return; }

    try {
      setButtonLoading(submitBtn, true, "Signing in…");
      await auth.setPersistence(rememberMe ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION);
      const cred = await auth.signInWithEmailAndPassword(email, password);
      await cred.user.reload();

      if (!cred.user.emailVerified) {
        showToast("⚠ Please verify your email before accessing NeilNest.", "error");
        setTimeout(() => { window.location.href = "verify-email.html"; }, 500);
        return;
      }

      showToast("Welcome back!", "success");
      setTimeout(() => { window.location.href = getRedirectTarget(); }, 500);
    } catch (err) {
      console.error("Sign-in error:", err);
      showToast(friendlyAuthError(err), "error");
      setButtonLoading(submitBtn, false);
    }
  });
}

/* ---------------------------------------------------------------------
   Init
--------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  wireSignInForm();
  bindSocialButtons();
});
