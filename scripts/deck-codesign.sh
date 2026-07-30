#!/usr/bin/env bash
# Sign a locally built app with a stable self-signed identity.
#
# Why: macOS ties keychain access to the app's designated requirement, which is
# derived from its code signature. An unsigned build gets a new one every time,
# so the Safe Storage prompt (the one guarding cookie encryption) reappears
# after every rebuild. A self-signed certificate that stays put keeps the grant.
#
# This is not Gatekeeper-valid. It is a local identity, not an Apple one — the
# first launch still needs right-click → Open. What it buys is a signature that
# does not change between builds.
#
# One-time setup, in Keychain Access:
#   Keychain Access → Certificate Assistant → Create a Certificate…
#     Name:              Deck Local
#     Identity Type:     Self Signed Root
#     Certificate Type:  Code Signing
#   Leave it in the login keychain.
#
# Then:  ./scripts/deck-codesign.sh path/to/"T3 Code (Alpha).app"

set -euo pipefail

IDENTITY="${DECK_SIGN_IDENTITY:-Deck Local}"
APP="${1:-}"

if [[ -z "${APP}" ]]; then
  echo "usage: $0 <path-to-.app> [--verify-only]" >&2
  exit 2
fi

if [[ ! -d "${APP}" ]]; then
  echo "error: no app bundle at ${APP}" >&2
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -qF "${IDENTITY}"; then
  cat >&2 <<EOF
error: no code-signing identity named "${IDENTITY}" in your keychains.

Create one once via Keychain Access → Certificate Assistant →
Create a Certificate…, with:
  Name              ${IDENTITY}
  Identity Type     Self Signed Root
  Certificate Type  Code Signing

Or point this script at a different one:
  DECK_SIGN_IDENTITY="My Identity" $0 "${APP}"
EOF
  exit 1
fi

if [[ "${2:-}" == "--verify-only" ]]; then
  codesign --verify --deep --verbose=2 "${APP}"
  exit 0
fi

echo "Signing ${APP} as \"${IDENTITY}\"…"

# Nested code first, outermost last: a bundle's signature covers what it
# contains, so re-signing an inner binary afterwards invalidates the outer one.
while IFS= read -r -d '' nested; do
  codesign --force --sign "${IDENTITY}" --timestamp=none "${nested}" 2>/dev/null || true
done < <(find "${APP}/Contents/Frameworks" \
  \( -name "*.dylib" -o -name "*.node" -o -name "*.framework" -o -name "*.app" \) \
  -print0 2>/dev/null)

while IFS= read -r -d '' helper; do
  codesign --force --sign "${IDENTITY}" --timestamp=none "${helper}" 2>/dev/null || true
done < <(find "${APP}/Contents/Frameworks" -maxdepth 1 -name "*.app" -print0 2>/dev/null)

codesign --force --sign "${IDENTITY}" --timestamp=none "${APP}"

# Quarantine survives signing and would still trigger the Gatekeeper dialog.
xattr -dr com.apple.quarantine "${APP}" 2>/dev/null || true

echo
codesign --verify --verbose=2 "${APP}" && echo "Signature OK."
echo
echo "Designated requirement (stable across rebuilds if this stays the same):"
codesign --display --requirements - "${APP}" 2>&1 | sed -n 's/^designated => /  /p'
