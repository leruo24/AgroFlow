// One asset on root, nested public routes and the separate staff entry point.
export function brandHtml(
  className = "visual-brand",
  wordmark = "AgroFlow",
): string {
  return `<span class="${className}"><img src="/brand/agroflow-icon-192.png" alt="" width="40" height="40" /><span>${wordmark}</span></span>`;
}
