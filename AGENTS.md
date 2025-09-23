# Repository Guidelines

## Project Structure & Module Organization
The CAP backend lives under `srv/`, with `service.cds` describing external services and the `agent/` directory hosting LangGraph agents. Domain models and sample payloads reside in `db/` (`schema.cds`, `data/`). UI assets ship from `app/claims`, while helper automation sits in `scripts/`. Use `docs/` for specs and keep generated artifacts in `tmp/` out of source control.

## Build, Test, and Development Commands
Run `npm install` once to sync dependencies. `npm start` serves the CAP service via `cds-serve` on port 9999; prefer `npm run watch` during feature work for hot reloads. `npm run watch:hybrid` starts the hybrid profile, while `npm run watch-claims` opens the claims UI with cache bypass. Exercise streaming flows with `npm run test:chat` or `npm run test:chat:raw`, and use `npm run test:formatting` to capture agent transcripts into `tmp/` for review.

## Coding Style & Naming Conventions
Follow the existing Node.js conventions: 2-space indent, semicolons, single quotes for strings, and descriptive camelCase identifiers. Keep CAP artifacts declarative; `*.cds` files group entities by bounded context, and service handlers in `srv/*.js` should export async functions. Avoid default exports for utilities; place shared helpers under `srv/agent/helpers/` and name files by capability (for example `thread-memory.js`). Run `npx cds lint` before pushing if you add CDS models.

## Testing Guidelines
Lightweight streaming regression checks live in `scripts/test-sse.ps1`; invoke it after modifying SSE endpoints. For programmatic checks, `npm run test:chat` runs scripted prompts against the agent. New validation scripts should live under `scripts/` and log into `tmp/` with clear filenames. When adding tests, suffix files with `.spec.js` and co-locate beside the module they exercise to keep watch tasks fast.

## Commit & Pull Request Guidelines
The history favors short, purposeful commits (see `7be9a65 feat(agent): add MCP-enabled Agent SSE endpoint and UI switch`). Use Conventional Commit prefixes (`feat`, `fix`, `chore`) with optional scope, and keep body bullets for noteworthy behavior changes. Reference Jira or GitHub issue IDs in the footer when applicable. Pull requests should summarise the change, list manual test commands, attach screenshots for UI work, and link to new docs or scripts so reviewers can reproduce agent runs.

## Security & Configuration Tips
Secrets stay in `.env`; never commit credentials. The service defaults to the `aicore-destination` destination and `gpt-4.1` model; override via `AI_DESTINATION_NAME` and `AI_MODEL_NAME` when testing external tenants. If you add new destinations, document them in `docs/` and provide sandbox fallbacks for contributors without SAP BTP access.
