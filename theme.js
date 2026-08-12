/* ==========================================================================
   NeilNest — shared theme engine
   Drop this file next to firebase-init.js and include it EARLY in <head>
   (before first paint) to avoid a flash of the wrong theme:

     <script src="theme.js"></script>

   It sets data-theme="dark" | "light" on <html>. Your CSS then reads that
   attribute for light-mode overrides (see the token block at the top of
   each page's <style>). It also wires up any element with
   [data-theme-toggle] to cycle Dark → Light → System, and keeps multiple
   toggles (e.g. mobile + desktop sidebar) in sync.
   ========================================================================== */
(function () {
  var STORAGE_KEY = "nn_theme"; // "dark" | "light" | "system"

  function systemPref() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function getSetting() {
    try { return localStorage.getItem(STORAGE_KEY) || "system"; } catch (e) { return "system"; }
  }

  function resolvedTheme(setting) {
    return setting === "system" ? systemPref() : setting;
  }

  function apply(setting) {
    var resolved = resolvedTheme(setting);
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-theme-setting", setting);
    // Keep the address-bar color (mobile browser chrome) matching the theme
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "light" ? "#F7F7F9" : "#050505");
    syncToggles(setting);
  }

  function setTheme(setting) {
    try { localStorage.setItem(STORAGE_KEY, setting); } catch (e) {}
    apply(setting);
  }

  function syncToggles(setting) {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (el) {
      el.setAttribute("data-current", setting);
      var label = el.querySelector("[data-theme-label]");
      if (label) label.textContent = setting === "system" ? "System" : (setting === "light" ? "Light" : "Dark");
    });
  }

  // Apply immediately (before DOMContentLoaded) so there's no flash.
  apply(getSetting());

  // React to OS-level changes when the user has chosen "System".
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", function () {
      if (getSetting() === "system") apply("system");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    syncToggles(getSetting());
    document.querySelectorAll("[data-theme-toggle]").forEach(function (el) {
      el.addEventListener("click", function () {
        var order = ["dark", "light", "system"];
        var next = order[(order.indexOf(getSetting()) + 1) % order.length];
        setTheme(next);
      });
    });
  });

  // Expose for manual control if a page needs it (e.g. a settings page with
  // three explicit radio buttons instead of a cycling button).
  window.NNTheme = { get: getSetting, set: setTheme };
})();
