# Job Hunter

Desktop app (Electron + React + TypeScript) that finds new jobs every morning for one or more people,
scores each against their resume with an LLM, writes a tailored cover note, and shows a ranked list.
**You click Apply yourself** — it never submits applications, creates accounts or asks for passwords.

- Sources: JSearch / Adzuna API, Gmail job-alert emails (read-only OAuth), Naukri / LinkedIn (read-only browser, capped)
- AI engine: Claude, or any OpenAI-compatible server (FreeLLMAPI, OpenRouter, Ollama, LM Studio)
- Storage: local SQLite (`node:sqlite`); keys encrypted with the OS keychain

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build:mac
```
