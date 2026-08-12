/* ==========================================================================
   nav-fab.js
   The bottom-nav "+" button defaults to add-business.html in every page's
   markup. Once a user already owns a business, tapping it should jump
   straight to adding a product instead — they can't create a second
   business anyway (see add-business.js's ownerUid check), so sending them
   back there just makes them bounce through an auto-redirect into edit
   mode, which isn't what "+" implies.

   Include AFTER firebase-init.js and auth-guard.js on every page that has
   the bottom nav:
     <script src="firebase-init.js"></script>
     <script src="auth-guard.js"></script>
     <script src="nav-fab.js"></script>
   ========================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const fab = document.querySelector(".nav-fab");
  if (!fab) return; // page has no bottom nav (e.g. add-business.html itself)

  try {
    const user = await waitForAuthUser();
    if (!user) return; // signed out — leave default add-business.html target

    const existing = await db.collection(COLLECTIONS.businesses)
      .where("ownerUid", "==", user.uid)
      .limit(1)
      .get();

    if (!existing.empty) {
      fab.href = "add-product.html";
      fab.setAttribute("aria-label", "Add Product");
      fab.dataset.page = "add-product";
    }
  } catch (err) {
    console.error("nav-fab business check error:", err);
    // Leave default add-business.html target on error — safest fallback.
  }
});
