#!/bin/bash

# Release Preparation Script for Aurelia DevTools
# This script helps prepare a new release by running checks and validations

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Aurelia DevTools Release Preparation${NC}"
echo "========================================"
echo ""

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "manifest.json" ]; then
    print_error "This script must be run from the project root directory"
    exit 1
fi

# Parse current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
MANIFEST_VERSION=$(node -p "require('./manifest.json').version")

echo "📦 Current Versions:"
echo "   package.json: $CURRENT_VERSION"
echo "   manifest.json: $MANIFEST_VERSION"
echo ""

# Check if versions are in sync
if [ "$CURRENT_VERSION" != "$MANIFEST_VERSION" ]; then
    print_warning "Version mismatch detected!"
    echo "   package.json: $CURRENT_VERSION"
    echo "   manifest.json: $MANIFEST_VERSION"
    echo ""
    read -p "Do you want to sync manifest.json to package.json version? (y/n): " sync_versions
    if [ "$sync_versions" = "y" ] || [ "$sync_versions" = "Y" ]; then
        node -e "
            const fs = require('fs');
            const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
            manifest.version = require('./package.json').version;
            fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
        "
        print_status "Manifest version updated to $CURRENT_VERSION"
    fi
fi

# Get new version from user
echo "🔢 Version Selection:"
echo "   Current version: $CURRENT_VERSION"
echo ""
echo "   Suggested versions:"
PARTS=(${CURRENT_VERSION//./ })
MAJOR=${PARTS[0]}
MINOR=${PARTS[1]}
PATCH=${PARTS[2]}

echo "   Patch:  $MAJOR.$MINOR.$((PATCH + 1))"
echo "   Minor:  $MAJOR.$((MINOR + 1)).0"
echo "   Major:  $((MAJOR + 1)).0.0"
echo ""

read -p "Enter new version (or press Enter to keep current): " NEW_VERSION

if [ -z "$NEW_VERSION" ]; then
    NEW_VERSION=$CURRENT_VERSION
    print_info "Keeping current version: $NEW_VERSION"
else
    # Validate version format
    if ! [[ $NEW_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        print_error "Invalid version format. Use semantic versioning (e.g., 1.2.3)"
        exit 1
    fi
    
    # Update versions
    npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version
    node -e "
        const fs = require('fs');
        const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
        manifest.version = '$NEW_VERSION';
        fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    "
    print_status "Updated versions to $NEW_VERSION"
fi

echo ""
echo "🧪 Running Pre-Release Checks:"
echo "==============================="

# Check Node version
NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_NODE="22.0.0"
if [ "$(printf '%s\n' "$REQUIRED_NODE" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_NODE" ]; then
    print_warning "Node.js version $NODE_VERSION detected. Recommended: >= $REQUIRED_NODE"
else
    print_status "Node.js version check passed ($NODE_VERSION)"
fi

# Install dependencies
echo ""
print_info "Installing dependencies..."
npm ci --silent
print_status "Dependencies installed"

# Run linting
echo ""
print_info "Running linter..."
if npm run lint --silent; then
    print_status "Linting passed"
else
    print_error "Linting failed. Please fix the issues before releasing."
    exit 1
fi

# Run tests
echo ""
print_info "Running tests..."
if npm test --silent; then
    print_status "Tests passed"
else
    print_error "Tests failed. Please fix the issues before releasing."
    exit 1
fi

# Build the extension
echo ""
print_info "Building extension..."
npm run build --silent

if [ ! -d "dist" ]; then
    print_error "Build failed - dist directory not found"
    exit 1
fi

print_status "Build completed successfully"

# Verify build contents
echo ""
print_info "Verifying build contents..."

REQUIRED_FILES=("manifest.json" "index.html" "build/entry.js" "build/background.js" "build/contentscript.js" "build/detector.js")
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "dist/$file" ]; then
        print_status "Found: $file"
    else
        print_error "Missing required file: $file"
        exit 1
    fi
done

# Check manifest version in dist
DIST_VERSION=$(node -p "require('./dist/manifest.json').version")
if [ "$DIST_VERSION" = "$NEW_VERSION" ]; then
    print_status "Dist manifest version matches: $DIST_VERSION"
else
    print_error "Dist manifest version mismatch: expected $NEW_VERSION, got $DIST_VERSION"
    exit 1
fi

# Calculate package size
cd dist
PACKAGE_SIZE=$(du -sh . | cut -f1)
cd ..
print_status "Package size: $PACKAGE_SIZE"

# Generate changelog preview
echo ""
echo "📝 Changelog Preview:"
echo "===================="

# Get commits since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
    echo "Changes since $LAST_TAG:"
    
    # Parse conventional commits into categories
    FEATURES=$(git log "$LAST_TAG"..HEAD --pretty=format:"%s" --no-merges | grep "^feat" | sed 's/^feat(\([^)]*\)): /- **\1**: /' | sed 's/^feat: /- /')
    FIXES=$(git log "$LAST_TAG"..HEAD --pretty=format:"%s" --no-merges | grep "^fix" | sed 's/^fix(\([^)]*\)): /- **\1**: /' | sed 's/^fix: /- /')
    CHORES=$(git log "$LAST_TAG"..HEAD --pretty=format:"%s" --no-merges | grep "^chore" | sed 's/^chore(\([^)]*\)): /- **\1**: /' | sed 's/^chore: /- /')
    DOCS=$(git log "$LAST_TAG"..HEAD --pretty=format:"%s" --no-merges | grep "^docs" | sed 's/^docs(\([^)]*\)): /- **\1**: /' | sed 's/^docs: /- /')
    STYLES=$(git log "$LAST_TAG"..HEAD --pretty=format:"%s" --no-merges | grep "^style" | sed 's/^style(\([^)]*\)): /- **\1**: /' | sed 's/^style: /- /')
    REFACTORS=$(git log "$LAST_TAG"..HEAD --pretty=format:"%s" --no-merges | grep "^refactor" | sed 's/^refactor(\([^)]*\)): /- **\1**: /' | sed 's/^refactor: /- /')
    TESTS=$(git log "$LAST_TAG"..HEAD --pretty=format:"%s" --no-merges | grep "^test" | sed 's/^test(\([^)]*\)): /- **\1**: /' | sed 's/^test: /- /')
    OTHER=$(git log "$LAST_TAG"..HEAD --pretty=format:"%s" --no-merges | grep -v "^feat\|^fix\|^chore\|^docs\|^style\|^refactor\|^test" | sed 's/^/- /')
    
    if [ -n "$FEATURES" ]; then
        echo ""
        echo "   🚀 Features:"
        echo "$FEATURES" | head -10
    fi
    
    if [ -n "$FIXES" ]; then
        echo ""
        echo "   🐛 Bug Fixes:"
        echo "$FIXES" | head -10
    fi
    
    if [ -n "$REFACTORS" ]; then
        echo ""
        echo "   ♻️  Refactoring:"
        echo "$REFACTORS" | head -5
    fi
    
    if [ -n "$STYLES" ]; then
        echo ""
        echo "   💄 Styling:"
        echo "$STYLES" | head -5
    fi
    
    if [ -n "$DOCS" ]; then
        echo ""
        echo "   📚 Documentation:"
        echo "$DOCS" | head -5
    fi
    
    if [ -n "$TESTS" ]; then
        echo ""
        echo "   🧪 Testing:"
        echo "$TESTS" | head -5
    fi
    
    if [ -n "$CHORES" ]; then
        echo ""
        echo "   🔧 Maintenance:"
        echo "$CHORES" | head -5
    fi
    
    if [ -n "$OTHER" ]; then
        echo ""
        echo "   📝 Other Changes:"
        echo "$OTHER" | head -5
    fi
    
    COMMIT_COUNT=$(git rev-list "$LAST_TAG"..HEAD --count)
    if [ "$COMMIT_COUNT" -gt 40 ]; then
        echo ""
        echo "   ... and $((COMMIT_COUNT - 40)) more commits"
    fi
else
    echo "No previous tags found. This appears to be the first release."
    echo ""
    echo "   Recent commits:"
    git log --pretty=format:"   - %s" --no-merges | head -10
fi

echo ""
echo ""

# Final summary
echo "🎉 Release Preparation Summary:"
echo "==============================="
echo "   Version: $NEW_VERSION"
echo "   Package size: $PACKAGE_SIZE"
echo "   All checks: PASSED"
echo ""

print_status "Release preparation completed successfully!"
echo ""
echo "🚀 Next Steps:"
echo "=============="
echo "1. Review the changes above"
echo "2. Commit version updates: git add . && git commit -m 'chore: prepare release v$NEW_VERSION'"
echo "3. Create and push a tag: git tag v$NEW_VERSION && git push origin v$NEW_VERSION"
echo "4. Create a GitHub release at: https://github.com/aurelia/devtools/releases/new"
echo "5. The Chrome Web Store deployment will run automatically"
echo ""
echo "💡 Tip: You can also use the GitHub 'Prepare Release' workflow for automation"