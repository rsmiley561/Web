"""Rewrites a Google Fonts css2 response into a self-hosted stylesheet.

Keeps only the latin and latin-ext subsets, downloads each .woff2 into
assets/fonts/, and emits assets/fonts.css with local URLs. Called by
tools/build-fonts.sh — not meant to be run directly.
"""
import hashlib
import os
import re
import subprocess
import sys

src = open(sys.argv[1]).read()

# Google emits one @font-face per subset, each preceded by a /* subset */ comment.
blocks = re.findall(r"/\*\s*([a-z0-9\-\[\]]+)\s*\*/\s*(@font-face\s*\{[^}]*\})", src)
keep = [b for name, b in blocks if name in ("latin", "latin-ext")]
if not keep:
    sys.exit("no latin subsets found — did the css2 response change shape?")

os.makedirs("assets/fonts", exist_ok=True)
for stale in os.listdir("assets/fonts"):
    os.remove(os.path.join("assets/fonts", stale))

seen: dict[str, str] = {}
out = []

for block in keep:
    family = re.search(r"font-family:\s*'([^']+)'", block).group(1)
    style_m = re.search(r"font-style:\s*(\w+)", block)
    style = style_m.group(1) if style_m else "normal"

    def repl(m: re.Match) -> str:
        url = m.group(1)
        if url not in seen:
            slug = family.lower().replace(" ", "-")
            digest = hashlib.md5(url.encode()).hexdigest()[:6]
            name = f"{slug}-{style}-{digest}.woff2"
            subprocess.run(["curl", "-sSf", "-o", f"assets/fonts/{name}", url], check=True)
            seen[url] = name
        return f"url('../assets/fonts/{seen[url]}')"

    out.append(re.sub(r"url\((https://fonts\.gstatic\.com[^)]+)\)", repl, block))

header = (
    "/* Self-hosted subset of Google Fonts (latin + latin-ext).\n"
    "   GENERATED — regenerate with `bash tools/build-fonts.sh`.\n"
    "   Self-hosting removes a third-party request from the critical path and\n"
    "   keeps the site rendering correctly where Google Fonts is unreachable. */\n"
)
open("assets/fonts.css", "w").write(header + "\n".join(out) + "\n")
print(f"{len(keep)} @font-face rules, {len(seen)} woff2 files")
