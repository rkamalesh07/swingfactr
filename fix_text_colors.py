#!/usr/bin/env python3
"""
fix_text_colors.py
Run from project root: python3 fix_text_colors.py
Fixes every .tsx file in src/app to use readable text colors.
"""
import os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), 'src')

# ── Exact string replacements ─────────────────────────────────────────────────
# Format: (old, new)
# Ordered from darkest (most invisible) to lightest

EXACT = [
    # ── Near-black text (invisible) → dim but visible ─────────────────────────
    ("color: '#0d0d0d'",   "color: '#787672'"),
    ("color: '#111'",      "color: '#787672'"),
    ("color: '#1a1a1a'",   "color: '#787672'"),
    ("color: '#1a1a2'",    "color: '#787672'"),
    ("color: '#1f1f24'",   "color: '#787672'"),
    ("color: '#2a2a2a'",   "color: '#787672'"),
    ("color: '#222'",      "color: '#787672'"),
    ("color: '#222228'",   "color: '#787672'"),
    ("color: '#2e2e36'",   "color: '#787672'"),
    ("color:'#0d0d0d'",    "color:'#787672'"),
    ("color:'#111'",       "color:'#787672'"),
    ("color:'#1a1a1a'",    "color:'#787672'"),
    ("color:'#2a2a2a'",    "color:'#787672'"),
    ("color:'#222'",       "color:'#787672'"),
    ("color:'#222228'",    "color:'#787672'"),
    ("color:'#2e2e36'",    "color:'#787672'"),

    # ── Dark grey → readable medium grey ──────────────────────────────────────
    ("color: '#333'",      "color: '#909090'"),
    ("color: '#444'",      "color: '#909090'"),
    ("color:'#333'",       "color:'#909090'"),
    ("color:'#444'",       "color:'#909090'"),

    # ── Medium grey → clearly readable ────────────────────────────────────────
    ("color: '#555'",      "color: '#b0aea8'"),
    ("color:'#555'",       "color:'#b0aea8'"),

    # ── Dark backgrounds → slightly elevated ──────────────────────────────────
    ("background: '#080808'",   "background: '#0e0e12'"),
    ("background:'#080808'",    "background:'#0e0e12'"),
    ("background: '#0a0a0a'",   "background: '#141418'"),
    ("background:'#0a0a0a'",    "background:'#141418'"),
    ("background: '#0d0d0d'",   "background: '#141418'"),
    ("background:'#0d0d0d'",    "background:'#141418'"),

    # ── Borders (near-invisible) → slightly visible ────────────────────────────
    ("border: '1px solid #0d0d0d'",    "border: '1px solid #222228'"),
    ("border: '1px solid #0f0f0f'",    "border: '1px solid #222228'"),
    ("border: '1px solid #111'",       "border: '1px solid #222228'"),
    ("borderBottom: '1px solid #0d0d0d'", "borderBottom: '1px solid #1f1f24'"),
    ("borderBottom: '1px solid #0f0f0f'", "borderBottom: '1px solid #1f1f24'"),
    ("borderBottom: '1px solid #111'",    "borderBottom: '1px solid #222228'"),
    ("borderBottom: '1px solid #1a1a1a'", "borderBottom: '1px solid #222228'"),
    ("borderTop: '1px solid #0d0d0d'",    "borderTop: '1px solid #1f1f24'"),
    ("borderTop: '1px solid #111'",       "borderTop: '1px solid #222228'"),
    ("borderTop: '1px solid #1a1a1a'",    "borderTop: '1px solid #222228'"),
    ("borderLeft: '1px solid #111'",      "borderLeft: '1px solid #222228'"),
    ("borderRight: '1px solid #0d0d0d'",  "borderRight: '1px solid #1f1f24'"),
    ("borderRight: '1px solid #111'",     "borderRight: '1px solid #222228'"),
    ("borderBottom: '1px solid #1a1a20'", "borderBottom: '1px solid #222228'"),
    ("borderTop: '1px solid #1a1a20'",    "borderTop: '1px solid #222228'"),

    # ── Specific dim text patterns common across pages ─────────────────────────
    # Header/label patterns
    ("letterSpacing: '0.12em', color: '#2a2a2a'",  "letterSpacing: '0.12em', color: '#787672'"),
    ("letterSpacing: '0.1em', color: '#2a2a2a'",   "letterSpacing: '0.1em', color: '#787672'"),
    ("letterSpacing: '0.08em', color: '#2a2a2a'",  "letterSpacing: '0.08em', color: '#787672'"),
    ("letterSpacing: '0.15em', color: '#2a2a2a'",  "letterSpacing: '0.15em', color: '#787672'"),
    ("letterSpacing: '0.18em', color: '#2a2a2a'",  "letterSpacing: '0.18em', color: '#787672'"),
    ("letterSpacing: '0.06em', color: '#2a2a2a'",  "letterSpacing: '0.06em', color: '#787672'"),
    ("letterSpacing: '0.1em', color: '#222'",       "letterSpacing: '0.1em', color: '#787672'"),
    ("letterSpacing: '0.15em', color: '#222'",      "letterSpacing: '0.15em', color: '#787672'"),

    # ── Upgrade dim active sort colors ────────────────────────────────────────
    ("color: sortKey === s.key ? '#4ade80' : '#2a2a2a'",  "color: sortKey === s.key ? '#c8f135' : '#787672'"),
    ("color: sortKey === s.key ? '#e0e0e0' : '#444'",      "color: sortKey === s.key ? '#f2f0eb' : '#b0aea8'"),

    # ── Dim meta text on stat rows ─────────────────────────────────────────────
    ("color: '#333', letterSpacing: '0.1em'",  "color: '#909090', letterSpacing: '0.1em'"),
    ("color: '#444', letterSpacing: '0.1em'",  "color: '#909090', letterSpacing: '0.1em'"),
    ("color: '#333', letterSpacing: '0.08em'", "color: '#909090', letterSpacing: '0.08em'"),
    ("color: '#444', letterSpacing: '0.08em'", "color: '#909090', letterSpacing: '0.08em'"),
    ("color: '#444', textAlign: 'center'",     "color: '#b0aea8', textAlign: 'center'"),
    ("color: '#333', textAlign: 'center'",     "color: '#b0aea8', textAlign: 'center'"),
    ("color: '#444', textAlign: 'right'",      "color: '#b0aea8', textAlign: 'right'"),
    ("color: '#333', textAlign: 'right'",      "color: '#b0aea8', textAlign: 'right'"),
]

# ── Regex replacements for patterns not caught by exact match ─────────────────
REGEX = [
    # fontFamily mono + dark color patterns
    (r"(fontFamily:\s*MONO,\s*fontSize:\s*'[0-9]+px',\s*color:\s*)'#(222|333|444|555|2a2a2a|1a1a1a|0d0d0d|111)'",
     lambda m: m.group(0).replace(m.group(0).split("'#")[1].split("'")[0],
         {'222':'787672','333':'909090','444':'909090','555':'b0aea8',
          '2a2a2a':'787672','1a1a1a':'787672','0d0d0d':'787672','111':'787672'}
         .get(m.group(0).split("'#")[1].split("'")[0], '787672'))),
]

def fix_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content

    for old, new in EXACT:
        content = content.replace(old, new)

    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

def walk_and_fix(root):
    changed = []
    skipped = []
    for dirpath, _, files in os.walk(root):
        # Skip node_modules, .next, build artifacts
        if any(x in dirpath for x in ['node_modules', '.next', '__pycache__', '.git']):
            continue
        for fname in files:
            if not fname.endswith('.tsx'):
                continue
            fpath = os.path.join(dirpath, fname)
            try:
                if fix_file(fpath):
                    changed.append(fpath.replace(ROOT, ''))
                else:
                    skipped.append(fname)
            except Exception as e:
                print(f"ERROR {fpath}: {e}")
    return changed, skipped

if __name__ == '__main__':
    print(f"Scanning {ROOT}...")
    changed, skipped = walk_and_fix(ROOT)
    print(f"\n✓ Changed {len(changed)} files:")
    for f in sorted(changed):
        print(f"  {f}")
    print(f"\n— Unchanged: {len(skipped)} files")
