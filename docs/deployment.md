# Chrome Web Store Deployment Guide

This guide covers the complete process for deploying the Aurelia DevTools extension to the Chrome Web Store using automated GitHub Actions.

## Overview

Our deployment system provides:
- ✅ **Automated builds** triggered by GitHub releases
- ✅ **Version synchronization** between package.json and manifest.json
- ✅ **Quality gates** (linting, testing) before deployment
- ✅ **Secure credential management** using GitHub secrets
- ✅ **Manual deployment** option for urgent releases
- ✅ **Release preparation** workflow for team collaboration

## Quick Start

1. **One-time setup**: Configure Chrome Web Store API credentials ([Setup Guide](../scripts/setup-chrome-store-credentials.md))
2. **Prepare release**: Run `./scripts/prepare-release.sh` or use the GitHub workflow
3. **Create release**: Tag and create a GitHub release
4. **Automatic deployment**: GitHub Actions handles the rest

## Deployment Workflows

### 1. Automated Release Workflow (Recommended)

**Trigger**: Creating a GitHub release with a semver tag (e.g., `v1.2.3`)

```yaml
# .github/workflows/chrome-store-deploy.yml
# Automatically triggered on GitHub releases
```

**Process**:
1. Extract version from release tag
2. Update package.json and manifest.json versions
3. Run quality checks (lint, test)
4. Build extension
5. Upload to Chrome Web Store
6. Publish for review

### 2. Manual Deployment Workflow

**Trigger**: Manual workflow dispatch

**Use cases**:
- Hotfix releases
- Pre-release testing
- Emergency deployments

```yaml
# Can be triggered manually with custom version
workflow_dispatch:
  inputs:
    version:
      description: 'Version to deploy (e.g., 1.0.0)'
      required: true
```

### 3. Release Preparation Workflow

**Trigger**: Manual workflow dispatch

**Purpose**: Team collaboration and review process

```yaml
# Creates a PR with version updates and changelog
workflow_dispatch:
  inputs:
    version:
      description: 'Release version (e.g., 1.0.0)'
      required: true
```

## Local Development Workflow

### Using the Release Script

```bash
# Interactive release preparation
./scripts/prepare-release.sh

# Follow the prompts to:
# 1. Choose new version number
# 2. Run all quality checks
# 3. Build and verify the extension
# 4. Preview changelog
# 5. Get next steps instructions
```

### Manual Process

```bash
# 1. Update versions
npm version 1.2.3 --no-git-tag-version

# 2. Update manifest.json version
node -e "
  const fs = require('fs');
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  manifest.version = '1.2.3';
  fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
"

# 3. Run quality checks
npm run lint
npm test

# 4. Build extension
npm run build

# 5. Verify build
ls -la dist/
cat dist/manifest.json | grep version

# 6. Create release
git add .
git commit -m "chore: prepare release v1.2.3"
git tag v1.2.3
git push origin main --tags
```

## Chrome Web Store API Setup

### Prerequisites

- Google Cloud Console account
- Chrome Web Store developer account
- Admin access to the GitHub repository

### Step-by-Step Setup

1. **[Follow the detailed setup guide](../scripts/setup-chrome-store-credentials.md)**
2. **Run the credential generation script**:
   ```bash
   ./scripts/generate-refresh-token.sh
   ```
3. **Add GitHub secrets**:
   - `CHROME_EXTENSION_ID`
   - `CHROME_CLIENT_ID`
   - `CHROME_CLIENT_SECRET`
   - `CHROME_REFRESH_TOKEN`

### Required GitHub Secrets

| Secret | Description | Example |
|--------|-------------|---------|
| `CHROME_EXTENSION_ID` | Extension ID from Chrome Web Store | `abcdefghijklmnopqrstuvwxyzabcdef` |
| `CHROME_CLIENT_ID` | OAuth Client ID | `123456789.apps.googleusercontent.com` |
| `CHROME_CLIENT_SECRET` | OAuth Client Secret | `GOCSPX-abc123def456...` |
| `CHROME_REFRESH_TOKEN` | Generated refresh token | `1//abc123def456...` |

## Version Management

### Semantic Versioning

We follow [semantic versioning](https://semver.org/):
- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features, backward compatible
- **PATCH** (0.0.1): Bug fixes, backward compatible

### Version Synchronization

The deployment system automatically ensures:
- `package.json` version matches `manifest.json` version
- Build artifacts contain the correct version
- Git tags match the deployed version

### Version Strategy

```bash
# Current: 1.2.0
# Bug fix: 1.2.1
# New feature: 1.3.0
# Breaking change: 2.0.0
```

## Quality Gates

### Pre-deployment Checks

All deployments must pass:
1. **ESLint**: TypeScript/JavaScript code quality
2. **HTMLHint**: HTML template validation
3. **Jest**: Unit test coverage
4. **Build verification**: Successful dist/ generation
5. **Manifest validation**: Chrome extension requirements

### Build Verification

```bash
# Required files in dist/:
├── manifest.json         # Extension manifest
├── sidebar.html          # Sidebar pane entry
├── build/
│   ├── sidebar.js        # Sidebar application
│   ├── background.js     # Service worker
│   ├── contentscript.js  # Content script
│   └── detector.js       # Aurelia detector
├── devtools/             # DevTools page
├── images/               # Extension icons
└── popups/               # Extension popups
```

## Chrome Web Store Review Process

### Submission Process

1. **Automated upload**: GitHub Actions uploads the ZIP file
2. **Auto-publish**: Extension is submitted for review
3. **Review timeline**: Typically 1-3 business days
4. **Publication**: Automatic upon approval

### Review Guidelines

Ensure compliance with:
- [Chrome Web Store Developer Policies](https://developer.chrome.com/docs/webstore/program-policies)
- [Manifest V3 requirements](https://developer.chrome.com/docs/extensions/mv3/intro/)
- Privacy policy requirements for developer tools

### Common Review Issues

- ❌ **Overly broad permissions**: Only request necessary permissions
- ❌ **Missing privacy policy**: Required for all extensions
- ❌ **Insufficient functionality**: Extension must provide clear value
- ❌ **Manifest errors**: Validate manifest.json format

## Monitoring & Troubleshooting

### GitHub Actions Monitoring

Monitor deployment status:
1. **Actions tab**: Check workflow runs
2. **Release page**: Verify ZIP file attachment
3. **Chrome Web Store**: Check extension status

### Common Issues

#### Authentication Errors

```bash
# Symptoms: 401 Unauthorized errors
# Solutions:
# 1. Verify all secrets are set correctly
# 2. Regenerate refresh token if expired
# 3. Check OAuth client configuration
```

#### Build Failures

```bash
# Symptoms: Missing files in dist/
# Solutions:
# 1. Check Vite configuration
# 2. Verify all dependencies are installed
# 3. Review build logs for errors
```

#### Version Conflicts

```bash
# Symptoms: Version already exists error
# Solutions:
# 1. Ensure version was incremented
# 2. Check manifest.json vs package.json sync
# 3. Verify no duplicate releases
```

### Manual Upload Fallback

If automated deployment fails:

1. **Download build artifacts** from GitHub release
2. **Chrome Web Store Developer Dashboard**:
   - Go to your extension
   - Click "Upload new package"
   - Select the ZIP file
   - Submit for review

## Security Best Practices

### Credential Management

- ✅ **Never commit credentials** to the repository
- ✅ **Use GitHub secrets** for all sensitive data
- ✅ **Rotate credentials** regularly (quarterly)
- ✅ **Monitor API usage** in Google Cloud Console
- ✅ **Use least-privilege** OAuth scopes

### Access Control

- ✅ **Limit repository access** to trusted team members
- ✅ **Review deployment logs** for unauthorized changes
- ✅ **Enable 2FA** on all Google accounts
- ✅ **Audit secret access** regularly

## Team Workflow

### Development Process

1. **Feature development**: Work on feature branches
2. **Pull request**: Code review and CI checks
3. **Merge to main**: Triggers development builds
4. **Release preparation**: Use preparation workflow
5. **Release creation**: Team lead creates GitHub release
6. **Automatic deployment**: GitHub Actions handles deployment

### Release Cadence

- **Patch releases**: As needed for critical bugs
- **Minor releases**: Monthly for new features
- **Major releases**: Quarterly for significant changes

### Communication

- **Release announcements**: Notify team via Slack/email
- **Breaking changes**: Document in CHANGELOG.md
- **Rollback procedures**: Document emergency procedures

## Additional Resources

### Documentation

- [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api/)
- [Manifest V3 Migration](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

### Tools

- [Chrome Extension CLI](https://github.com/dutiyesh/chrome-extension-cli)
- [Web Store Upload CLI](https://github.com/DrewML/chrome-webstore-upload-cli)
- [Extension Source Viewer](https://chrome.google.com/webstore/detail/extension-source-viewer/jifpbeccnghkjeaalbbjmodiffmgedin)

### Support

- **Chrome Web Store**: [Developer Support](https://support.google.com/chrome_webstore/)
- **GitHub Actions**: [Community Forum](https://github.community/)
- **Aurelia**: [Discord Community](https://discord.gg/RBtyM6u)