#!/bin/sh
# Copies site/ to the gh-pages branch, which GitHub Pages serves at https://baobab-tech.github.io/pMCPg/.
# Commits locally only; push with: git push origin gh-pages
set -eu
root=$(git rev-parse --show-toplevel)
cd "$root"
tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp" 2>/dev/null || true; rm -rf "$tmp"' EXIT

if git show-ref --verify --quiet refs/heads/gh-pages; then
  git worktree add "$tmp" refs/heads/gh-pages
else
  git worktree add --detach "$tmp"
  git -C "$tmp" checkout --orphan gh-pages
fi
git -C "$tmp" rm -rf --quiet . 2>/dev/null || true
cp -R site/. "$tmp/"
git -C "$tmp" add -A
if git -C "$tmp" diff --cached --quiet; then
  echo "gh-pages already matches site/"
else
  git -C "$tmp" commit --quiet -m "Publish site/ from $(git rev-parse --short HEAD)"
  echo "Committed to gh-pages. Push with: git push origin gh-pages"
fi
