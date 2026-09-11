#!/usr/bin/env bash
# Run one gate and report ITS exit code, never a pipeline's.
#
# Sprint 09B.29 Phase 5. This exists because of a real defect in this sprint,
# recorded twice:
#
#   Phase 4  a runner ended in `grep | tee`, so the wrapper exited with tee's
#            status while Jest had exited 1. A red run was reported green.
#   Phase 5  I verified a typecheck with `pnpm … | tail -1 && echo OK`. `tail`
#            succeeds whatever `tsc` did, so the `&&` fired on the pipe and I
#            reported a passing typecheck over two real compile errors.
#
# Both have the same shape: the moment a command's output is piped anywhere, the
# shell's `$?` belongs to the LAST stage. `set -o pipefail` fixes some of it and
# is easy to forget; capturing the status before anything else touches it cannot
# be forgotten.
#
# Usage:
#   scripts/ci/run-gate.sh "api typecheck" pnpm --filter @homeservicemarketplace/api typecheck
#
# Prints a single stable line to stdout:
#   GATE <name> rc=<code> duration=<seconds>s
#
# and exits with the command's own code, so callers can still chain on it.
#
# Output goes to a log rather than the terminal so a caller may summarise it
# without a pipe. The path is printed on failure, which is when anyone wants it.
set -uo pipefail

NAME="${1:?usage: run-gate.sh <name> <command...>}"
shift

if [ "$#" -eq 0 ]; then
  echo "run-gate.sh: no command given for gate '$NAME'" >&2
  exit 64
fi

LOG_DIR="${GATE_LOG_DIR:-${TMPDIR:-/tmp}/hsm-gates}"
mkdir -p "$LOG_DIR"
SAFE_NAME=$(printf '%s' "$NAME" | tr -c '[:alnum:]._-' '-')
LOG="$LOG_DIR/${SAFE_NAME}.log"

START=$(date +%s)
# The command's stdout and stderr go to the log. Nothing is piped, so the
# status captured on the very next line is the command's own.
"$@" > "$LOG" 2>&1
RC=$?
END=$(date +%s)

printf 'GATE %s rc=%s duration=%ss\n' "$NAME" "$RC" "$((END - START))"
if [ "$RC" -ne 0 ]; then
  printf 'GATE %s FAILED — full output: %s\n' "$NAME" "$LOG" >&2
  # The tail is a convenience for the reader and deliberately comes AFTER the
  # status was captured, so it cannot influence what is reported.
  tail -n 40 "$LOG" >&2
fi

exit "$RC"
