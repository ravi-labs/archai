# Deploy ArchAI on AWS (S3 + CloudFront)

Host ArchAI privately on your own AWS — a single static file behind CloudFront
HTTPS. No servers, near-zero cost (pennies/month for one file). The same
template + script deploy into **any** AWS account, so you can test in one and
ship to your company account later with no changes.

## What it creates

- A **private S3 bucket** (all public access blocked, SSE enabled) holding `index.html`.
- A **CloudFront distribution** (HTTPS, Origin Access Control) that's the only thing allowed to read the bucket.

## Deploy

Requires the AWS CLI, configured for the account you want (`aws configure` / `AWS_PROFILE` / SSO).

```bash
cd deploy/aws
./deploy.sh                      # stack "archai-hosting" in us-east-1
./deploy.sh archai-prod us-east-1   # custom stack name / region
```

The script deploys the CloudFormation stack, uploads `index.html`, invalidates
the CloudFront cache, and prints the live URL. **Re-run it any time** to push an
updated build.

### Deploy in a different account

Point your credentials at the other account and run the same command:

```bash
AWS_PROFILE=company-prod ./deploy.sh archai-internal us-east-1
```

Nothing in the template is account-specific (the bucket is auto-named), so it
just works.

### Internal build (locked gateway + model picker)

For an internal deployment, edit `window.ARCHAI_CONFIG` at the top of the
`<script>` in `index.html` **before** deploying — e.g. wire it to your LiteLLM
gateway, lock the provider, and offer a model list:

```js
window.ARCHAI_CONFIG = {
  provider: "litellm",
  baseUrl:  "https://litellm.corp.example.com",
  model:    "claude-3-5-sonnet",
  models:   ["claude-3-5-sonnet", "gpt-4o"],   // users pick from these
  apiKey:   "sk-litellm-team-key",
  lockProvider: true,                           // hides provider/URL/key; model picker stays
  note: "Wired to ACME's LiteLLM gateway — pick a model and Generate."
};
```

Or deploy to a custom file with `SITE_FILE=/path/to/internal-index.html ./deploy.sh`.

## Access control / SSO (add-on layer)

The base above is **open to anyone with the URL** — fine for a quick test, not
for "internal only." Add one of these in front; the hosting doesn't change:

| Option | When it fits |
| --- | --- |
| **Your existing IdP / identity-aware proxy** (Okta, Azure AD, Cloudflare Access, AWS Verified Access) | You already have SSO — point it at the CloudFront URL. Simplest. |
| **ALB + Cognito** | Native Cognito auth (federates to your IdP). ~$16/mo ALB + a small target serving the file. |
| **Lambda@Edge + Cognito** ("auth@edge") | Self-contained on CloudFront, near-zero running cost, most setup. Deployed as its own stack. |

These are intentionally **not** in `cloudformation.yaml` so the base stays
portable. Ask and we can add the Cognito@Edge stack as `cloudformation-auth.yaml`.

## Tear down

```bash
aws s3 rm "s3://$(aws cloudformation describe-stacks --stack-name archai-hosting \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)" --recursive
aws cloudformation delete-stack --stack-name archai-hosting
```
(Empty the bucket first — CloudFormation won't delete a non-empty bucket.)
