#!/usr/bin/env python3
"""
Fix Wiki.js internal links in Markdown files.

Converts:
  [text](target "wikilink")  ->  [text](target.md)  (correct extension, URL-encoded)
  [text](/target)            ->  [text](target.md)
  [text](target)             ->  checked and fixed if target is a known page

Dead links (no matching file) are converted to plain text.

Usage: python3 scripts/fix-links.py [--dry-run] [repo_root]
"""

import os
import re
import sys
import urllib.parse


def build_file_index(repo_root):
    """Build a lookup from basename (without ext) to relative path from repo root."""
    index = {}
    dirs = set()

    for entry in os.listdir(repo_root):
        full_path = os.path.join(repo_root, entry)
        if os.path.isfile(full_path) and entry.endswith(".md"):
            base = entry[:-3]  # strip .md
            index[base] = entry
        elif os.path.isdir(full_path) and not entry.startswith("."):
            dirs.add(entry)
            # Also index files in subdirectories
            for sub_entry in os.listdir(full_path):
                if sub_entry.endswith(".md"):
                    sub_base = sub_entry[:-3]
                    # Store with relative path from root
                    index[sub_base] = f"{entry}/{sub_entry}"

    return index, dirs


def url_encode_path(filename):
    """URL-encode a filename for use in markdown links, preserving slashes."""
    # Split on / to handle paths, encode each segment
    parts = filename.split("/")
    encoded = "/".join(urllib.parse.quote(part, safe="") for part in parts)
    return encoded


def fix_wikilinks(content, file_index, dirs, dead_links_out):
    """Fix Wiki.js internal links in markdown content."""

    # Pattern 1: [text](target "wikilink") — Wiki.js internal links with title
    def replace_wikilink(match):
        text = match.group(1)
        target = match.group(2)

        # Check directories
        if target in dirs:
            encoded = url_encode_path(target)
            return f"[{text}]({encoded})"

        # Strip leading slash
        clean_target = target.lstrip("/")

        # Look up in file index
        if clean_target in file_index:
            encoded = url_encode_path(file_index[clean_target])
            return f"[{text}]({encoded})"

        # Dead link — convert to plain text
        dead_links_out.append((text, clean_target))
        return text  # plain text, no link

    WIKILINK_RE = re.compile(r'\[([^\]]+)\]\(([^")]+)\s+"wikilink"\)')
    content = WIKILINK_RE.sub(replace_wikilink, content)

    # Pattern 2: [text](/target) — links with leading slash, no wikilink title
    def replace_slash_link(match):
        text = match.group(1)
        target = match.group(2)

        clean_target = target.lstrip("/")

        if clean_target in dirs:
            encoded = url_encode_path(clean_target)
            return f"[{text}]({encoded})"

        if clean_target in file_index:
            encoded = url_encode_path(file_index[clean_target])
            return f"[{text}]({encoded})"

        # Dead link
        dead_links_out.append((text, clean_target))
        return text

    SLASH_LINK_RE = re.compile(r'\[([^\]]+)\]\((/[^)]+)\)')
    content = SLASH_LINK_RE.sub(replace_slash_link, content)

    return content


def fix_bare_links(content, file_index, dirs, dead_links_out):
    """
    Fix bare links [text](target) that point to known pages but have no extension.
    Only touches links where:
    - target has no file extension (.md, .html, etc.)
    - target is NOT an external URL (http:// or https://)
    - target matches a known page in the file index
    """
    def replace_bare(match):
        full = match.group(0)
        text = match.group(1)
        target = match.group(2)

        # Skip external URLs
        if target.startswith("http://") or target.startswith("https://"):
            return full

        # Skip if already has a file extension
        if re.search(r"\.[a-zA-Z0-9]{2,5}$", target):
            return full

        # Skip anchors
        if target.startswith("#"):
            return full

        # Skip already-URL-encoded paths (from previous wikilink fix pass)
        if "%" in target and re.search(r"%[0-9A-Fa-f]{2}", target):
            return full

        clean_target = target.lstrip("/")

        if clean_target in dirs:
            encoded = url_encode_path(clean_target)
            return f"[{text}]({encoded})"

        if clean_target in file_index:
            encoded = url_encode_path(file_index[clean_target])
            return f"[{text}]({encoded})"

        # Dead internal link (no extension, not external, not anchor)
        if not re.search(r"\.[a-zA-Z0-9]{2,5}$", target) and not target.startswith("#"):
            dead_links_out.append((text, clean_target))
            return text

        return full

    # Only match bare links that DON'T already have "wikilink" title or a file extension
    BARE_LINK_RE = re.compile(r'\[([^\]]+)\]\(([^")]+)\)')
    content = BARE_LINK_RE.sub(replace_bare, content)

    return content


def fix_file(filepath, file_index, dirs):
    """Fix all Wiki.js links in a single markdown file."""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    dead_links = []

    # Fix wikilinks
    content = fix_wikilinks(content, file_index, dirs, dead_links)

    # Fix bare links (only for known pages without extensions)
    content = fix_bare_links(content, file_index, dirs, dead_links)

    return content, dead_links


def main():
    dry_run = "--dry-run" in sys.argv
    repo_root = "."

    for arg in sys.argv[1:]:
        if not arg.startswith("--"):
            repo_root = arg
            break

    os.chdir(repo_root)
    print(f"Working in: {os.getcwd()}")

    file_index, dirs = build_file_index(".")
    print(f"Indexed {len(file_index)} .md files, {len(dirs)} directories")

    # Find files to process — all .md files
    md_files = [
        f for f in os.listdir(".")
        if f.endswith(".md") and os.path.isfile(f)
    ]

    total_fixed = 0
    total_dead = 0

    for md_file in sorted(md_files):
        content, dead_links = fix_file(md_file, file_index, dirs)

        # Count changes
        wikilink_count = content.count("wikilink")
        if dead_links:
            total_dead += len(dead_links)

        if dead_links or wikilink_count == 0:  # was fixed
            # Check if actually changed
            with open(md_file, "r", encoding="utf-8") as f:
                original = f.read()

            if content != original:
                if dry_run:
                    print(f"  WOULD FIX: {md_file} ({len(dead_links)} dead links)")
                    for text, target in dead_links:
                        print(f"    DEAD: [{text}]({target}) -> plain text")
                else:
                    with open(md_file, "w", encoding="utf-8") as f:
                        f.write(content)
                    print(f"  FIXED: {md_file} ({len(dead_links)} dead links converted to text)")
                    for text, target in dead_links:
                        print(f"    DEAD: [{text}]({target}) -> plain text")
                total_fixed += 1
            else:
                # No changes needed
                pass
        elif wikilink_count > 0:
            print(f"  WARNING: {md_file} still has {wikilink_count} wikilinks!")

    # Also check subdirectories for .md files with links
    for d in sorted(dirs):
        subdir = os.path.join(".", d)
        if os.path.isdir(subdir):
            for f in sorted(os.listdir(subdir)):
                if f.endswith(".md"):
                    subpath = os.path.join(subdir, f)
                    # These are typically standalone content — just check
                    with open(subpath, "r", encoding="utf-8") as fp:
                        sub_content = fp.read()
                    if "wikilink" in sub_content:
                        print(f"  INFO: {subpath} has wikilinks (not modified)")

    print(f"\nDone: {total_fixed} files fixed, {total_dead} dead links converted to text")

    if dry_run:
        print("DRY RUN - no changes made. Remove --dry-run to execute.")


if __name__ == "__main__":
    main()
