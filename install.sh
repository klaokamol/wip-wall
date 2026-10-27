#!/bin/sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
market=wip-wall-local

case "${1:-install}" in
  install)
    command -v claude >/dev/null || { echo "claude not found" >&2; exit 1; }
    command -v glab >/dev/null || echo "warning: glab not found (brew install glab; glab auth login)" >&2
    [ -d /Applications/Ghostty.app ] || echo "warning: Ghostty.app not found" >&2
    claude plugin marketplace add "$here"
    claude plugin install "wip-wall@$market"
    echo "installed; run /wip-wall in claude"
    ;;
  uninstall)
    claude plugin uninstall "wip-wall@$market"
    claude plugin marketplace remove "$market"
    echo "removed"
    ;;
  *)
    echo "usage: $0 [install|uninstall]" >&2
    exit 1
    ;;
esac
