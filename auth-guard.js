/* ==========================================================================
   auth-guard.js — drop this on any protected page, right after firebase-init.js.
   Enforces: (1) user must be signed in, (2) email must be verified.
   ========================================================================== */
(async function () {
  const user = await waitForAuthUser();
  const currentPage = window.location.pathname.split("/").pop();

  if (!user) {
    window.location.href = "signin.html?redirect=" + encodeURIComponent(currentPage);
    return;
  }

  await user.reload();
  if (!auth.currentUser.emailVerified) {
    window.location.href = "verify-email.html";
    return;
  }

  // Replace any placeholder avatar initials on the page with the real signed-in user's initials
  const initialsEl = document.getElementById("avatarInitials");
  if (initialsEl) {
    const name = (user.displayName || user.email || "?").trim();
    const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    initialsEl.textContent = initials || "?";
  }
})();
