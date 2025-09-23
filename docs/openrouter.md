# OpenRouter Integration

The CAP service can now talk to OpenRouter in addition to the existing SAP GenAI (Azure OpenAI) destination. Use the environment variables below to select the provider at runtime.

## Environment Variables

- `AI_PROVIDER`: set to `openrouter` to enable OpenRouter. Defaults to `azure` for the SAP destination.
- `OPENROUTER_API_KEY`: required when `AI_PROVIDER=openrouter`. Store the API key in `.env` and never commit it.
- `OPENROUTER_MODEL_NAME`: (optional) model identifier, e.g. `openai/gpt-4o-mini`. Falls back to `AI_MODEL_NAME` or `openai/gpt-4o-mini`.
- `OPENROUTER_BASE_URL`: override the API base (defaults to `https://openrouter.ai/api/v1`).
- `OPENROUTER_HTTP_REFERER`: optional header for OpenRouter app attribution.
- `OPENROUTER_APP_TITLE`: optional header shown in the OpenRouter dashboard.
- `AI_TEMPERATURE`: optional number used for both providers (defaults to `0.3`).
- `AGENT_MAX_COMPLETION_TOKENS`: optional cap for LangGraph agent completions (defaults to `500`).

Existing Azure settings (`AI_DESTINATION_NAME`, `AI_MODEL_NAME`) remain unchanged and are used when `AI_PROVIDER` is not set or set to `azure`.

## Behaviour

- The `/ai/stream` SSE endpoint, the `callLLM` action in `srv/service.js`, and the LangGraph agent (`/ai/agent/stream`) all share the provider factory.
- Streaming failures automatically fall back to a non-streaming completion to keep the UI responsive.
- Azure remains the default; switching back only requires removing or changing `AI_PROVIDER`.

## Quick Test

1. Add your OpenRouter API key to `.env` (`OPENROUTER_API_KEY=...`).
2. Set `AI_PROVIDER=openrouter` and optionally `OPENROUTER_MODEL_NAME`.
3. Start the service with `npm run watch` and call the `/ai/stream` endpoint or trigger the `callLLM` action from your UI.
4. Inspect the response headers/logs to confirm the model name reflects the selected provider.

When finished testing, remove the API key from your shell environment and `.env` if you no longer need OpenRouter.
