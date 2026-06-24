# Research: OpenAI Codex Auth Reuse And Sidecar Implications

_Migrated into the Sidecar repo from workspace research originally prepared while evaluating Sidecar improvements in another workspace._

## Why This Research Exists

This note captures research that informed the boundaries of Codex-facing Sidecar ideas, especially around whether Sidecar should ever try to unlock OpenAI models by reusing subscription-backed Codex or ChatGPT authentication.

## Short Answer

The safest direction for Sidecar is still:

- direct OpenAI API billing when we want general OpenAI model access
- official Codex clients and officially documented surfaces when we want subscription-backed Codex access

What this research did **not** establish is a clear official blessing for arbitrary third-party reuse of subscription-backed Codex OAuth as a generic model gateway.

## Key Findings

### 1. ChatGPT Billing And API Billing Are Separate

The research found strong OpenAI documentation that ChatGPT subscriptions and API billing are separate product surfaces. A ChatGPT subscription should not be treated as general-purpose API access.

Implication for Sidecar:

- do not design features around the assumption that a ChatGPT or Codex subscription can substitute for normal API billing in arbitrary third-party flows

### 2. Official Codex Clients Can Authenticate With ChatGPT

The research found documentation showing that official Codex clients can authenticate with ChatGPT on eligible plans.

Implication for Sidecar:

- it is reasonable to treat official Codex surfaces as a supported subscription-backed path
- it is not reasonable to assume that the same support automatically extends to any external tool that reuses those credentials

### 3. OpenClaw Documents A Real OAuth Pattern

The research found that OpenClaw documents a PKCE OAuth flow for OpenAI Codex and distinguishes subscription-backed Codex usage from direct API-key usage.

Implication for Sidecar:

- the idea is technically plausible
- technical plausibility is not the same as policy clarity or official support

### 4. Policy Risk Remains Material

The research surfaced terms and help-center language that make unsupported token extraction, credential reuse, or other forms of auth repurposing riskier, especially when they could be interpreted as circumvention.

Implication for Sidecar:

- we should avoid features that import local auth files, scrape tokens, or stretch subscription-backed auth into a general unofficial provider path

## Product Guidance For Sidecar

This research points to a conservative product stance:

- keep direct API-key support as the default way to access OpenAI models
- keep official-client orchestration safer than token-import schemes
- avoid building features that depend on `~/.codex/auth.json`, local token copying, or reverse-engineered auth reuse
- treat any future subscription-backed integration as blocked on clearer official support

## Confidence Notes

- High confidence: ChatGPT billing and API billing are separate.
- High confidence: official Codex clients can authenticate with ChatGPT on eligible plans.
- Medium confidence: third-party reuse of subscription-backed OAuth may be technically possible.
- Medium confidence: public OpenAI docs reviewed in the original research did not clearly bless that third-party reuse pattern.

## Primary Sources Preserved From The Original Research

- https://developers.openai.com/codex/cli
- https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api
- https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform
- https://docs.openclaw.ai/providers/openai
- https://docs.openclaw.ai/concepts/oauth
- https://docs.openclaw.ai/help/faq
- https://openai.com/policies/terms-of-use/
- https://help.openai.com/en/articles/10471989
- https://help.openai.com/en/articles/10562188

## Maintainer Note

This document is a preserved research artifact, not a substitute for fresh policy review. If Sidecar ever revisits subscription-backed OpenAI or Codex auth, re-verify every source against the current official documentation first.
