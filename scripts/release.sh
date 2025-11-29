#!/bin/bash
# Release script for WhisperDesk
# Usage: ./scripts/release.sh [patch|minor|major] [--force]
# Examples:
#   ./scripts/release.sh           # Bump patch and release (1.0.0 -> 1.0.1)
#   ./scripts/release.sh minor     # Bump minor and release (1.0.0 -> 1.1.0)
#   ./scripts/release.sh major     # Bump major and release (1.0.0 -> 2.0.0)
#   ./scripts/release.sh --force   # Re-release current version (delete and recreate tag)

set -e

cd "$(dirname "$0")/.."

# Parse arguments
BUMP_TYPE="patch"
FORCE=false

for arg in "$@"; do
  case $arg in
    patch|minor|major)
      BUMP_TYPE=$arg
      ;;
    --force|-f)
      FORCE=true
      ;;
  esac
done

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

if [ "$FORCE" = true ]; then
  # Re-release current version
  VERSION=$CURRENT_VERSION
  echo "🔄 Re-releasing v$VERSION..."
  
  # Delete local and remote tag
  git tag -d "v$VERSION" 2>/dev/null || true
  git push origin ":refs/tags/v$VERSION" 2>/dev/null || true
else
  # Bump version
  echo "📦 Bumping $BUMP_TYPE version..."
  npm run "bump:$BUMP_TYPE" --silent
  
  VERSION=$(node -p "require('./package.json').version")
  
  # Update package-lock.json
  npm install --package-lock-only --silent
  
  # Generate changelog
  echo "📝 Generating changelog..."
  npm run changelog --silent
  
  # Commit version bump and changelog
  git add package.json package-lock.json CHANGELOG.md
  git commit -m "chore: release v$VERSION"
  git push origin main
fi

# Create and push tag
echo "🏷️  Creating tag v$VERSION..."
git tag "v$VERSION"
git push origin "v$VERSION"

echo ""
echo "✅ Release v$VERSION triggered!"
echo ""
echo "📋 Track progress: https://github.com/pedrovsiqueira/whisperdesk/actions"
echo "📦 Release page:   https://github.com/pedrovsiqueira/whisperdesk/releases/tag/v$VERSION"
