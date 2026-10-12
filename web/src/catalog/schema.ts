// The catalog's schema version (SQLite `PRAGMA user_version`), shared by the catalog worker and the page, so a
// backup can say which version it holds and a restore can refuse one from a newer LightBench.
export const SCHEMA_VERSION = 11
