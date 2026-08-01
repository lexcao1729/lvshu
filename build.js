/**
 * Cloudflare Pages build script.
 * Converts all Markdown files to HTML for static site deployment.
 *
 * Features:
 * - Parses Wiki.js YAML frontmatter (title, description)
 * - Converts Markdown to HTML using marked
 * - home.md -> index.html
 * - Auto-generates Table of Contents (TOC) from headings
 * - Client-side search bar in sidebar / homepage
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
  if (headings.length < 2) return "";

  let html = '<nav class="toc">\n';
  html += '  <div class="toc-title">目录</div>\n';
  html += '  <ul>\n';

  for (const h of headings) {
    html += `    <li class="toc-h${h.level}"><a href="#${h.id}">${h.text}</a></li>\n`;
  }

  html += '  </ul>\n</nav>\n';
  return html;
}

function generateSearchHtml() {
  return `
    <div class="sidebar-search">
      <div class="search-title">搜索</div>
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="搜索页面…" autocomplete="off">
        <div class="search-results" id="searchResults"></div>
      </div>
    </div>`;
}

function generateHtml(mdContent, filePath, allPages, allPagesInfo) {
  tocHeadings = [];

  const { frontmatter, body } = parseFrontmatter(mdContent);
  const title = frontmatter.title || path.basename(filePath, ".md");
  const description = frontmatter.description || "";

  const htmlBody = marked.parse(body);

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

  const tocHtml = generateToc(tocHeadings);
  const hasToc = tocHtml !== "";
  const titleHeading = `<h1>${escapeHtml(title)}</h1>`;

  // Build page index JSON for client-side search
  const pageIndexJson = JSON.stringify(allPagesInfo);

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
      --sidebar-bg: #fafaf9;
      --active: #1d4ed8;
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
        --sidebar-bg: #1c1917;
        --active: #93c5fd;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
    }

    /* ── Layout ── */
    .page {
      display: flex;
      max-width: 1100px;
      margin: 0 auto;
      min-height: 100vh;
    }

    /* ── Sidebar ── */
    .sidebar {
      width: 240px;
      flex-shrink: 0;
      padding: 2rem 0 2rem 1.5rem;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      border-right: 1px solid var(--border);
      background: var(--sidebar-bg);
      font-size: 0.88em;
      display: flex;
      flex-direction: column;
    }
    .sidebar .toc {
      flex: 0 0 auto;
    }
    .sidebar .toc-title {
      font-weight: 700;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin-bottom: 0.8em;
    }
    .sidebar ul { list-style: none; padding: 0; }
    .sidebar li { margin: 0.2em 0; line-height: 1.5; }
    .sidebar a {
      color: var(--muted);
      text-decoration: none;
      display: block;
      padding: 0.15em 0;
      transition: color 0.15s;
    }
    .sidebar a:hover { color: var(--link); }
    .sidebar a.active {
      color: var(--active);
      font-weight: 600;
    }
    .sidebar .toc-h2 { padding-left: 0; }
    .sidebar .toc-h3 { padding-left: 0.8em; }
    .sidebar .toc-h4 { padding-left: 1.6em; }

    /* ── Sidebar search ── */
    .sidebar-search {
      flex: 1 0 auto;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .sidebar-search .search-title {
      font-weight: 700;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin-bottom: 0.6em;
    }
    .search-box {
      position: relative;
    }
    .search-box input {
      width: 100%;
      padding: 0.4em 0.6em;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      color: var(--text);
      font-size: 0.9em;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    .search-box input:focus {
      border-color: var(--link);
    }
    .search-results {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 4px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      max-height: 300px;
      overflow-y: auto;
      z-index: 50;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .search-results.visible {
      display: block;
    }
    .search-result-item {
      display: block;
      padding: 0.4em 0.8em;
      color: var(--text);
      text-decoration: none;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
      font-size: 0.92em;
    }
    .search-result-item:last-child {
      border-bottom: none;
    }
    .search-result-item:hover,
    .search-result-item.active {
      background: var(--code-bg);
      color: var(--link);
    }
    .search-result-item .result-path {
      display: block;
      font-size: 0.78em;
      color: var(--muted);
      margin-top: 0.1em;
    }
    .search-no-results {
      padding: 0.6em 0.8em;
      color: var(--muted);
      font-size: 0.88em;
      text-align: center;
    }

    /* ── Homepage search ── */
    .home-search {
      margin-bottom: 1.5rem;
    }
    .home-search .search-box {
      max-width: 400px;
    }
    .home-search .search-box input {
      padding: 0.55em 0.8em;
      font-size: 0.95em;
    }
    .home-search .search-results {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
    }

    /* Mobile sidebar toggle */
    .toc-toggle {
      display: none;
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--link);
      color: #fff;
      border: none;
      font-size: 1.2em;
      cursor: pointer;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    /* ── Main content ── */
    .main {
      flex: 1;
      min-width: 0;
      padding: 2rem 2rem 3rem 2.5rem;
      max-width: 760px;
    }
    nav.breadcrumb { margin-bottom: 1rem; font-size: 0.9em; }
    nav.breadcrumb a { color: var(--link); text-decoration: none; }
    nav.breadcrumb a:hover { color: var(--link-hover); text-decoration: underline; }

    /* ── No-sidebar pages (home) ── */
    .page.no-sidebar .main {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem 1.5rem 3rem 1.5rem;
    }

    /* ── Typography ── */
    h1, h2, h3, h4 { color: var(--text); font-weight: 600; scroll-margin-top: 1em; }
    h1 { font-size: 1.8em; border-bottom: 2px solid var(--border); padding-bottom: 0.3em; margin-bottom: 1em; }
    h2 { font-size: 1.5em; margin-top: 1.5em; margin-bottom: 0.5em; }
    h3 { font-size: 1.3em; margin-top: 1.3em; margin-bottom: 0.4em; }
    h4 { font-size: 1.1em; margin-top: 1.1em; margin-bottom: 0.3em; }
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

    /* ── Mobile ── */
    @media (max-width: 768px) {
      .page { flex-direction: column; }
      .sidebar {
        display: none;
        position: fixed;
        top: 0; left: 0;
        width: 280px;
        height: 100vh;
        z-index: 99;
        padding: 2rem 1.5rem;
        border-right: 1px solid var(--border);
        box-shadow: 2px 0 12px rgba(0,0,0,0.15);
      }
      .sidebar.open { display: flex; }
      .toc-toggle { display: flex; align-items: center; justify-content: center; }
      .main { padding: 1.5rem 1rem 5rem 1rem; }
      .page.no-sidebar .main { padding: 1.5rem 1rem 3rem 1rem; }
      h1 { font-size: 1.4em; }
      .search-results {
        max-height: 240px;
      }
    }
  </style>
</head>
<body>
  <div class="page${hasToc ? "" : " no-sidebar"}">

    ${hasToc ? `
    <aside class="sidebar" id="sidebar">
      ${tocHtml}
      ${generateSearchHtml()}
    </aside>
    <button class="toc-toggle" id="tocToggle" aria-label="目录">☰</button>` : ""}

    <div class="main">
      <nav class="breadcrumb">
        <a href="/">← 返回首页</a>
      </nav>

      ${!hasToc ? `
      <div class="home-search">
        <div class="search-box">
          <input type="text" id="searchInput" placeholder="搜索页面…" autocomplete="off">
          <div class="search-results" id="searchResults"></div>
        </div>
      </div>` : ""}

      ${titleHeading}

      <main>
        ${fixedBody}
      </main>

      <footer>
        <p>疏律 · 开源法律条文资料库 · Powered by <a href="https://wiki.js.org">Wiki.js</a></p>
      </footer>
    </div>
  </div>

  <script>
    // Page index for search (embedded at build time)
    const PAGE_INDEX = ${pageIndexJson};
  </script>

  ${hasToc ? `
  <script>
    // Highlight active TOC item on scroll
    (function() {
      const headings = document.querySelectorAll('h2[id], h3[id], h4[id]');
      const links = document.querySelectorAll('.sidebar .toc a');
      if (!headings.length || !links.length) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              links.forEach(a => a.classList.remove('active'));
              const link = document.querySelector('.sidebar .toc a[href="#' + entry.target.id + '"]');
              if (link) link.classList.add('active');
            }
          });
        },
        { rootMargin: '-20% 0px -70% 0px' }
      );

      headings.forEach(h => observer.observe(h));

      // Mobile: toggle sidebar
      const sidebar = document.getElementById('sidebar');
      const toggle = document.getElementById('tocToggle');
      if (toggle) {
        toggle.addEventListener('click', () => {
          sidebar.classList.toggle('open');
        });
        // Close sidebar when clicking a link (mobile)
        sidebar.querySelectorAll('a').forEach(a => {
          a.addEventListener('click', () => {
            sidebar.classList.remove('open');
          });
        });
        // Close sidebar when clicking outside
        document.addEventListener('click', (e) => {
          if (!sidebar.contains(e.target) && e.target !== toggle) {
            sidebar.classList.remove('open');
          }
        });
      }
    })();
  </script>` : ""}

  <script>
    // Client-side search (works on all pages)
    (function() {
      const input = document.getElementById('searchInput');
      const results = document.getElementById('searchResults');
      if (!input || !results) return;

      let activeIdx = -1;

      function doSearch(query) {
        activeIdx = -1;
        results.innerHTML = '';

        if (!query || query.trim().length < 1) {
          results.classList.remove('visible');
          return;
        }

        const q = query.trim().toLowerCase();
        const matches = PAGE_INDEX
          .filter(p => p.title.toLowerCase().includes(q))
          .slice(0, 10);

        if (matches.length === 0) {
          results.innerHTML = '<div class="search-no-results">无匹配结果</div>';
          results.classList.add('visible');
          return;
        }

        results.innerHTML = matches.map((p, i) =>
          '<a class="search-result-item' + (i === 0 ? ' active' : '') + '" href="' + p.path + '" data-idx="' + i + '">' +
            p.title +
            '<span class="result-path">' + p.path + '</span>' +
          '</a>'
        ).join('');

        results.classList.add('visible');
        activeIdx = 0;
      }

      input.addEventListener('input', function() {
        doSearch(this.value);
      });

      input.addEventListener('focus', function() {
        if (this.value.trim().length >= 1) {
          doSearch(this.value);
        }
      });

      // Keyboard navigation
      input.addEventListener('keydown', function(e) {
        const items = results.querySelectorAll('.search-result-item');
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIdx = Math.min(activeIdx + 1, items.length - 1);
          items.forEach(function(item, i) {
            item.classList.toggle('active', i === activeIdx);
          });
          // Scroll into view
          items[activeIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIdx = Math.max(activeIdx - 1, 0);
          items.forEach(function(item, i) {
            item.classList.toggle('active', i === activeIdx);
          });
          items[activeIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (activeIdx >= 0 && items[activeIdx]) {
            window.location.href = items[activeIdx].getAttribute('href');
          }
        } else if (e.key === 'Escape') {
          results.classList.remove('visible');
          input.blur();
        }
      });

      // Click outside to close
      document.addEventListener('click', function(e) {
        if (!input.parentElement.contains(e.target)) {
          results.classList.remove('visible');
        }
      });

      // Click on result item
      results.addEventListener('click', function(e) {
        const item = e.target.closest('.search-result-item');
        if (item) {
          window.location.href = item.getAttribute('href');
        }
      });
    })();
  </script>

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

  // ── First pass: collect page info for search index ──
  const allPagesInfo = [];
  for (const mdFile of mdFiles) {
    const srcPath = path.join(SRC_DIR, mdFile);
    const content = fs.readFileSync(srcPath, "utf-8");
    const { frontmatter } = parseFrontmatter(content);
    const title = frontmatter.title || path.basename(mdFile, ".md");
    let outPath;
    if (mdFile === "home.md") {
      outPath = "/";
    } else {
      outPath = "/" + mdFile.replace(/\.md$/, ".html");
    }
    allPagesInfo.push({ title: title, path: outPath });
  }
  console.log(`  Indexed ${allPagesInfo.length} pages for search`);

  // ── Second pass: generate HTML ──
  let processed = 0;
  let tocCount = 0;

  for (const mdFile of mdFiles) {
    const srcPath = path.join(SRC_DIR, mdFile);
    const content = fs.readFileSync(srcPath, "utf-8");

    const html = generateHtml(content, mdFile, mdFiles, allPagesInfo);

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
  console.log(`  Search enabled on all pages (${allPagesInfo.length} pages indexed)`);
}

main();
