# Design

## Goal

Tara is a finance-research agent, not a free-form chatbot. The model decides which tool to call and how to explain the answer, but the system only returns financial numbers that were retrieved or computed from the database. The design optimizes for:

- grounding
- deterministic math
- generalization to an unseen snapshot
- debuggability under repeated runs

## Architecture

The runtime is intentionally narrow:

- Postgres stores the ingested snapshot
- Express exposes `POST /ask`
- Mastra runs the tool-calling loop
- SQL-backed tools perform retrieval and math
- Tara converts tool results into concise natural-language answers

This separation keeps the LLM responsible for orchestration and explanation, while code and SQL own correctness.

## Schema

### `datasets`

Columns:

- `id`
- `snapshot_key`
- `source_path`
- `ingested_at`

Why:

- records which snapshot is currently loaded
- preserves ingest provenance
- gives a clean anchor point if multi-snapshot support is added later

### `transactions`

Columns:

- `dataset_id`
- `id`
- `date`
- `merchant`
- `merchant_canonical`
- `merchant_tokens text[]`
- `category`
- `amount`
- `currency`
- `memo`

Primary key:

- `(dataset_id, id)`

Indexes:

- `(dataset_id, date)`
- `(dataset_id, category)`
- `(dataset_id, merchant_canonical)`
- `GIN (merchant_tokens)`

Why:

- spending questions are filter-heavy and aggregation-heavy
- merchant alias questions need a normalized grouping key plus token overlap lookup
- memos are stored for reference but never treated as executable instructions

### `funds`

Columns:

- `dataset_id`
- `id`
- `name`
- `name_normalized`
- `category`

Primary key:

- `(dataset_id, id)`

Index:

- `(dataset_id, name_normalized)`

Why:

- fund lookup should tolerate normalized wording from the model
- category is useful for ranking and grouping if future questions expand

### `fund_navs`

Columns:

- `dataset_id`
- `fund_id`
- `nav_date`
- `nav_value`

Primary key:

- `(dataset_id, fund_id, nav_date)`

Index:

- `(dataset_id, nav_date)`

Why:

- one row per `(fund, date)` makes period-return math deterministic
- separate NAV storage avoids nested JSON logic at query time

### `holdings`

Columns:

- `dataset_id`
- `fund_id`
- `fund_name`
- `units`
- `purchase_date`
- `purchase_nav`

Primary key:

- `(dataset_id, fund_id)`

Why:

- holdings model what the user actually owns
- realized-return questions need purchase metadata joined against the latest NAV

## Ingest Design

The ingest contract accepts a directory containing:

- `transactions.json`
- `funds.json`
- `holdings.json`

Flow:

1. ensure schema exists
2. clear current data
3. create one dataset record
4. insert transactions with normalized merchant fields
5. insert funds
6. explode monthly NAV arrays into `fund_navs`
7. insert holdings

This design deliberately depends on file shape, not on specific merchant names, fund IDs, or memo formats. That is the core defense against overfitting to `sample_a`, `sample_b`, or `sample_c`.

## Tool Design

The system uses four tools:

1. `query-transactions`
2. `detect-recurring-transactions`
3. `query-investments`
4. `get-dataset-summary`

Why this split:

- `query-transactions` handles most spending questions through one expressive tool instead of many overlapping tools
- `query-investments` similarly centralizes fund, holding, and portfolio analysis
- `detect-recurring-transactions` is separate because it uses a distinct heuristic path
- `get-dataset-summary` gives the agent a reliable way to anchor relative dates

This is a compromise between prompt simplicity and tool expressiveness. Too many narrow tools hurt selection accuracy; one giant tool hurts maintainability and validation.

## Grounding Rules

The core grounding guarantees are:

- every numeric answer comes from tool output
- totals, rankings, comparisons, and returns are computed in SQL or deterministic TypeScript
- no-data cases are answered honestly
- memos are inert data
- the model never performs unsupported arithmetic in prose

In practice, Tara behaves more like a reporting layer on top of a query engine than like a general-purpose assistant.

## Core Formulas

### Net spend

- `net_spend = SUM(amount)`

Interpretation:

- positive amounts increase spend
- refunds and reversals are negative and reduce spend
- transfers are excluded unless explicitly requested

### Merchant matching

Merchant matching is heuristic by design:

1. normalize text to uppercase alphanumeric tokens
2. remove generic noise tokens like `ORDER`, `BOOKING`, `COM`, `PVT`, `LTD`
3. store the remaining tokens in `merchant_tokens`
4. build `merchant_canonical` from the first one or two informative tokens
5. answer broad merchant questions using token overlap

This avoids hardcoded alias maps such as `SWIGGY_ALIASES = [...]`, which would fail the hidden-snapshot test.

### Recurring detection

A merchant is considered recurring if it appears in at least `N` distinct months, excluding transfers.

Current heuristic:

- aggregate by month, merchant, and category
- count distinct months seen
- report average amount and latest date

Tradeoff:

- simple and robust for obvious subscriptions
- not sophisticated enough to separate every recurring merchant from every high-frequency merchant

### Fund period return

For a requested fund and window:

- find the latest NAV on or before the requested start date
- find the latest NAV on or before the requested end date
- compute:

`period_return_percent = ((end_nav - start_nav) / start_nav) * 100`

### Holding realized return

For one owned holding:

- `cost_basis = units * purchase_nav`
- `current_value = units * latest_nav`
- `gain_amount = current_value - cost_basis`
- `realized_return_percent = (gain_amount / cost_basis) * 100`

### Portfolio summary

- sum cost basis across holdings
- sum current value across holdings
- `portfolio_gain = portfolio_value - portfolio_cost_basis`

## Relative Dates

Relative dates are anchored to dataset maxima, not wall-clock time:

- spending questions use `MAX(transactions.date)`
- fund and portfolio questions use `MAX(fund_navs.nav_date)`

This avoids incorrect behavior on historical snapshots. For this assignment, dataset-relative time is more truthful than system time.

## Observability

Every request writes a JSONL record containing:

- request id
- original question
- coarse task type
- tools called in order
- sanitized tool inputs
- tables read
- latency
- final success or failure state
- fallback/error message when applicable

Implementation detail:

- `AsyncLocalStorage` is used to accumulate tool traces during one agent run without threading logger objects through every layer

## Evals

The eval strategy is intentionally lightweight and repeatable:

1. start the local server
2. send a battery of questions to `POST /ask`
3. compute reference values from the same deterministic service layer
4. assert expected numbers or expected facts
5. print pass/fail output and a final summary

Coverage includes:

- single lookups
- refunds
- transfers
- merchant alias behavior
- recurring subscriptions
- no-data responses
- fund period returns
- realized holding returns
- portfolio value and gain
- mixed fund-vs-holding comparisons

The goal is not perfect NLP grading. The goal is to catch wrong numbers, missing facts, and brittle behavior quickly.

## Async Milestone

Not implemented.

Reason:

- the assignment allows skipping it if documented
- the highest-value work for this version was correctness, grounding, and repeatability in the synchronous path

If extended, I would add:

- a persisted jobs table
- a worker queue
- async resume flow back into a fresh agent turn

## Main Tradeoffs

### What this design prioritizes

- correctness over feature breadth
- generalization over sample-specific polish
- debuggability over opaque agent autonomy

### Known weak spots

- merchant canonicalization is heuristic and may split some aliases
- recurring detection is rule-based and may over-report some frequent merchants
- eval checks validate facts more than phrasing quality
- only one active snapshot is assumed at a time

## Remaining Failure Modes

The system can still fail if:

- the model chooses a semantically wrong tool path
- a merchant alias is too irregular for the current normalization heuristic
- a future hidden snapshot introduces a naming pattern not captured by token overlap
- deployment configuration diverges from local setup

Even with those risks, the current design keeps failures inspectable. That was a deliberate choice: a wrong answer with a clear trace is easier to fix and defend than a black-box answer with no evidence trail.
