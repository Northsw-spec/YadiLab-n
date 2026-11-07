function escapeHtmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderBrowserIndex({ title, cssExists = false }) {
  const safeTitle = escapeHtmlText(title);
  return `<!doctype html>\n<html lang="sv" data-app-runtime="booting">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="theme-color" content="#0b1220">\n<link rel="manifest" href="./manifest.webmanifest">\n<link rel="icon" href="./assets/builtin/resource.generic.svg" type="image/svg+xml">\n${cssExists ? '<link rel="stylesheet" href="./assets/app.css">' : ""}\n<title>${safeTitle}</title>\n</head>\n<body data-app-runtime="booting">\n<div id="app"></div>\n<script type="module" src="./app-shell.js"></script>\n<script type="module" src="./assets/app.js"></script>\n</body>\n</html>\n`;
}
