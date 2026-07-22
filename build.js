/**
 * Cloudflare Pages build script.
 * Converts all Markdown files to HTML for static site deployment.
 *
 * Features:
 * - Parses Wiki.js YAML frontmatter (title, description)
 * - Converts Markdown to HTML using marked
 * - home.md -> index.html
 * - Auto-generates Table of Contents (TOC) from headings
 * - Clean, readable HTML with light/dark mode
 * - Preserves directory structure
 * - Handles Chinese filenames (URL-encoded links)
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const SRC_DIR = ".";
const OUT_DIR = "_site";

// Collect headings for TOC generation
let tocHeadings = [];

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")       // strip HTML tags
    .replace(/[^\w一-鿿㐀-䶿豈-﫿-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "heading";
}

// Customize marked renderer
const renderer = new marked.Renderer();

renderer.heading = function (text, level) {
  const id = slugify(text);
  const sizes = { 1: "1.8em", 2: "1.5em", 3: "1.3em", 4: "1.1em" };

  // Collect for TOC (skip h1 since page title is already h1)
  if (level >= 2 && level <= 4) {
    tocHeadings.push({ text: text.replace(/<[^>]+>/g, ""), level, id });
  }

  return `<h${level} id="${id}" style="margin-top:1.5em;margin-bottom:0.5em;font-size:${sizes[level] || "1em"}">${text}</h${level}>`;
};

renderer.paragraph = function (text) {
  return `<p style="margin:0.8em 0;line-height:1.8">${text}</p>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: false,
});

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const fmText = match[1];
  const body = match[2];

  const frontmatter = {};
  for (const line of fmText.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

function generateToc(headings) {
  if (headings.length < 2) return "";  // Too few headings, skip TOC

  let html = '<details open class="toc">\n';
  html += '  <summary><strong>目录</strong></summary>\n';
  html += '  <ul>\n';

  for (const h of headings) {
    const indent = "    ".repeat(h.level - 2);
    html += `${indent}    <li class="toc-h${h.level}"><a href="#${h.id}">${h.text}</a></li>\n`;
  }

  html += '  </ul>\n</details>\n';
  return html;
}

function generateHtml(mdContent, filePath, allPages) {
  // Reset TOC headings
  tocHeadings = [];

  const { frontmatter, body } = parseFrontmatter(mdContent);
  const title = frontmatter.title || path.basename(filePath, ".md");
  const description = frontmatter.description || "";

  const htmlBody = marked.parse(body);

  // Fix internal links: .md -> .html (for Cloudflare Pages)
  const fixedBody = htmlBody
    .replace(
      /href="([^"]+)\.md"/g,
      (match, p1) => {
        if (p1.startsWith("http://") || p1.startsWith("https://")) {
          return match;
        }
        if (p1 === "home" || p1.endsWith("/home")) {
          return 'href="/"';
        }
        return `href="${p1}.html"`;
      }
    );

  // Generate TOC
  const tocHtml = generateToc(tocHeadings);

  // Generate title heading (h1) if page has TOC or content
  const titleHeading = `<h1>${escapeHtml(title)}</h1>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - 疏律</title>
  <meta name="description" content="${escapeHtml(description)}">
  <style>
    :root {
      --bg: #fafaf9;
      --text: #1c1917;
      --muted: #78716c;
      --border: #e7e5e4;
      --link: #1d4ed8;
      --link-hover: #1e40af;
      --code-bg: #f5f5f4;
      --toc-bg: #fafaf9;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1c1917;
        --text: #e7e5e4;
        --muted: #a8a29e;
        --border: #44403c;
        --link: #93c5fd;
        --link-hover: #bfdbfe;
        --code-bg: #292524;
        --toc-bg: #292524;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    /* Navigation */
    nav.breadcrumb { margin-bottom: 1.5rem; padding-bottom: 0.8rem; border-bottom: 1px solid var(--border); font-size: 0.95em; }
    nav.breadcrumb a { color: var(--link); text-decoration: none; }
    nav.breadcrumb a:hover { color: var(--link-hover); text-decoration: underline; }

    /* TOC */
    .toc {
      background: var(--toc-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.8em 1.2em;
      margin: 1em 0 2em 0;
      font-size: 0.92em;
    }
    .toc summary {
      cursor: pointer;
      color: var(--text);
      padding: 0.2em 0;
      user-select: none;
    }
    .toc summary:hover { color: var(--link); }
    .toc ul { list-style: none; padding-left: 0; margin-top: 0.5em; }
    .toc li { margin: 0.35em 0; line-height: 1.6; }
    .toc a { color: var(--link); text-decoration: none; }
    .toc a:hover { color: var(--link-hover); text-decoration: underline; }
    .toc-h2 { padding-left: 0; }
    .toc-h3 { padding-left: 1.2em; }
    .toc-h4 { padding-left: 2.4em; }

    /* Content */
    h1, h2, h3, h4 { color: var(--text); font-weight: 600; scroll-margin-top: 1em; }
    h1 { font-size: 1.8em; border-bottom: 2px solid var(--border); padding-bottom: 0.3em; margin-bottom: 1em; }
    a { color: var(--link); text-decoration: none; }
    a:hover { color: var(--link-hover); text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.95em; }
    th, td { border: 1px solid var(--border); padding: 0.5em 0.8em; text-align: left; }
    th { background: var(--code-bg); font-weight: 600; }
    code { background: var(--code-bg); padding: 0.15em 0.3em; border-radius: 3px; font-size: 0.9em; }
    pre { background: var(--code-bg); padding: 1em; border-radius: 6px; overflow-x: auto; margin: 0.8em 0; }
    pre code { padding: 0; background: none; }
    blockquote { border-left: 3px solid var(--border); padding-left: 1em; margin: 0.8em 0; color: var(--muted); }
    ul, ol { padding-left: 1.8em; margin: 0.5em 0; }
    li { margin: 0.3em 0; line-height: 1.8; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85em; text-align: center; }

    @media (max-width: 600px) {
      body { padding: 1rem; }
      table { font-size: 0.8em; }
      .toc { padding: 0.6em 0.8em; }
    }
  </style>
</head>
<body>
  <nav class="breadcrumb">
    <a href="/">← 返回首页</a>
  </nav>

  ${titleHeading}

  ${tocHtml}

  <main>
    ${fixedBody}
  </main>

  <footer>
    <p>疏律 · 开源法律条文资料库 · Powered by <a href="https://wiki.js.org">Wiki.js</a></p>
  </footer>
</body>
</html>`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function findMdFiles(dir, baseDir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "_site" || entry.name === "scripts") {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      results.push(...findMdFiles(fullPath, baseDir));
    } else if (entry.name.endsWith(".md")) {
      results.push(relPath);
    }
  }

  return results;
}

function main() {
  console.log("Building 疏律 static site...\n");

  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const mdFiles = findMdFiles(SRC_DIR, SRC_DIR);
  console.log(`Found ${mdFiles.length} Markdown files`);

  let processed = 0;
  let tocCount = 0;

  for (const mdFile of mdFiles) {
    const srcPath = path.join(SRC_DIR, mdFile);
    const content = fs.readFileSync(srcPath, "utf-8");

    const html = generateHtml(content, mdFile, mdFiles);

    if (tocHeadings.length >= 2) tocCount++;

    let outRelPath;
    if (mdFile === "home.md") {
      outRelPath = "index.html";
    } else {
      outRelPath = mdFile.replace(/\.md$/, ".html");
    }

    const outPath = path.join(OUT_DIR, outRelPath);
    const outDir = path.dirname(outPath);

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outPath, html, "utf-8");
    processed++;

    if (processed % 50 === 0) {
      console.log(`  ${processed}/${mdFiles.length}...`);
    }
  }

  console.log(`\nBuild complete: ${processed} pages written to ${OUT_DIR}/`);
  console.log(`  index.html (from home.md)`);
  console.log(`  ${processed - 1} content pages`);
  console.log(`  ${tocCount} pages with Table of Contents`);
}

main();
