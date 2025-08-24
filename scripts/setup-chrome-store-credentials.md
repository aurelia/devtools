# Chrome Web Store API Credentials Setup

This guide explains how to set up the required credentials for automated Chrome Web Store deployment.

## Prerequisites

1. A Google Cloud Console account
2. A Chrome Web Store developer account
3. Admin access to this GitHub repository

## Step 1: Chrome Web Store Developer Dashboard

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Create a new extension or use existing one
3. Note down the **Extension ID** from the URL or dashboard (format: `abcdefghijklmnopqrstuvwxyzabcdef`)

## Step 2: Google Cloud Console Setup

### Enable Chrome Web Store API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the **Chrome Web Store API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Chrome Web Store API"
   - Click "Enable"

### Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Choose "Web application" as application type
4. Name it "Chrome Extension Publisher" or similar
5. Under "Authorized redirect URIs", add: `http://localhost:8080`
6. Download the JSON file - you'll need the `client_id` and `client_secret`

## Step 3: Generate Refresh Token

Run this script to generate a refresh token:

```bash
#!/bin/bash

# Replace with your actual values
CLIENT_ID="your-client-id.apps.googleusercontent.com"
CLIENT_SECRET="your-client-secret"
REDIRECT_URI="http://localhost:8080"

echo "1. Open this URL in your browser:"
echo "https://accounts.google.com/oauth/v2/auth?client_id=$CLIENT_ID&response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&redirect_uri=$REDIRECT_URI&prompt=consent"

echo ""
echo "2. Authorize the application"
echo "3. You'll be redirected to localhost:8080 with an error (this is expected)"
echo "4. Copy the 'code' parameter from the URL"
read -p "5. Enter the authorization code: " AUTH_CODE

echo ""
echo "6. Generating refresh token..."

RESPONSE=$(curl -s -X POST \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "code=$AUTH_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=$REDIRECT_URI" \
  "https://oauth2.googleapis.com/token")

echo "Response: $RESPONSE"

REFRESH_TOKEN=$(echo $RESPONSE | grep -o '"refresh_token":"[^"]*' | cut -d'"' -f4)

if [ -n "$REFRESH_TOKEN" ]; then
    echo ""
    echo "✅ Success! Your refresh token is:"
    echo "$REFRESH_TOKEN"
else
    echo ""
    echo "❌ Error: Could not generate refresh token"
    echo "Response: $RESPONSE"
fi
```

Save this as `scripts/generate-refresh-token.sh` and make it executable:
```bash
chmod +x scripts/generate-refresh-token.sh
```

## Step 4: GitHub Secrets Setup

Add these secrets to your GitHub repository:

1. Go to your GitHub repository
2. Navigate to Settings > Secrets and variables > Actions
3. Add these repository secrets:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `CHROME_EXTENSION_ID` | Extension ID from Chrome Web Store | `abcdefghijklmnopqrstuvwxyzabcdef` |
| `CHROME_CLIENT_ID` | OAuth Client ID from Google Cloud | `123456789.apps.googleusercontent.com` |
| `CHROME_CLIENT_SECRET` | OAuth Client Secret from Google Cloud | `GOCSPX-abc123def456...` |
| `CHROME_REFRESH_TOKEN` | Generated refresh token | `1//abc123def456...` |

## Step 5: Test the Setup

1. Create a test release using the "Prepare Release" workflow
2. Review the generated pull request
3. Create a GitHub release to trigger the deployment

## Security Best Practices

- ✅ Never commit credentials to the repository
- ✅ Use GitHub secrets for all sensitive data
- ✅ Regularly rotate OAuth credentials
- ✅ Monitor Chrome Web Store API usage
- ✅ Use least-privilege permissions

## Troubleshooting

### Invalid Credentials Error
- Verify all secrets are correctly set in GitHub
- Check that the OAuth client has the correct scopes
- Ensure the Chrome Web Store API is enabled

### Upload Failed
- Check extension manifest is valid
- Verify ZIP file contains all required files
- Ensure extension ID matches the one in Chrome Web Store

### Permission Denied
- Confirm the Google account has Chrome Web Store developer access
- Check OAuth scopes include `https://www.googleapis.com/auth/chromewebstore`

## Manual Upload Fallback

If automated deployment fails, you can manually upload:

1. Download the ZIP file from the GitHub release
2. Go to Chrome Web Store Developer Dashboard
3. Upload the ZIP file manually
4. Submit for review

## Additional Resources

- [Chrome Web Store API Documentation](https://developer.chrome.com/docs/webstore/api_index/)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Chrome Extension Publishing Guide](https://developer.chrome.com/docs/webstore/publish/)