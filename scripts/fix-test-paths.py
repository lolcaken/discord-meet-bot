"""
Fix the relative paths in tests/ after they moved out of the repo root.

  ./src/...  ->  ../src/...
  "index.js" ->  "../index.js"   (readFileSync of a repo-root file)
  "src/..."  ->  "../src/..."    (readFileSync of a repo-root path)

Only the leading path is rewritten, so a path inside a string literal that
mentions src/ deeper in the text is left alone.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TESTS = os.path.join(REPO, "tests")

# import ... from "./src/x.js"   /   import("./src/x.js")
IMPORT = re.compile(r'(from\s+|import\()(["\'])\./src/')
# readFileSync("src/...")  and  readFileSync("index.js")
READFILE = re.compile(r'(readFileSync\(\s*)(["\'])(src/|index\.js|package\.json)')

changed = []
for name in sorted(os.listdir(TESTS)):
    if not name.endswith(".mjs"):
        continue
    path = os.path.join(TESTS, name)
    with open(path, "r", encoding="utf-8") as fh:
        before = fh.read()

    after = IMPORT.sub(lambda m: f"{m.group(1)}{m.group(2)}../src/", before)
    after = READFILE.sub(lambda m: f'{m.group(1)}{m.group(2)}../{m.group(3)}', after)

    if after != before:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(after)
        changed.append(name)

print(f"rewrote paths in {len(changed)} file(s):")
for c in changed:
    print(f"  {c}")

# Prove nothing still points at the old location.
leftovers = []
for name in sorted(os.listdir(TESTS)):
    if not name.endswith(".mjs"):
        continue
    with open(os.path.join(TESTS, name), "r", encoding="utf-8") as fh:
        text = fh.read()
    for m in re.finditer(r'(from\s+|import\()(["\'])\./src/', text):
        leftovers.append(f"{name}: {m.group(0)}")
    for m in re.finditer(r'readFileSync\(\s*["\'](?:src/|index\.js|package\.json)', text):
        leftovers.append(f"{name}: {m.group(0)}")

if leftovers:
    print("\nSTILL WRONG:")
    for l in leftovers:
        print("  " + l)
    raise SystemExit(1)

print("\nOK: every path in tests/ points at the repo root correctly.")
