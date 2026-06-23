# Pi Provider Factory

**Pi Provider Factory is an Oh My Pi provider extension for using Factory.ai Droid models from `omp`, including Claude Opus, Claude Sonnet, GPT, Codex, GLM, Kimi, DeepSeek, MiniMax, and Nemotron models through Factory's authenticated LLM gateway.**

Last updated: 2026-06-23

## What this package does

This package registers a custom `factory` provider for [Oh My Pi](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent). It mirrors Factory Droid's authentication and request routing so `omp` can call Factory-hosted models with either Factory browser OAuth or a Factory API key.

Use it when you want:

- Factory.ai model access inside `omp`
- Droid-style Factory OAuth device login at `https://auth.factory.ai/device`
- Factory-routed Claude, GPT, Codex, and open-weight coding models
- Region-aware Factory API routing, including EU residency endpoints
- One provider namespace for Factory models such as `factory/claude-opus-4-8` and `factory/gpt-5.5`

## Supported models

The extension ships a 25-model curated fallback catalog and refreshes Factory's public model docs for additional supported model IDs.

### Claude and Anthropic-family models

These models route through Factory's Anthropic-compatible gateway:

- `claude-opus-4-8`
- `claude-opus-4-8-fast`
- `claude-opus-4-7`
- `claude-opus-4-7-fast`
- `claude-opus-4-6`
- `claude-opus-4-6-fast`
- `claude-sonnet-4-6`
- `claude-opus-4-5-20251101`
- `claude-sonnet-4-5-20250929`
- `claude-haiku-4-5-20251001`

### GPT and Codex models

These models route through Factory's OpenAI Responses-compatible gateway:

- `gpt-5.5`
- `gpt-5.5-fast`
- `gpt-5.5-pro`
- `gpt-5.4`
- `gpt-5.4-fast`
- `gpt-5.4-mini`
- `gpt-5.3-codex`
- `gpt-5.3-codex-fast`
- `gpt-5.2`

### Factory Core and open-weight chat models

These models route through Factory's OpenAI chat-completions-compatible gateway:

- `glm-5.2`
- `glm-5.1`
- `kimi-k2.7-code`
- `deepseek-v4-pro`
- `minimax-m3`
- `nemotron-3-ultra`

## Request routing

Factory model requests go to Factory's LLM gateway. The default base URL is:

```text
https://api.factory.ai
```

OAuth credentials may provide a region-specific `apiEndpoint`, such as:

```text
https://api.eu.factory.ai
```

`FACTORY_API_BASE` overrides both the default host and any OAuth-provided `apiEndpoint`; this is useful for testing, proxies, or controlled environments.

| Model family | Base path | Wire API | Header |
| --- | --- | --- | --- |
| Claude / Anthropic | `${apiEndpoint}/api/llm/a` | Anthropic Messages `/v1/messages` | `x-api-provider: anthropic` |
| GPT / Codex | `${apiEndpoint}/api/llm/o/v1` | OpenAI Responses `/responses` | `x-api-provider: openai` |
| GLM / Kimi / DeepSeek / MiniMax / Nemotron | `${apiEndpoint}/api/llm/o/v1` | OpenAI Chat Completions `/chat/completions` | `x-api-provider: factory` |

Examples:

```text
factory/claude-opus-4-8
→ https://api.factory.ai/api/llm/a/v1/messages

factory/gpt-5.5
→ https://api.factory.ai/api/llm/o/v1/responses

factory/glm-5.1
→ https://api.factory.ai/api/llm/o/v1/chat/completions
```

The extension also sends Droid-compatible Factory headers, including `X-Factory-Client`, `X-Client-Version`, `X-Factory-Org-Id`, `x-session-id`, `x-assistant-message-id`, and the appropriate `x-api-provider` value.

## Installation

Install dependencies with Bun:

```zsh
bun install
```

Link the extension into `omp`:

```zsh
omp plugin link "$PWD"
```

Confirm the provider is discoverable:

```zsh
omp models find factory
```

Force a fresh Factory catalog fetch at any time:

```zsh
omp models refresh factory
```

This pulls Factory's public model docs for newly supported model IDs and falls back to the built-in catalog if Factory's docs endpoint is unavailable.

## Authentication

### Browser OAuth, recommended

Run `omp`, log in to the Factory provider, and leave the API-key prompt blank:

```text
/login factory
```

The extension opens Factory's Droid device login URL:

```text
https://auth.factory.ai/device
```

After successful login, the extension stores refreshable OAuth credentials through Oh My Pi's normal provider auth storage.

### Factory API key

You can use a Factory API key by setting `FACTORY_API_KEY`:

```zsh
export FACTORY_API_KEY="fk-..."
```

When `FACTORY_API_KEY` is present, Oh My Pi treats it as the provider API key source. If you want to test OAuth instead, unset it first:

```zsh
unset FACTORY_API_KEY
```

### Organization and region handling

Factory's gateway requires an organization-scoped bearer token or an organization header. This extension derives the Factory organization ID from OAuth JWT claims or `/api/cli/whoami`, and it can recover WorkOS organization scope during refresh.

OAuth login and refresh support:

- WorkOS device authorization
- Organization-scoped token refresh
- Factory org ID extraction for `X-Factory-Org-Id`
- Region discovery via `/api/cli/whoami`
- Region-to-base-URL mapping, including `eu` → `https://api.eu.factory.ai`

## Environment variables

| Variable | Purpose |
| --- | --- |
| `FACTORY_API_KEY` | Optional Factory `fk-...` API key. Takes precedence over OAuth in normal provider resolution. |
| `FACTORY_API_BASE` | Overrides the Factory API base URL for every request, including OAuth-discovered endpoints. |
| `FACTORY_ORG_ID` | Optional explicit Factory organization ID header value. |
| `FACTORY_ORGANIZATION_ID` | Alias for `FACTORY_ORG_ID`. |
| `FACTORY_UPSTREAM_CLIENT_TYPE` | Optional override for `X-Factory-Client`; defaults to `cli`. |

## Usage examples

Run a Claude model through Factory:

```zsh
omp -p --model factory/claude-opus-4-8 --no-tools "reply with the single word ok"
```

Run a GPT model through Factory:

```zsh
omp -p --model factory/gpt-5.5 --no-tools "summarize this repo in one sentence"
```

Run a Factory Core model:

```zsh
omp -p --model factory/glm-5.2 --no-tools "write a concise TypeScript function"
```

## Implementation notes

### Anthropic system prompt compatibility

Factory's Anthropic gateway rejects requests that use Anthropic's top-level `system` field. For Anthropic-family models only, this extension folds the system prompt into the first user turn before forwarding the request. OpenAI Responses and chat-completions routes keep their native prompt handling.

### API-key and OAuth credential formats

The router accepts either:

1. A raw bearer/API key string.
2. An OAuth credential envelope containing `access`, `orgId`, and `apiEndpoint`.

Raw OAuth JWTs are decoded locally only to derive non-secret routing metadata such as Factory org ID. Tokens are not logged or printed by the extension.

## Troubleshooting

### `No API key found for factory`

Run:

```text
/login factory
```

Then leave the `fk-...` prompt blank for browser OAuth, or paste a Factory API key.

### Factory login opens the wrong page

The expected OAuth URL is Factory's Droid device URL:

```text
https://auth.factory.ai/device
```

If you see a generic WorkOS authorize URL, relink this plugin and log in again:

```zsh
omp plugin link "$PWD"
omp
/logout factory
/login factory
```

### `403 Forbidden` from Factory

Most 403s are caused by one of these issues:

1. `FACTORY_API_KEY` is set and overriding OAuth credentials.
2. The OAuth token is not organization-scoped.
3. The request is missing `X-Factory-Org-Id`.
4. The Anthropic route sent a top-level `system` field.
5. The wrong regional endpoint is being used.

Start with a clean OAuth run:

```zsh
unset FACTORY_API_KEY FACTORY_ORG_ID FACTORY_ORGANIZATION_ID FACTORY_API_BASE
omp
/logout factory
/login factory
/model factory/claude-opus-4-8
```

Then test:

```text
reply with the single word ok
```

## FAQ

### What is Pi Provider Factory?

Pi Provider Factory is an Oh My Pi extension that adds a `factory` provider for Factory.ai's Droid LLM gateway. It lets `omp` use Factory-routed Claude, GPT, Codex, and open-weight coding models with Droid-compatible OAuth and request headers.

### Does this call Anthropic or OpenAI directly?

No. Requests go to Factory's gateway first. Factory then routes each request to the appropriate upstream family based on model ID and the `x-api-provider` header.

### Which endpoint does `factory/claude-opus-4-8` use?

`factory/claude-opus-4-8` uses Factory's Anthropic-compatible endpoint: `${apiEndpoint}/api/llm/a/v1/messages`. By default, that is `https://api.factory.ai/api/llm/a/v1/messages`.

### Which endpoint does `factory/gpt-5.5` use?

`factory/gpt-5.5` uses Factory's OpenAI Responses-compatible endpoint: `${apiEndpoint}/api/llm/o/v1/responses`.

### Which endpoint do Factory Core models use?

Factory Core and open-weight chat models such as `glm-5.2`, `glm-5.1`, `kimi-k2.7-code`, and `deepseek-v4-pro` use `${apiEndpoint}/api/llm/o/v1/chat/completions`.

## Development

Run the TypeScript compiler:

```zsh
bunx tsc --noEmit
```

Run a live smoke test after authenticating:

```zsh
unset FACTORY_API_KEY FACTORY_ORG_ID FACTORY_ORGANIZATION_ID FACTORY_API_BASE
omp -p --model factory/claude-opus-4-8 --no-tools "reply with the single word ok"
```

Expected output:

```text
ok
```
