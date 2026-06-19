#!/usr/bin/env bash
#
# Deploy ArchAI to S3 + CloudFront in the CURRENT AWS account/credentials.
# Re-run any time to push an updated index.html. Works in any account — just
# point your AWS credentials/profile at it.
#
#   ./deploy.sh [stack-name] [region]
#
# Env:
#   AWS_PROFILE   which credentials to use (standard AWS CLI behavior)
#   SITE_FILE     path to the HTML to deploy (default: repo-root index.html)
#
set -euo pipefail

STACK="${1:-archai-hosting}"
REGION="${2:-${AWS_REGION:-us-east-1}}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE="${SITE_FILE:-$HERE/../../index.html}"

if [[ ! -f "$SITE" ]]; then
  echo "✗ Site file not found: $SITE" >&2
  exit 1
fi

echo "→ Deploying stack '$STACK' in $REGION (account $(aws sts get-caller-identity --query Account --output text))"
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$HERE/cloudformation.yaml" \
  --region "$REGION" \
  --no-fail-on-empty-changeset

get() { aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

BUCKET="$(get BucketName)"
DIST="$(get DistributionId)"
URL="$(get URL)"

echo "→ Uploading $(basename "$SITE") → s3://$BUCKET/index.html"
aws s3 cp "$SITE" "s3://$BUCKET/index.html" --content-type "text/html; charset=utf-8" --region "$REGION"

echo "→ Invalidating CloudFront cache"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/" "/index.html" >/dev/null

echo ""
echo "✅ Live at: $URL"
echo "   (first deploy: CloudFront can take a few minutes to finish propagating)"
