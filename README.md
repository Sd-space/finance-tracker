# Tara Finance Research Agent

Tara is a Mastra-based finance-research agent built for the Provue engineering take-home. It ingests a snapshot of personal-finance JSON into Postgres, answers natural-language questions through `POST /ask`, and keeps every monetary answer grounded in SQL-backed tool output.

## What This Repo Contains

- Postgres schema for transactions, funds, fund NAV history, holdings, and ingest provenance
- Snapshot ingest script that loads any assignment snapshot directory into Postgres
- Deterministic finance tools for spending analysis, recurring detection, fund returns, holding returns, and portfolio summaries
- Mastra agent orchestration for Tara
- Express server exposing the required `POST /ask` contract
- Built-in chat interface served from `/`
- JSONL request logs for observability
- Local eval script for repeatable checks

## Stack

- TypeScript
- Mastra SDK
- Express 5
- Postgres 14+
- NVIDIA-hosted OpenAI-compatible inference via `@ai-sdk/openai`

## API Contract

The required interface is:

```http
POST /ask
Content-Type: application/json

{ "question": "What was my biggest expense?" }
```

Response:

```json
{ "answer": "Your biggest expense was ..." }
```

The same deployment also serves a lightweight chat interface at:

```text
GET /
```

## Screenshots

Hero section:

![Tara hero UI](./image/Tara_hero.png)

Chat interface:

![Tara chat interface](./image/Tara_interface.png)

## Environment

Create a `.env` file in the project root with:

```env
NVIDIA_API_KEY=your_nvidia_api_key_here
NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b
DATABASE_URL=postgres://postgres:postgres@localhost:5432/provue_tara
PORT=3000
DATA_DIR=./data-20260603T120050Z-3-001/data/sample_a
LOG_DIR=./logs
```

Notes:

- If your Postgres password contains `@`, encode it as `%40` in `DATABASE_URL`
- `DATA_DIR` should point at one snapshot folder containing `transactions.json`, `funds.json`, and `holdings.json`
- The current implementation supports NVIDIA first, with OpenAI-compatible plumbing underneath

## Install

```bash
npm install
```

## Local Runbook

1. Create the Postgres database, for example `provue_tara`
2. Initialize the schema:

```bash
npm run db:init
```

3. Ingest one snapshot:

```bash
npm run ingest
```

Or choose another snapshot explicitly:

```bash
npm run ingest -- ./data-20260603T120050Z-3-001/data/sample_b
```

4. Start the server:

```bash
npm run start
```

5. Open the chat interface locally:

```text
http://localhost:3000/
```

6. Test the API locally:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/ask" `
  -ContentType "application/json" `
  -Body '{"question":"What was my biggest expense?"}'
```

Additional local examples:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/ask" `
  -ContentType "application/json" `
  -Body '{"question":"How much did I spend on food in March 2025 after refunds?"}'
```

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/ask" `
  -ContentType "application/json" `
  -Body '{"question":"What is my portfolio worth today, and how much have I made on it in absolute INR?"}'
```

## Evals

Start the server first, then run:

```bash
npm run eval
```

The eval script sends a battery of local questions to `/ask`, compares answers against deterministic reference values, and prints pass/fail output.

## Observability

Each `/ask` request appends one record to:

```text
logs/requests.jsonl
```

Each log line includes:

- `requestId`
- original `question`
- coarse task classification
- tools called, in order
- sanitized tool inputs
- tables read
- latency
- success/error status
- final answer or error message

## Data and Date Assumptions

Relative dates are resolved against the latest dates present in the ingested dataset, not against the machine clock.

Examples:

- spending-relative phrases like `last month` anchor to `MAX(transactions.date)`
- fund and portfolio phrases like `today` anchor to `MAX(fund_navs.nav_date)`

This is intentional because the assignment snapshots are historical.

## Generalization Strategy

The hidden-snapshot requirement shaped the design:

- the ingest script depends on file shape, not on sample-specific values
- merchant matching is heuristic and token-based, not hardcoded
- fund lookup is normalized, not keyed to a fixed sample list
- all money math lives in SQL or deterministic TypeScript, not in model prose

## Railway Smoke Test

Once the Railway service is live and the database has been initialized and ingested, test it with:

Health check:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "https://finance-tracker-production-3bc5.up.railway.app/health"
```

Basic spending question:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://finance-tracker-production-3bc5.up.railway.app/ask" `
  -ContentType "application/json" `
  -Body '{"question":"What was my biggest expense?"}'
```

Category spend question:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://finance-tracker-production-3bc5.up.railway.app/ask" `
  -ContentType "application/json" `
  -Body '{"question":"How much did I spend on food in March 2025 after refunds?"}'
```

Portfolio question:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://finance-tracker-production-3bc5.up.railway.app/ask" `
  -ContentType "application/json" `
  -Body '{"question":"What is my portfolio worth today, and how much have I made on it in absolute INR?"}'
```

## Known Limitations

- Merchant alias normalization is heuristic, so some edge-case aliases may remain split
- Recurring detection is intentionally simple and may over-report some frequent merchants
- The current implementation assumes one active ingested snapshot at a time
- The optional async background-job milestone is not implemented

## Submission Checklist

Before submitting, make sure you have:

- a working local `/ask`
- a passing or mostly passing local eval run
- `README.md` and `DESIGN.md` updated for the final handoff
- observability evidence from `logs/requests.jsonl`
- a fresh, unexposed API key
