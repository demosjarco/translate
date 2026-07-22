# translate

Drop in replacement for Google Cloud Translate API v2 using Workers AI

Built on [Hono](https://hono.dev/) and deployed as a [Cloudflare Worker](https://developers.cloudflare.com/workers/), this service mimics the Google Cloud Translation API v2 surface (`translate`, `detect`, `languages`) while running translations through [Workers AI](https://developers.cloudflare.com/workers-ai/) models via the [AI Gateway](https://developers.cloudflare.com/ai-gateway/). It's intended as a drop-in swap for existing Google Translate v2 API clients that just need to point at a different base URL.

Live at [translate.demosjarco.dev](https://translate.demosjarco.dev), with interactive API docs served from `/` (via [Scalar](https://github.com/scalar/scalar)) and OpenAPI specs at `/openapi.json`, `/openapi31.json`. An [`llms.txt`](https://translate.demosjarco.dev/llms.txt) is also served at the root, giving AI agents/LLMs a markdown-formatted summary of the API generated straight from the OpenAPI spec.

## API

All endpoints are mounted under `/language`, mirroring the Google Translate v2 API paths.

| Method | Path                               | Description                                                 |
| ------ | ---------------------------------- | ----------------------------------------------------------- |
| `POST` | `/language/translate/v2`           | Translate input text (`q`) into a `target` language.        |
| `POST` | `/language/translate/v2/detect`    | Detect the language of input text (`q`).                    |
| `GET`  | `/language/translate/v2/languages` | List supported languages, optionally localized to `target`. |

Query parameters generally follow the [Google Cloud Translate v2 API](https://cloud.google.com/translate/docs/reference/rest/v2/translate), with an added optional `model` parameter to pin a specific Workers AI model (see [`Models`](src/types.ts)) instead of the gateway-configured default.

Full request/response schemas are available via the generated OpenAPI documents.

## Development

Requires Node.js and a Cloudflare account with Workers AI access.

```sh
npm ci

# Generate Cloudflare binding types
npm run build:types:cf

# Run locally with Wrangler
npm run start
```

Other scripts:

- `npm run fmt` / `npm run fmt:fix` - check/format with Prettier
- `npm run lint` / `npm run lint:fix` - lint with ESLint
- `npm run build:static` - regenerate the static `dist/` assets (OpenAPI docs)
- `npm run publish:static` - publish specs to Cloudflare's API Gateway

Deployment to production runs via GitHub Actions ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)) on push to `main`.

## Sponsors

[![Cloudflare](https://github.com/Cloudflare.png?size=75)](https://www.cloudflare.com/developer-expert-program/)
