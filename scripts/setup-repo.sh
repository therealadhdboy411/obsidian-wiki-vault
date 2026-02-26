#!/usr/bin/env bash
# =============================================================================
# WikiVault Unified — GitHub Repo Setup Script
# =============================================================================
# Run this once after cloning / unpacking the project to wire up your own
# GitHub remote and push everything in one shot.
#
# Usage:
#   chmod +x scripts/setup-repo.sh
#   ./scripts/setup-repo.sh
#
# Prerequisites:
#   - git installed
#   - A GitHub account
#   - Either:
#       (a) GitHub CLI (`gh`) installed and authenticated  ← easiest
#       (b) A Personal Access Token (PAT) with repo scope
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}ℹ ${RESET}$*"; }
success() { echo -e "${GREEN}✅ ${RESET}$*"; }
warn()    { echo -e "${YELLOW}⚠️  ${RESET}$*"; }
error()   { echo -e "${RED}❌ ${RESET}$*" >&2; exit 1; }

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║   WikiVault Unified — Repo Setup     ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${RESET}"

# ── 1. Sanity checks ─────────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || error "git is not installed."
command -v node >/dev/null 2>&1 || error "Node.js is not installed. Install v18+ from https://nodejs.org"

NODE_VERSION=$(node -e "process.stdout.write(process.version.replace('v',''))")
MAJOR="${NODE_VERSION%%.*}"
[ "$MAJOR" -ge 18 ] || error "Node.js v18+ required (found v${NODE_VERSION})."

# ── 2. data.json ─────────────────────────────────────────────────────────────
if [ ! -f "data.json" ]; then
  warn "data.json not found."
  info "Copying data.json.example → data.json"
  cp data.json.example data.json
  warn "Open data.json and replace YOUR_API_KEY_HERE with your real API key before using the plugin."
else
  info "data.json already exists — skipping copy."
fi

# ── 3. Install dependencies ───────────────────────────────────────────────────
info "Installing npm dependencies..."
npm install
success "Dependencies installed."

# ── 4. Build ─────────────────────────────────────────────────────────────────
info "Running production build..."
npm run build
success "Build complete — main.js is ready."

# ── 5. Git init ───────────────────────────────────────────────────────────────
if [ ! -d ".git" ]; then
  info "Initialising git repository..."
  git init
  git branch -M main
fi

# ── 6. GitHub remote ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}GitHub Setup${RESET}"
echo "─────────────────────────────────────────"

if command -v gh >/dev/null 2>&1; then
  # ── Path A: GitHub CLI ────────────────────────────────────────────────────
  info "GitHub CLI detected. Creating repo automatically..."

  echo -n "  GitHub username [$(gh api user -q .login 2>/dev/null || echo 'you')]: "
  read -r GH_USER
  GH_USER="${GH_USER:-$(gh api user -q .login 2>/dev/null)}"

  echo -n "  Repo name [wikivault-unified]: "
  read -r REPO_NAME
  REPO_NAME="${REPO_NAME:-wikivault-unified}"

  echo -n "  Private repo? [Y/n]: "
  read -r PRIVATE_CHOICE
  PRIVATE_FLAG="--private"
  [[ "${PRIVATE_CHOICE,,}" == "n" ]] && PRIVATE_FLAG="--public"

  gh repo create "${GH_USER}/${REPO_NAME}" \
    $PRIVATE_FLAG \
    --description "AI-powered Obsidian wiki generator with Virtual Linker, smart matching, and structured logging" \
    --source=. \
    --remote=origin \
    --push 2>/dev/null || {
      # Repo may already exist — just set remote
      git remote remove origin 2>/dev/null || true
      git remote add origin "https://github.com/${GH_USER}/${REPO_NAME}.git"
    }

  success "Repo created: https://github.com/${GH_USER}/${REPO_NAME}"

else
  # ── Path B: Manual PAT ───────────────────────────────────────────────────
  warn "GitHub CLI not found. Using manual PAT flow."
  info "Create a PAT at: https://github.com/settings/tokens/new"
  info "Required scope: repo (Full control of private repositories)"
  echo ""

  echo -n "  GitHub username: "
  read -r GH_USER

  echo -n "  GitHub Personal Access Token: "
  read -rs GH_TOKEN
  echo ""

  echo -n "  Repo name [wikivault-unified]: "
  read -r REPO_NAME
  REPO_NAME="${REPO_NAME:-wikivault-unified}"

  echo -n "  Private repo? [Y/n]: "
  read -r PRIVATE_CHOICE
  PRIVATE_VAL="true"
  [[ "${PRIVATE_CHOICE,,}" == "n" ]] && PRIVATE_VAL="false"

  info "Creating GitHub repository via API..."
  HTTP_STATUS=$(curl -s -o /tmp/gh_create_resp.json -w "%{http_code}" \
    -X POST "https://api.github.com/user/repos" \
    -H "Authorization: token ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"name\":\"${REPO_NAME}\",\"private\":${PRIVATE_VAL},\"description\":\"AI-powered Obsidian wiki generator with Virtual Linker, smart matching, and structured logging\"}")

  if [ "$HTTP_STATUS" != "201" ]; then
    warn "Repo creation returned HTTP ${HTTP_STATUS}. It may already exist."
    cat /tmp/gh_create_resp.json
  else
    success "Repository created on GitHub."
  fi

  REMOTE_URL="https://${GH_USER}:${GH_TOKEN}@github.com/${GH_USER}/${REPO_NAME}.git"
  git remote remove origin 2>/dev/null || true
  git remote add origin "$REMOTE_URL"
fi

# ── 7. Initial commit & push ─────────────────────────────────────────────────
info "Staging files..."
git add .

if git diff --cached --quiet; then
  info "Nothing new to commit."
else
  git commit -m "chore: initial commit — WikiVault Unified v$(node -e "process.stdout.write(require('./package.json').version)")"
  success "Committed."
fi

info "Pushing to origin/main..."
git push -u origin main
success "Pushed!"

# ── 8. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}All done! 🎉${RESET}"
echo ""
echo "  Next steps:"
echo "  1. Edit data.json → set your real API key"
echo "  2. Copy the plugin folder to your Obsidian vault's .obsidian/plugins/ directory"
echo "  3. Enable the plugin in Obsidian Settings → Community Plugins"
echo "  4. For development: run  npm run dev  to watch-rebuild on changes"
echo ""
