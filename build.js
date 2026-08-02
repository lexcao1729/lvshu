/**
 * Cloudflare Pages build script.
 *
 * Features:
 * - Wiki.js YAML frontmatter → title, description
 * - Markdown → HTML via marked (GFM)
 * - home.md → index.html
 * - Collapsible TOC sidebar (auto-expand current section, collapse others)
 * - Full-text client-side search (title + body content)
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const SRC_DIR = ".";
const OUT_DIR = "_site";

// ── Globals reset per page ──
let tocTree = [];      // [{ heading: {text,level,id}, children: [{text,level,id},...] }]
let currentSection = null;

// ── Utilities ──

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w一-鿿㐀-䶿豈-﫿-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "heading";
}

function mdToPlainText(md) {
  return md
    .replace(/^---[\s\S]*?\n---\n?/, "")   // YAML frontmatter
    .replace(/^#{1,6}\s+/gm, "")            // heading markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")      // bold
    .replace(/__([^_]+)__/g, "$1")          // bold (alt)
    .replace(/\*([^*]+)\*/g, "$1")          // italic
    .replace(/_([^_]+)_/g, "$1")            // italic (alt)
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")     // inline + fenced code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")// links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")// images
    .replace(/^\s*[-*+]\s+/gm, " ")         // ul markers
    .replace(/^\s*\d+[.)]\s+/gm, " ")       // ol markers
    .replace(/[|>-]/g, " ")                 // table pipes, blockquote, etc.
    .replace(/\n+/g, " ")                   // newlines → space
    .replace(/\s{2,}/g, " ")                // collapse whitespace
    .trim();
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Marked setup ──

const renderer = new marked.Renderer();

renderer.heading = function (text, level) {
  const id = slugify(text);
  const sizes = { 1: "1.8em", 2: "1.5em", 3: "1.3em", 4: "1.1em" };
  const cleanText = text.replace(/<[^>]+>/g, "");

  if (level === 2) {
    currentSection = { heading: { text: cleanText, level, id }, children: [] };
    tocTree.push(currentSection);
  } else if (level >= 3 && level <= 4) {
    const item = { text: cleanText, level, id };
    if (currentSection) {
      currentSection.children.push(item);
    } else {
      // h3/h4 without preceding h2 — treat as top-level
      tocTree.push({ heading: item, children: [] });
    }
  }

  return `<h${level} id="${id}" style="margin-top:1.5em;margin-bottom:0.5em;font-size:${sizes[level] || "1em"}">${text}</h${level}>`;
};

renderer.paragraph = function (text) {
  return `<p style="margin:0.8em 0;line-height:1.8">${text}</p>`;
};

marked.setOptions({ renderer, gfm: true, breaks: false });

// ── Frontmatter ──

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fmText = match[1];
  const body = match[2];
  const frontmatter = {};
  for (const line of fmText.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      frontmatter[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
    }
  }
  return { frontmatter, body };
}

// ── TOC generation (collapsible tree) ──

function generateToc(tree) {
  if (tree.length < 2 && (tree.length === 0 || tree[0].children.length === 0)) {
    // Need at least 2 items total to justify a TOC
    const total = tree.reduce((sum, s) => sum + 1 + s.children.length, 0);
    if (total < 2) return "";
  }

  let html = '<nav class="toc">\n';
  html += '  <div class="toc-title">目录</div>\n';
  html += '  <ul class="toc-tree">\n';

  for (const section of tree) {
    const h = section.heading;
    const kids = section.children;
    const hasKids = kids.length > 0;

    html += '    <li class="toc-section">\n';
    html += '      <div class="toc-row">\n';
    if (hasKids) {
      html += '        <button class="toc-chevron" aria-label="展开/折叠">▸</button>\n';
    } else {
      html += '        <span class="toc-chevron-placeholder"></span>\n';
    }
    html += `        <a href="#${h.id}" class="toc-link toc-h${h.level}">${escapeHtml(h.text)}</a>\n`;
    html += '      </div>\n';

    if (hasKids) {
      html += '      <ul class="toc-sub">\n';
      for (const c of kids) {
        html += `        <li class="toc-h${c.level}"><a href="#${c.id}" class="toc-link">${escapeHtml(c.text)}</a></li>\n`;
      }
      html += '      </ul>\n';
    }
    html += '    </li>\n';
  }

  html += '  </ul>\n</nav>\n';
  return html;
}

// ── Search HTML snippet ──

function generateSearchHtml() {
  return `
    <div class="sidebar-search">
      <div class="search-title">搜索</div>
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="搜索标题或内容…" autocomplete="off">
        <div class="search-results" id="searchResults"></div>
      </div>
    </div>`;
}

// ── Page generator ──

function generateHtml(mdContent, filePath, allPages) {
  tocTree = [];
  currentSection = null;

  const { frontmatter, body } = parseFrontmatter(mdContent);
  const title = frontmatter.title || path.basename(filePath, ".md");
  const description = frontmatter.description || "";

  const htmlBody = marked.parse(body);

  // Fix internal links: .md → .html, home → /
  const fixedBody = htmlBody.replace(
    /href="([^"]+)\.md"/g,
    (match, p1) => {
      if (p1.startsWith("http://") || p1.startsWith("https://")) return match;
      if (p1 === "home" || p1.endsWith("/home")) return 'href="/"';
      return `href="${p1}.html"`;
    }
  );

  const tocHtml = generateToc(tocTree);
  const hasToc = tocHtml !== "";

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
      --active-bg: #eff6ff;
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
        --active-bg: #1e293b;
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
    .page { display: flex; max-width: 1100px; margin: 0 auto; min-height: 100vh; }

    /* ── Sidebar ── */
    .sidebar {
      width: 240px; flex-shrink: 0;
      padding: 2rem 0 2rem 1.5rem;
      position: sticky; top: 0; height: 100vh;
      overflow-y: auto;
      border-right: 1px solid var(--border);
      background: var(--sidebar-bg);
      font-size: 0.88em;
      display: flex; flex-direction: column;
    }
    .sidebar .toc { flex: 0 0 auto; }
    .sidebar .toc-title {
      font-weight: 700; font-size: 0.85em;
      text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--muted); margin-bottom: 0.8em;
    }

    /* ── Collapsible TOC tree ── */
    .toc-tree { list-style: none; padding: 0; }
    .toc-section { margin: 0.15em 0; }
    .toc-row { display: flex; align-items: baseline; }
    .toc-chevron {
      background: none; border: none;
      color: var(--muted); cursor: pointer;
      padding: 0 0.35em 0 0; font-size: 0.72em;
      line-height: 1; flex-shrink: 0;
      transition: transform 0.2s;
      user-select: none;
    }
    .toc-chevron:hover { color: var(--link); }
    .toc-chevron-placeholder {
      display: inline-block; width: 1em; flex-shrink: 0;
    }
    .toc-section.open > .toc-row .toc-chevron {
      transform: rotate(90deg);
    }
    .toc-link {
      color: var(--muted); text-decoration: none;
      display: block; padding: 0.12em 0;
      transition: color 0.15s;
    }
    .toc-link:hover { color: var(--link); }
    .toc-link.active {
      color: var(--active); font-weight: 600;
    }
    .toc-h2 { font-weight: 500; }
    .toc-h3 { padding-left: 0.3em; font-size: 0.93em; }
    .toc-h4 { padding-left: 0.6em; font-size: 0.88em; }
    .toc-sub { display: none; list-style: none; padding: 0; }
    .toc-section.open > .toc-sub { display: block; }

    /* ── Sidebar search ── */
    .sidebar-search {
      flex: 1 0 auto; margin-top: 1.5rem; padding-top: 1rem;
      border-top: 1px solid var(--border);
      display: flex; flex-direction: column; min-height: 0;
    }
    .sidebar-search .search-title {
      font-weight: 700; font-size: 0.85em;
      text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--muted); margin-bottom: 0.6em;
    }
    .search-box { position: relative; }
    .search-box input {
      width: 100%; padding: 0.4em 0.6em;
      border: 1px solid var(--border); border-radius: 6px;
      background: var(--bg); color: var(--text);
      font-size: 0.9em; font-family: inherit; outline: none;
      transition: border-color 0.15s;
    }
    .search-box input:focus { border-color: var(--link); }
    .search-results {
      display: none; position: absolute;
      top: 100%; left: 0; right: 0; margin-top: 4px;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 6px; max-height: 320px; overflow-y: auto;
      z-index: 50; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .search-results.visible { display: block; }
    .search-result-item {
      display: block; padding: 0.45em 0.8em;
      color: var(--text); text-decoration: none;
      cursor: pointer; border-bottom: 1px solid var(--border);
      font-size: 0.92em;
    }
    .search-result-item:last-child { border-bottom: none; }
    .search-result-item:hover,
    .search-result-item.active { background: var(--code-bg); color: var(--link); }
    .search-result-item .result-title { font-weight: 500; }
    .search-result-item .result-snippet {
      display: block; font-size: 0.8em; color: var(--muted);
      margin-top: 0.15em; line-height: 1.4;
      overflow: hidden; text-overflow: ellipsis;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .search-no-results {
      padding: 0.6em 0.8em; color: var(--muted);
      font-size: 0.88em; text-align: center;
    }

    /* ── Homepage search ── */
    .home-search { margin-bottom: 1.5rem; }
    .home-search .search-box { max-width: 420px; }
    .home-search .search-box input { padding: 0.55em 0.8em; font-size: 0.95em; }

    /* Mobile TOC toggle */
    .toc-toggle {
      display: none; position: fixed; bottom: 1.5rem; right: 1.5rem;
      width: 44px; height: 44px; border-radius: 50%;
      background: var(--link); color: #fff; border: none;
      font-size: 1.2em; cursor: pointer; z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    /* ── Main content ── */
    .main {
      flex: 1; min-width: 0; padding: 2rem 2rem 3rem 2.5rem; max-width: 760px;
    }
    nav.breadcrumb { margin-bottom: 1rem; font-size: 0.9em; }
    nav.breadcrumb a { color: var(--link); text-decoration: none; }
    nav.breadcrumb a:hover { color: var(--link-hover); text-decoration: underline; }
    .page.no-sidebar .main {
      max-width: 800px; margin: 0 auto;
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
        display: none; position: fixed; top: 0; left: 0;
        width: 280px; height: 100vh; z-index: 99;
        padding: 2rem 1.5rem; border-right: 1px solid var(--border);
        box-shadow: 2px 0 12px rgba(0,0,0,0.15);
      }
      .sidebar.open { display: flex; }
      .toc-toggle { display: flex; align-items: center; justify-content: center; }
      .main { padding: 1.5rem 1rem 5rem 1rem; }
      .page.no-sidebar .main { padding: 1.5rem 1rem 3rem 1rem; }
      h1 { font-size: 1.4em; }
      .search-results { max-height: 240px; }
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
          <input type="text" id="searchInput" placeholder="搜索标题或内容…" autocomplete="off">
          <div class="search-results" id="searchResults"></div>
        </div>
      </div>` : ""}

      <h1>${escapeHtml(title)}</h1>

      <main>${fixedBody}</main>

      <footer>
        <p>疏律 · 开源法律条文资料库 · Powered by <a href="https://wiki.js.org">Wiki.js</a></p>
      </footer>
    </div>
  </div>

  <script>
    // ── Collapsible TOC + auto-expand on scroll ──
    (function() {
      var sections = document.querySelectorAll('.toc-section');
      var tocLinks = document.querySelectorAll('.toc-link');
      var headings = document.querySelectorAll('h2[id], h3[id], h4[id]');
      if (!sections.length || !headings.length) return;

      // Track manually toggled sections so auto-expand doesn't fight user
      var pinned = {};

      // Chevron click: manual toggle + pin
      document.querySelectorAll('.toc-chevron').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var section = btn.closest('.toc-section');
          var h2Id = section.querySelector('.toc-h2');
          var id = h2Id ? h2Id.getAttribute('href').replace('#', '') : '';
          var isOpen = section.classList.contains('open');
          if (isOpen) {
            section.classList.remove('open');
            if (id) pinned[id] = 'closed';
          } else {
            section.classList.add('open');
            if (id) pinned[id] = 'open';
          }
        });
      });

      // IntersectionObserver: highlight + auto-expand current section
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          var targetId = entry.target.id;

          // Highlight the matching TOC link
          tocLinks.forEach(function(a) { a.classList.remove('active'); });
          var activeLink = document.querySelector('.toc-link[href="#' + targetId + '"]');
          if (activeLink) activeLink.classList.add('active');

          // Find which toc-section contains this heading
          var section = activeLink ? activeLink.closest('.toc-section') : null;
          if (!section) return;

          // Determine the h2 section id for pinning check
          var h2Link = section.querySelector('.toc-h2');
          var sectionId = h2Link ? h2Link.getAttribute('href').replace('#', '') : '';

          sections.forEach(function(s) {
            if (s === section) {
              // Auto-open current section (unless user pinned it closed)
              if (pinned[sectionId] !== 'closed') {
                s.classList.add('open');
              }
            } else {
              // Auto-close others (unless user pinned them open)
              var otherH2 = s.querySelector('.toc-h2');
              var otherId = otherH2 ? otherH2.getAttribute('href').replace('#', '') : '';
              if (pinned[otherId] !== 'open') {
                s.classList.remove('open');
              }
            }
          });
        });
      }, { rootMargin: '-10% 0px -70% 0px' });

      headings.forEach(function(h) { observer.observe(h); });

      // ── Mobile sidebar toggle ──
      var sidebar = document.getElementById('sidebar');
      var toggle = document.getElementById('tocToggle');
      if (toggle && sidebar) {
        toggle.addEventListener('click', function() {
          sidebar.classList.toggle('open');
        });
        sidebar.querySelectorAll('a').forEach(function(a) {
          a.addEventListener('click', function() { sidebar.classList.remove('open'); });
        });
        document.addEventListener('click', function(e) {
          if (!sidebar.contains(e.target) && e.target !== toggle) {
            sidebar.classList.remove('open');
          }
        });
      }
    })();
  </script>

  <script>
    // ── Full-text search (lazy-loads search-index.json) ──
    (function() {
      var input = document.getElementById('searchInput');
      var results = document.getElementById('searchResults');
      if (!input || !results) return;

      var searchIndex = null;
      var activeIdx = -1;
      var loading = false;

      function loadIndex(cb) {
        if (searchIndex) { cb(); return; }
        if (loading) {
          // Wait a bit for the load to finish
          var check = setInterval(function() {
            if (searchIndex) { clearInterval(check); cb(); }
          }, 100);
          return;
        }
        loading = true;
        fetch('/search-index.json')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            searchIndex = data;
            loading = false;
            cb();
          })
          .catch(function() {
            loading = false;
            results.innerHTML = '<div class="search-no-results">搜索索引加载失败</div>';
            results.classList.add('visible');
          });
      }

      function doSearch(query) {
        activeIdx = -1;
        results.innerHTML = '';
        if (!query || query.trim().length < 1) {
          results.classList.remove('visible');
          return;
        }
        var q = query.trim().toLowerCase();

        loadIndex(function() {
          if (!searchIndex) return;
          var matches = [];
          for (var i = 0; i < searchIndex.length; i++) {
            var p = searchIndex[i];
            var inTitle = p.title.toLowerCase().indexOf(q) !== -1;
            var inText = p.text && p.text.toLowerCase().indexOf(q) !== -1;
            if (inTitle || inText) {
              matches.push({ page: p, inTitle: inTitle, inText: inText });
              if (matches.length >= 12) break;
            }
          }

          if (matches.length === 0) {
            results.innerHTML = '<div class="search-no-results">无匹配结果</div>';
            results.classList.add('visible');
            return;
          }

          results.innerHTML = matches.map(function(m, i) {
            var p = m.page;
            var snippet = '';
            if (p.text) {
              var idx = p.text.toLowerCase().indexOf(q);
              if (idx >= 0) {
                var start = Math.max(0, idx - 30);
                var end = Math.min(p.text.length, idx + q.length + 80);
                snippet = (start > 0 ? '…' : '') + p.text.substring(start, end) + (end < p.text.length ? '…' : '');
              } else {
                snippet = p.text.substring(0, 120) + (p.text.length > 120 ? '…' : '');
              }
            }
            return '<a class="search-result-item' + (i === 0 ? ' active' : '') +
              '" href="' + p.path + '" data-idx="' + i + '">' +
              '<span class="result-title">' + p.title + '</span>' +
              (snippet ? '<span class="result-snippet">' + snippet + '</span>' : '') +
              '</a>';
          }).join('');

          results.classList.add('visible');
          activeIdx = 0;
        });
      }

      var timer;
      input.addEventListener('input', function() {
        clearTimeout(timer);
        var val = this.value;
        timer = setTimeout(function() { doSearch(val); }, 150);
      });

      input.addEventListener('focus', function() {
        if (this.value.trim().length >= 1) doSearch(this.value);
      });

      // Keyboard
      input.addEventListener('keydown', function(e) {
        var items = results.querySelectorAll('.search-result-item');
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIdx = Math.min(activeIdx + 1, items.length - 1);
          items.forEach(function(item, i) { item.classList.toggle('active', i === activeIdx); });
          items[activeIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIdx = Math.max(activeIdx - 1, 0);
          items.forEach(function(item, i) { item.classList.toggle('active', i === activeIdx); });
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

      // Click outside → close
      document.addEventListener('click', function(e) {
        if (!input.parentElement.contains(e.target)) {
          results.classList.remove('visible');
        }
      });

      // Click result → navigate
      results.addEventListener('click', function(e) {
        var item = e.target.closest('.search-result-item');
        if (item) window.location.href = item.getAttribute('href');
      });
    })();
  </script>
</body>
</html>`;
}

// ── File discovery ──

function findMdFiles(dir, baseDir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "_site" || entry.name === "scripts")
      continue;
    const fp = path.join(dir, entry.name);
    const rp = path.relative(baseDir, fp);
    if (entry.isDirectory()) {
      results.push(...findMdFiles(fp, baseDir));
    } else if (entry.name.endsWith(".md")) {
      results.push(rp);
    }
  }
  return results;
}

// ── Main ──

function main() {
  console.log("Building 疏律 static site...\n");

  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const mdFiles = findMdFiles(SRC_DIR, SRC_DIR);
  console.log("Found " + mdFiles.length + " Markdown files");

  // ── Pass 1: collect search index (title + body text) ──
  const allPagesInfo = [];
  for (const mf of mdFiles) {
    const content = fs.readFileSync(path.join(SRC_DIR, mf), "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    const title = frontmatter.title || path.basename(mf, ".md");
    const outPath = mf === "home.md" ? "/" : "/" + mf.replace(/\.md$/, ".html");
    const text = mdToPlainText(body).substring(0, 600); // keep index compact
    allPagesInfo.push({ title: title, path: outPath, text: text });
  }

  // Write search index for lazy-loading by the frontend
  fs.writeFileSync(path.join(OUT_DIR, "search-index.json"), JSON.stringify(allPagesInfo), "utf-8");
  console.log("  Search index: " + allPagesInfo.length + " pages (" + (JSON.stringify(allPagesInfo).length / 1024).toFixed(1) + " KB)");

  // ── Pass 2: generate HTML pages ──
  let processed = 0, tocCount = 0;

  for (const mf of mdFiles) {
    const content = fs.readFileSync(path.join(SRC_DIR, mf), "utf-8");
    const html = generateHtml(content, mf, mdFiles);

    if (tocTree.reduce((s, sec) => s + 1 + sec.children.length, 0) >= 2) tocCount++;

    const outRel = mf === "home.md" ? "index.html" : mf.replace(/\.md$/, ".html");
    const outPath = path.join(OUT_DIR, outRel);
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, html, "utf-8");

    processed++;
    if (processed % 50 === 0) console.log("  " + processed + "/" + mdFiles.length + "...");
  }

  console.log("\nBuild complete: " + processed + " pages → " + OUT_DIR + "/");
  console.log("  index.html (home)");
  console.log("  " + (processed - 1) + " content pages");
  console.log("  " + tocCount + " pages with collapsible TOC");
  console.log("  search-index.json (" + allPagesInfo.length + " pages)");
}

main();
