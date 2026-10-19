"""
Fix the readFileSync calls in tests/ to resolve against the test file.

A string path in readFileSync is resolved against process.cwd(), not against
the file doing the reading. So "../src/index.js" from the repo root points
one level ABOVE the repo. The fix is the same one used for the output files:
new URL("../src/index.js", import.meta.url), which is always relative to the
test file itself.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TESTS = os.path.join(REPO, "tests")

READFILE = re.compile(r'readFileSync\(\s*(["\'])\.\./([^"\']+)\1')

changed = []
for name in sorted(os.listdir(TESTS)):
    if not name.endswith(".mjs"):
        continue
    path = os.path.join(TESTS, name)
    with open(path, "r", encoding="utf-8") as fh:
        before = fh.read()

    after = READFILE.sub(
        lambda m: f'readFileSync(new URL("../{m.group(2)}", import.meta.url)',
        before,
    )

    if after != before:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(after)
        changed.append(name)

print(f"fixed {len(changed)} file(s)")

# Any left reading a bare relative path?
leftovers = []
for name in sorted(os.listdir(TESTS)):
    if not name.endswith(".mjs"):
        continue
    with open(os.path.join(TESTS, name), "r", encoding="utf-8") as fh:
        text = fh.read()
    for m in re.finditer(r'readFileSync\(\s*["\'](?:\.\./)?(?:src/|index\.js|package\.json)', text):
        leftovers.append(f"{name}: {m.group(0)}")

if leftovers:
    print("\nSTILL WRONG:")
    for l in leftovers:
        print("  " + l)
    raise SystemExit(1)

print("OK: every readFileSync in tests/ resolves against the test file.")
