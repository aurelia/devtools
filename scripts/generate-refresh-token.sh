#!/bin/bash

# Chrome Web Store Refresh Token Generator
# This script helps generate the refresh token needed for Chrome Web Store API access

set -e

echo "🔐 Chrome Web Store Refresh Token Generator"
echo "=========================================="
echo ""

# Check if curl and jq are available
if ! command -v curl >/dev/null 2>&1; then
    echo "❌ Error: curl is required but not installed."
    exit 1
fi

# Prompt for client credentials
echo "📋 Please provide your OAuth 2.0 credentials from Google Cloud Console:"
echo ""
read -p "Client ID: " CLIENT_ID
read -s -p "Client Secret: " CLIENT_SECRET
echo ""
echo ""

# Validate inputs
if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    echo "❌ Error: Both Client ID and Client Secret are required."
    exit 1
fi

# Generate authorization URL (using localhost redirect - more reliable than deprecated oob)
REDIRECT_URI="http://localhost:8080"
AUTH_URL="https://accounts.google.com/oauth/v2/auth?client_id=$CLIENT_ID&response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&redirect_uri=$REDIRECT_URI&prompt=consent"

echo "🌐 Step 1: Authorize the application"
echo "=================================="
echo ""
echo "Open this URL in your browser:"
echo "$AUTH_URL"
echo ""
echo "Follow these steps:"
echo "1. Sign in with your Google account (the one with Chrome Web Store access)"
echo "2. Grant permission to publish Chrome extensions"
echo "3. You'll be redirected to localhost:8080 with an error (this is expected)"
echo "4. Copy the 'code' parameter from the URL in your browser address bar"
echo "   Example: http://localhost:8080/?code=4/0Adeu5BW... (copy the part after 'code=')"
echo ""

read -p "Enter the authorization code: " AUTH_CODE
echo ""

# Validate authorization code
if [ -z "$AUTH_CODE" ]; then
    echo "❌ Error: Authorization code is required."
    exit 1
fi

echo "🔄 Step 2: Generating refresh token..."
echo "====================================="

# Exchange authorization code for tokens
RESPONSE=$(curl -s -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "code=$AUTH_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=$REDIRECT_URI" \
  "https://oauth2.googleapis.com/token")

# Check if request was successful
if echo "$RESPONSE" | grep -q "error"; then
    echo "❌ Error: Failed to generate refresh token"
    echo "Response: $RESPONSE"
    exit 1
fi

# Extract refresh token (using basic grep since jq might not be available)
REFRESH_TOKEN=$(echo "$RESPONSE" | grep -o '"refresh_token":"[^"]*' | cut -d'"' -f4)
ACCESS_TOKEN=$(echo "$RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -n "$REFRESH_TOKEN" ]; then
    echo "✅ Success! Tokens generated successfully."
    echo ""
    echo "📝 GitHub Secrets to Add:"
    echo "========================"
    echo ""
    echo "Add these secrets to your GitHub repository:"
    echo "(Settings > Secrets and variables > Actions > New repository secret)"
    echo ""
    echo "CHROME_CLIENT_ID = $CLIENT_ID"
    echo "CHROME_CLIENT_SECRET = $CLIENT_SECRET"
    echo "CHROME_REFRESH_TOKEN = $REFRESH_TOKEN"
    echo ""
    echo "🧪 Testing API access..."
    echo "======================="
    
    # Test the API access
    TEST_RESPONSE=$(curl -s -X GET \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      "https://www.googleapis.com/chromewebstore/v1.1/items?fields=items(id)")
    
    if echo "$TEST_RESPONSE" | grep -q "items"; then
        echo "✅ API test successful! You have access to Chrome Web Store API."
        
        # Show available extensions
        echo ""
        echo "📦 Your Chrome Web Store extensions:"
        echo "$TEST_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4 | while read -r ext_id; do
            echo "   Extension ID: $ext_id"
        done
    else
        echo "⚠️  Warning: API test failed. Please verify:"
        echo "   - Your Google account has Chrome Web Store developer access"
        echo "   - Chrome Web Store API is enabled in Google Cloud Console"
        echo "   Response: $TEST_RESPONSE"
    fi
    
    echo ""
    echo "🚀 Next Steps:"
    echo "============="
    echo "1. Add the secrets to your GitHub repository"
    echo "2. Set CHROME_EXTENSION_ID to your extension's ID"
    echo "3. Run the 'Prepare Release' workflow to test deployment"
    
else
    echo "❌ Error: Could not extract refresh token from response"
    echo "Response: $RESPONSE"
    exit 1
fi