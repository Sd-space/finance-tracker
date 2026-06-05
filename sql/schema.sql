CREATE TABLE IF NOT EXISTS datasets (
  id BIGSERIAL PRIMARY KEY,
  snapshot_key TEXT NOT NULL UNIQUE,
  source_path TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  date DATE NOT NULL,
  merchant TEXT NOT NULL,
  merchant_canonical TEXT NOT NULL,
  merchant_tokens TEXT[] NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  currency TEXT NOT NULL,
  memo TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id)
);

CREATE TABLE IF NOT EXISTS funds (
  dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id)
);

CREATE TABLE IF NOT EXISTS fund_navs (
  dataset_id BIGINT NOT NULL,
  fund_id TEXT NOT NULL,
  nav_date DATE NOT NULL,
  nav_value NUMERIC(14, 4) NOT NULL,
  PRIMARY KEY (dataset_id, fund_id, nav_date),
  FOREIGN KEY (dataset_id, fund_id) REFERENCES funds(dataset_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS holdings (
  dataset_id BIGINT NOT NULL,
  fund_id TEXT NOT NULL,
  fund_name TEXT NOT NULL,
  units NUMERIC(14, 4) NOT NULL,
  purchase_date DATE NOT NULL,
  purchase_nav NUMERIC(14, 4) NOT NULL,
  PRIMARY KEY (dataset_id, fund_id),
  FOREIGN KEY (dataset_id, fund_id) REFERENCES funds(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(dataset_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(dataset_id, category);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_canonical ON transactions(dataset_id, merchant_canonical);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_tokens ON transactions USING GIN (merchant_tokens);
CREATE INDEX IF NOT EXISTS idx_funds_name_normalized ON funds(dataset_id, name_normalized);
CREATE INDEX IF NOT EXISTS idx_fund_navs_date ON fund_navs(dataset_id, nav_date);
