"""
Point the test output files at tests/ instead of the repo root.

Each suite writes a .txt next to itself so the results can be read after the
run. Now that the suites live in tests/, those files should land there too
rather than scattering across the repo root.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TESTS = os.path.join(REPO, "tests")

# writeFileSync("something.txt", ...) -> writeFileSync(new URL("something.txt", import.meta.url), ...)
WRITE = re.compile(r'writeFileSync\((["\'])([A-Za-z0-9_.-]+\.txt)\1')

changed = []
for name in sorted(os.listdir(TESTS)):
    if not name.endswith(".mjs"):
        continue
    path = os.path.join(TESTS, name)
    with open(path, "r", encoding="utf-8") as fh:
        before = fh.read()

    after = WRITE.sub(
        lambda m: f'writeFileSync(new URL("{m.group(2)}", import.meta.url),',
        before,
    )

    if after != before:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(after)
        changed.append(name)

print(f"redirected output in {len(changed)} file(s)")

# Anything still writing a bare filename to the root?
leftovers = []
for name in sorted(os.listdir(TESTS)):
    if not name.endswith(".mjs"):
        continue
    with open(os.path.join(TESTS, name), "r", encoding="utf-8") as fh:
        text = fh.read()
    for m in WRITE.finditer(text):
        leftovers.append(f"{name}: {m.group(0)}")

if leftovers:
    print("\nSTILL WRITING TO THE ROOT:")
    for l in leftovers:
        print("  " + l)
    raise SystemExit(1)

print("OK: every suite writes its output next to itself.")
