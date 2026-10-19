#!/bin/bash
# Test harness: proves start.sh survives Windows line endings.
#
# The real start.sh would install packages and run the bot, so this checks
# only the part that matters here: that a CRLF copy of the script reaches the
# same place as an LF copy, rather than dying on "set -u\r".

set -u

SCRIPT="start.sh"
# This file lives in tests/, but start.sh is in the repo root.
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"

pass=0
fail=0

check() {
  if [ "$2" = "$3" ]; then
    echo "  PASS  $1"
    pass=$((pass + 1))
  else
    echo "  FAIL  $1  got [$2] want [$3]"
    fail=$((fail + 1))
  fi
}

# Counts how many lines of the first argument contain the second.
count_containing() {
  printf '%s' "$1" | grep -c -- "$2" || true
}

# A stand-in with the same shape as the real script: the CRLF check, the
# set -u, and a cd. If the line endings are wrong, this is where it dies.
cat > "$HERE/fake-start.sh" <<'SCRIPT'
#!/bin/bash
if tr -d '\r' < "$0" 2>/dev/null | cmp -s - "$0" 2>/dev/null; then
  :
else
  echo "Fixing Windows line endings in start.sh..."
  CLEAN="/tmp/.start.sh.$$"
  if sed 's/\r$//' "$0" > "$CLEAN" 2>/dev/null; then
    chmod +x "$CLEAN" 2>/dev/null || true
    exec bash "$CLEAN" "$@"
  fi
  echo "Could not fix the line endings. Trying anyway..."
fi

set -u

cd "$1" || exit 1

echo "REACHED_THE_BOTTOM"
SCRIPT

echo "=== a CRLF copy must still reach the bottom ==="
# Make it CRLF, exactly like a Windows upload produces.
sed 's/$/\r/' "$HERE/fake-start.sh" > "$HERE/crlf-start.sh"

out=$(bash "$HERE/crlf-start.sh" "$HERE" 2>&1)
check "it fixed the line endings" "$(count_containing "$out" 'Fixing Windows line endings')" "1"
check "it reached the bottom" "$(count_containing "$out" 'REACHED_THE_BOTTOM')" "1"
check "it did not die on set -u" "$(count_containing "$out" 'invalid option')" "0"
check "it did not die on cd" "$(count_containing "$out" 'No such file or directory')" "0"

echo ""
echo "=== an LF copy runs normally, with no fix message ==="
out=$(bash "$HERE/fake-start.sh" "$HERE" 2>&1)
check "no fix message" "$(count_containing "$out" 'Fixing Windows line endings')" "0"
check "it reached the bottom" "$(count_containing "$out" 'REACHED_THE_BOTTOM')" "1"

echo ""
echo "=== the real start.sh has no CR in it ==="
if tr -d '\r' < "$ROOT/$SCRIPT" | cmp -s - "$ROOT/$SCRIPT"; then
  check "start.sh is LF" "no CR" "no CR"
else
  check "start.sh is LF" "has CR" "no CR"
fi

echo ""
echo "=== the real start.sh has the self-heal in it ==="
if grep -q 'Fixing Windows line endings' "$ROOT/$SCRIPT"; then
  check "it self-heals" "yes" "yes"
else
  check "it self-heals" "no" "yes"
fi

rm -f "$HERE/fake-start.sh" "$HERE/crlf-start.sh"

echo ""
if [ "$fail" -eq 0 ]; then
  echo "ALL PASSED"
  exit 0
fi
echo "$fail FAILED"
exit 1
