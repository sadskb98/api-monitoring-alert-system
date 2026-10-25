# Intelligent API Monitoring & Alert System — interview assignment
Spec: docs/assignment.pdf

## Stack
- backend/: Node 22, Express, Mongoose (MongoDB), zod validation, pino logging, vitest + supertest
- frontend/: React + Vite + Tailwind
- LLM: Gemini via @google/genai; model name from GEMINI_MODEL env var
- Email: nodemailer (Ethereal in dev)
- Database: MongoDB Atlas via MONGODB_URI in backend/.env (no local Mongo, no Docker installed). Integration tests use mongodb-memory-server.

## Architecture rules
- Layered: routes -> controllers -> services -> models. No business logic in routes.
- Anomaly DETECTION is deterministic rule-based code (configurable thresholds). The LLM only WRITES the alert text. Never let the LLM decide whether something is an anomaly.
- The LLM call must never break ingestion: timeout + retry + template-based fallback.
- One LLM call per batch (not per record) to respect rate limits.
- All config via env vars validated at startup; ship .env.example.
- Central error handler; consistent JSON errors: { error: { code, message, details } }.
- Structured logs with request IDs.

## Conventions
- ESM modules. async/await only. Small pure functions where possible.
- Every service gets unit tests. Run `npm test` before saying a phase is done.
- Commit after each phase with a conventional commit message.
- Never print or log secrets from .env.
