/* AgroFlow Administration Console — entry point. */

import "@/styles/main.css";
import { initNav, bootRouter, setAfterRender } from "@/app/router";
import { wirePageInteractions, initHeader } from "@/app/interactions";

setAfterRender(wirePageInteractions);

initNav();
initHeader();
bootRouter();

document.getElementById("sidebarToggle")?.addEventListener("click", () => {
  document.getElementById("sidebar")?.classList.toggle("open");
});
