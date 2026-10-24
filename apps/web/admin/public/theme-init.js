(function () {
  var preference = "system";
  try {
    var saved = localStorage.getItem("agroflow_appearance");
    if (saved === "light" || saved === "dark") preference = saved;
  } catch (_) {
    // Storage can be unavailable in private or hardened browsing contexts.
  }
  var dark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
