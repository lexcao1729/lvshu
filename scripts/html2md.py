#!/usr/bin/env python3
"""
Convert Wiki.js HTML files (ckeditor format) to Markdown.

Usage: python3 scripts/html2md.py [--dry-run] [repo_root]
"""

import os
import re
import sys
from html.parser import HTMLParser


class HTML2Markdown(HTMLParser):
    """Convert Wiki.js ckeditor HTML to Markdown."""

    def __init__(self):
        super().__init__()
        self.output = []
        self.in_figure = False
        self.in_table = False
        self.in_thead = False
        self.in_tbody = False
        self.in_th = False
        self.in_td = False
        self.in_tr = False
        self.in_li = False
        self.in_ol = False
        self.in_ul = False
        self.in_strong = False
        self.in_a = False
        self.in_p = False
        self.a_href = ""
        self.a_text = ""
        self.table_rows = []
        self.current_row = []
        self.current_cell = ""
        self.list_counter = 0
        self.p_has_content = False
        self.skip_next_br = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        if tag == "figure" and attrs_dict.get("class") == "table":
            self.in_figure = True
            self.in_table = True
            self.table_rows = []
        elif tag == "table" and not self.in_figure:
            self.in_table = True
            self.table_rows = []
        elif tag == "thead":
            self.in_thead = True
        elif tag == "tbody":
            self.in_tbody = True
        elif tag == "tr":
            self.in_tr = True
            self.current_row = []
        elif tag in ("th", "td"):
            if tag == "th":
                self.in_th = True
            else:
                self.in_td = True
            self.current_cell = ""
        elif tag == "ol":
            self.in_ol = True
            self.list_counter = 0
        elif tag == "ul":
            self.in_ul = True
        elif tag == "li":
            self.in_li = True
            if self.in_ol:
                self.list_counter += 1
        elif tag == "p":
            self.in_p = True
            self.p_has_content = False
        elif tag == "strong":
            self.in_strong = True
            self.output.append("**")
        elif tag == "a":
            self.in_a = True
            self.a_href = attrs_dict.get("href", "")
            self.a_text = ""
        elif tag == "br":
            if self.in_p:
                self.output.append("\n")
            else:
                self.output.append("\n")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self.output.append("\n" + "#" * level + " ")

    def handle_endtag(self, tag):
        if tag == "figure" and self.in_figure:
            self.in_figure = False
            self.in_table = False
            self._flush_table()
        elif tag == "table" and self.in_table and not self.in_figure:
            self.in_table = False
            self._flush_table()
        elif tag == "thead":
            self.in_thead = False
        elif tag == "tbody":
            self.in_tbody = False
        elif tag == "tr":
            self.in_tr = False
            if self.current_row:
                self.table_rows.append(self.current_row)
        elif tag in ("th", "td"):
            if self.in_th:
                self.in_th = False
            if self.in_td:
                self.in_td = False
            self.current_row.append(self.current_cell.strip())
            self.current_cell = ""
        elif tag == "ol":
            self.in_ol = False
            self.output.append("\n")
        elif tag == "ul":
            self.in_ul = False
        elif tag == "li":
            self.in_li = False
            self.output.append("\n")
        elif tag == "p":
            self.in_p = False
            if self.p_has_content:
                self.output.append("\n\n")
            else:
                self.output.append("\n")
        elif tag == "strong":
            self.in_strong = True
            self.output.append("**")
        elif tag == "a":
            self.in_a = False
            text = self.a_text.strip()
            href = self.a_href.strip()
            if text and href:
                self.output.append(f"[{text}]({href})")
            elif text:
                self.output.append(text)
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.output.append("\n\n")

    def handle_data(self, data):
        if self.in_th or self.in_td:
            self.current_cell += data
        elif self.in_a:
            self.a_text += data
            self.output.append(data)
        else:
            # Clean up whitespace
            text = data
            if self.in_p and not self.p_has_content:
                text = text.lstrip()
                if text:
                    self.p_has_content = True
            self.output.append(text)

    def handle_entityref(self, name):
        entities = {
            "nbsp": " ",
            "lt": "<",
            "gt": ">",
            "amp": "&",
            "quot": '"',
            "apos": "'",
        }
        char = entities.get(name, f"&{name};")
        if self.in_th or self.in_td:
            self.current_cell += char
        elif self.in_a:
            self.a_text += char
            self.output.append(char)
        else:
            self.output.append(char)

    def _flush_table(self):
        if not self.table_rows:
            return
        self.output.append("\n\n")
        # Max columns
        max_cols = max(len(row) for row in self.table_rows) if self.table_rows else 0
        if max_cols == 0:
            return

        # Normalize rows
        for row in self.table_rows:
            while len(row) < max_cols:
                row.append("")

        # Header row
        header = self.table_rows[0]
        self.output.append("| " + " | ".join(header) + " |\n")
        self.output.append("| " + " | ".join(["---"] * max_cols) + " |\n")

        # Body rows
        for row in self.table_rows[1:]:
            self.output.append("| " + " | ".join(row) + " |\n")

        self.output.append("\n")

    def get_markdown(self):
        # Clean up output
        text = "".join(self.output)
        # Fix multiple blank lines
        text = re.sub(r"\n{4,}", "\n\n", text)
        # Remove trailing whitespace on lines
        text = re.sub(r" +\n", "\n", text)
        # Remove spaces before newlines
        text = re.sub(r" \n", "\n", text)
        return text.strip() + "\n"


def convert_html_to_md(html_content):
    """Convert Wiki.js ckeditor HTML content to Markdown."""
    # Extract frontmatter from HTML comment
    frontmatter = {}
    body_start = 0

    # Match the Wiki.js HTML comment frontmatter
    comment_match = re.match(r"<!--\n(.*?)\n-->\n*", html_content, re.DOTALL)
    if comment_match:
        comment_text = comment_match.group(1)
        for line in comment_text.strip().split("\n"):
            if ":" in line:
                key, _, value = line.partition(":")
                frontmatter[key.strip()] = value.strip()
        body_start = comment_match.end()

    body_html = html_content[body_start:].strip()

    if not body_html:
        return html_content  # nothing to convert

    parser = HTML2Markdown()
    parser.feed(body_html)
    body_md = parser.get_markdown()

    # Build output with YAML frontmatter (convert editor field)
    fm_lines = ["---"]
    for key, value in frontmatter.items():
        if key == "editor":
            fm_lines.append(f"editor: markdown")
        else:
            fm_lines.append(f"{key}: {value}")
    fm_lines.append("---")
    fm_lines.append("")
    fm_lines.append(body_md)

    return "\n".join(fm_lines)


def main():
    dry_run = "--dry-run" in sys.argv
    repo_root = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].startswith("--") else "."
    if repo_root == "html2md.py":
        repo_root = "."

    # If called from scripts/ dir, adjust
    if os.path.basename(os.getcwd()) == "scripts":
        repo_root = ".."
    elif repo_root == "." and os.path.exists("../home.md"):
        repo_root = ".."

    os.chdir(repo_root)
    print(f"Working in: {os.getcwd()}")

    # Find all HTML files recursively (but skip .git, scripts dirs)
    html_files = []
    for dirpath, dirnames, filenames in os.walk("."):
        # Skip hidden dirs and scripts
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "scripts"]
        for f in filenames:
            if f.endswith(".html"):
                html_files.append(os.path.join(dirpath, f))

    print(f"Found {len(html_files)} HTML files")

    converted = 0
    skipped = 0
    errors = 0

    for html_path in sorted(html_files):
        dirname = os.path.dirname(html_path)
        basename = os.path.basename(html_path)
        md_file = basename[:-5] + ".md"
        md_path = os.path.join(dirname, md_file)

        # Check if MD already exists
        if os.path.exists(md_path):
            print(f"  SKIP: {html_path} -> {md_path} (already exists, will delete .html)")
            if not dry_run:
                os.remove(html_path)
                print(f"    Deleted: {html_path}")
            skipped += 1
            continue

        try:
            with open(html_path, "r", encoding="utf-8") as f:
                html_content = f.read()

            md_content = convert_html_to_md(html_content)

            if dry_run:
                print(f"  WOULD CONVERT: {html_path} -> {md_path}")
            else:
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(md_content)
                os.remove(html_path)
                print(f"  OK: {html_path} -> {md_path}")

            converted += 1
        except Exception as e:
            print(f"  ERROR: {html_path}: {e}")
            errors += 1

    print(f"\nDone: {converted} converted, {skipped} skipped (MD exists), {errors} errors")

    if dry_run:
        print("DRY RUN - no changes made. Remove --dry-run to execute.")


if __name__ == "__main__":
    main()
