#!/usr/bin/env bash
# deploy.sh — Deploy Planet Builder to AWS
# Usage:
#   ./infra/deploy.sh          # first deploy (creates stack)
#   ./infra/deploy.sh update   # subsequent deploys (update stack + sync files)
#   ./infra/deploy.sh sync     # sync files only (stack already up to date)

set -euo pipefail

# ── Load personal config ──────────────────────────────
# Copy infra/deploy.env.example → infra/deploy.env and fill in your values.
ENV_FILE="$(dirname "$0")/deploy.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy deploy.env.example and fill in your values."
  exit 1
fi
# shellcheck source=deploy.env
source "$ENV_FILE"

PROFILE="${AWS_PROFILE:?AWS_PROFILE not set in deploy.env}"
DOMAIN="${DOMAIN:?DOMAIN not set in deploy.env}"

REGION="us-east-1"          # MUST be us-east-1 for ACM + CloudFront
STACK_NAME="planet-builder"
TEMPLATE="$(dirname "$0")/stack.yaml"
APP_DIR="$(dirname "$0")/.."

# ── Colours ──────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}▶ $*${NC}"; }
success() { echo -e "${GREEN}✓ $*${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $*${NC}"; }

ACTION="${1:-deploy}"

# ── 1. Deploy / update CloudFormation stack ──────────
if [[ "$ACTION" != "sync" ]]; then
  info "Deploying CloudFormation stack '$STACK_NAME' to $REGION…"
  aws cloudformation deploy \
    --profile "$PROFILE" \
    --region  "$REGION" \
    --stack-name "$STACK_NAME" \
    --template-file "$TEMPLATE" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset

  success "Stack deployed."
fi

# ── 2. Fetch outputs ──────────────────────────────────
info "Fetching stack outputs…"

BUCKET=$(aws cloudformation describe-stacks \
  --profile "$PROFILE" \
  --region  "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text)

DIST_ID=$(aws cloudformation describe-stacks \
  --profile "$PROFILE" \
  --region  "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)

CF_DOMAIN=$(aws cloudformation describe-stacks \
  --profile "$PROFILE" \
  --region  "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" \
  --output text)

echo "  Bucket:       $BUCKET"
echo "  Distribution: $DIST_ID"
echo "  CF Domain:    https://$CF_DOMAIN"

# ── 3. Sync JS/CSS/assets with long-lived cache ───────
# Strategy: JS/CSS get max-age=1year + immutable so CloudFront and browsers
# cache them aggressively. index.html gets no-cache and embeds a deploy
# timestamp as a query string on every asset URL — so browsers always fetch
# the latest index.html, see new ?v= URLs, and re-fetch any changed assets.
info "Syncing app files to s3://$BUCKET …"

DEPLOY_VERSION=$(date +%s)   # Unix timestamp used as cache-buster in index.html

aws s3 sync "$APP_DIR" "s3://$BUCKET" \
  --profile "$PROFILE" \
  --exclude ".git/*" \
  --exclude ".claude/*" \
  --exclude "infra/*" \
  --exclude ".DS_Store" \
  --exclude "*.sh" \
  --exclude "*.md" \
  --exclude "node_modules/*" \
  --exclude "index.html" \
  --delete \
  --cache-control "public, max-age=31536000, immutable"

# index.html: stamp every js/css reference with ?v=<timestamp> so that
# after a deploy, browsers fetch the updated files even if filenames are identical.
TMPFILE=$(mktemp /tmp/index.XXXXXX.html)
sed "s/\.js\"/\.js?v=${DEPLOY_VERSION}\"/g; s/\.css\"/\.css?v=${DEPLOY_VERSION}\"/g" \
  "$APP_DIR/index.html" > "$TMPFILE"

aws s3 cp "$TMPFILE" "s3://$BUCKET/index.html" \
  --profile "$PROFILE" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html"

rm "$TMPFILE"

success "Files synced (deploy version: $DEPLOY_VERSION)."

# ── 4. Invalidate CloudFront cache ────────────────────
info "Invalidating CloudFront cache…"

INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --profile "$PROFILE" \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text)

success "Invalidation created: $INVALIDATION_ID"

# ── 5. Done ───────────────────────────────────────────
echo ""
success "Deployment complete!"
echo -e "  ${GREEN}https://${DOMAIN}${NC}  (DNS may take a few minutes)"
echo -e "  ${CYAN}https://$CF_DOMAIN${NC}  (CloudFront domain, works immediately)"
