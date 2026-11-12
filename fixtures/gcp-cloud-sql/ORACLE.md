# Oracle: gcp-cloud-sql

**Status:** written proof. Not verified against a real Google Cloud project.

## Question

Which addresses on the internet can connect to the database port of
`google_sql_database_instance.orders` and `google_sql_database_instance.reports`?

## Setup (the plan creates everything)

- `orders`: `POSTGRES_16`, `ipv4_enabled = true`, one authorized network `203.0.113.0/24`.
- `reports`: `MYSQL_8_0`, `ipv4_enabled = true`, no authorized networks.

Rules: [gcp.md](../../docs/semantics/gcp.md), "Cloud SQL".

## Proof

`orders`:

1. **Public IP.** `ipv4_enabled = true` (rule 10). Passes.
2. **Authorized networks.** The only allowed sources are `203.0.113.0/24` on tcp/5432,
   the PostgreSQL port (rules 11 and 12). Every other address is refused. Result:
   partial.

`reports`: no authorized networks, so "refuse all public IP connections" (rule 11). No
port is open to any internet address, so no path is a candidate and none is reported, as
for an AWS resource whose security groups open nothing.

## Expected result

| Path | Before | After | Diff |
|---|---|---|---|
| internet to `orders` tcp/5432 | `absent` | `allowed` from `203.0.113.0/24` | **added** |
| internet to `reports` | none reported | none reported | none |

## How to verify in Google Cloud

Use a throwaway project that the maintainer names for the run. Apply `after/` and connect
to the public IP of `orders` on 5432 from an address inside `203.0.113.0/24` (accepted)
and from outside it (refused). Connect to `reports` on 3306 from anywhere: refused.
