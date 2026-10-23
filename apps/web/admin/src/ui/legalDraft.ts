// Render the team's static draft without accepting HTML or adding a Markdown runtime.
export function legalDraftHtml(source: string): string {
  const inline = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return source
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      if (/^#{1,2} /.test(block))
        return `<h2>${inline(block.replace(/^#+ /, ""))}</h2>`;
      if (block.startsWith("- "))
        return `<ul>${block
          .split(/\n(?=- )/)
          .map(
            (item) =>
              `<li>${inline(item.replace(/^- /, "").replace(/\n/g, " "))}</li>`,
          )
          .join("")}</ul>`;
      return `<p>${inline(block.replace(/\n/g, " "))}</p>`;
    })
    .join("");
}
