#!/bin/sh
# Installs orca-sbx to ~/.local/bin (or $ORCA_SBX_BIN_DIR).
#   curl -fsSL https://raw.githubusercontent.com/MatsCornegoor/orca-sbx/main/install.sh | sh
# From a clone, ./install.sh links the clone's copy instead, so edits apply.
set -eu

REF=${ORCA_SBX_REF:-main}
URL="https://raw.githubusercontent.com/MatsCornegoor/orca-sbx/$REF/bin/orca-sbx"
BIN_DIR=${ORCA_SBX_BIN_DIR:-$HOME/.local/bin}
DEST="$BIN_DIR/orca-sbx"

mkdir -p "$BIN_DIR"
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)
if [ -n "$here" ] && [ -f "$here/bin/orca-sbx" ] && [ -f "$here/install.sh" ]; then
  ln -sf "$here/bin/orca-sbx" "$DEST"
  echo "Linked $DEST -> $here/bin/orca-sbx"
else
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' EXIT
  curl -fsSL "$URL" -o "$tmp"
  chmod +x "$tmp"
  mv "$tmp" "$DEST"
  echo "Installed $DEST"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not on your PATH. Add to ~/.zshrc:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
command -v sbx >/dev/null || echo "Note: sbx not found. Install it: brew install --cask docker/tap/sbx"
echo "Next: orca-sbx setup"
