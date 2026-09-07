# Environments and AWS Target Architecture

## Environments

| Environment | Database | Data | Deploy | Purpose |
|---|---|---|---|---|
| **Local** | SQLite (WAL) | Synthetic only | Manual | Development, fast tests |
| **CI** | SQLite + PostgreSQL | Synthetic, ephemeral | Per pull request | Both dialects verified every build |
| **Staging** | PostgreSQL (AWS) | Synthetic | Auto from `main` | Integration, end-to-end, demos |
| **Production** | PostgreSQL (AWS) | Real | Manual promotion | Live merchants |

**Production data never leaves production.** No dumps to laptops, no fixtures derived from real records, no debugging against a production copy. This is a policy with a CI check behind it (`10`), because it is the single easiest way for a small team to turn a support question into a breach.

## Local

Requirements: Node LTS, pnpm, a running local API, and a SQLite file. No Docker required, no cloud credentials required, no database server to install. This matters more than it sounds — friction in the local loop is what erodes the daily cadence.

`pnpm dev` starts the API, web, and a seeded SQLite database. `pnpm test` runs unit and integration tests in-memory in seconds.

## AWS target architecture

Deliberately conservative. The failure mode for a small team on AWS is a distributed architecture that nobody can debug at 2 a.m.

```
Route 53 → CloudFront → WAF
                          ├── S3 (web static assets)
                          └── ALB → ECS Fargate (API, 2+ tasks, multi-AZ)
                                      ├── RDS PostgreSQL (Multi-AZ)
                                      ├── ElastiCache Redis (cache, rate limits, job locks)
                                      ├── S3 (condition media, private)
                                      ├── Secrets Manager
                                      └── EventBridge → scheduled jobs
                                                        (hold sweeper, retention,
                                                         hash-chain verification)
```

| Concern | Service | Reasoning |
|---|---|---|
| Compute | **ECS Fargate** | No servers to patch, no Kubernetes to operate. Lambda rejected: the API is a long-lived stateful-connection workload, and cold starts hurt the availability endpoint |
| Database | **RDS PostgreSQL, Multi-AZ** | Managed backups, PITR, failover. Aurora Serverless v2 is a reasonable alternative if traffic is spiky; RDS is simpler and cheaper at pilot scale |
| Cache | **ElastiCache Redis** | Availability caching, rate limiting, distributed locks for scheduled jobs |
| Object storage | **S3**, private, versioned | Condition media. Never public; signed URLs only |
| CDN and WAF | **CloudFront + AWS WAF** | Static asset delivery, rate limiting, common attack rules |
| Secrets | **Secrets Manager** | Rotation; no secrets in environment variables at rest |
| Identity | **Cognito** (default) | Consolidation with the AWS target; alternatives per decision D4 |
| Scheduled jobs | **EventBridge Scheduler → ECS tasks** | The sweeper and retention jobs must be idempotent and safe to run concurrently |
| Logs and metrics | **CloudWatch** | Structured JSON logs; alarms on the security events in `07` |
| Infrastructure as code | **Terraform** | Every resource defined in code; this *is* the asset inventory evidence for `09` |

## Network

Private subnets for ECS tasks and RDS. Public subnets carry only the load balancer. RDS has no public endpoint and accepts connections only from the API security group. Access for administration is through SSM Session Manager — no bastion host, no SSH keys to manage or leak.

## Scaling posture

Start small: two Fargate tasks for availability rather than throughput, the smallest reasonable RDS instance, single Redis node. Scale on evidence, not anticipation.

The first component likely to need attention is the **availability endpoint**, which is unauthenticated, computationally non-trivial, and the cheapest thing for anyone to hammer. Its cache and rate limits exist from day one for that reason (`06`).

## Cost

Rough monthly steady-state at pilot scale, for planning rather than budgeting: Fargate 2 tasks ~$70; RDS Multi-AZ smallest class ~$130; Redis ~$25; S3 and CloudFront ~$20 at low volume; other services ~$40. **Approximately $250–$350/month**, before a load-driven step change.

Staging can run single-AZ and be scheduled down outside working hours, roughly halving its share.

## Migration to AWS

Not a date — a trigger. Cut over when the pilot requires concurrent merchants, managed backups, or a hosted environment. Then follow the seven-step cutover in `04`, ending with the exclusion constraint verified against real data and a parallel read-only period before writes are switched.

## Operational readiness (Phase 10)

Required before the first live merchant, and each produces evidence for `09`:

- Runbooks for the failure modes that will actually occur: database failover, deposit reconciliation mismatch, stuck sweeper, webhook backlog, availability cache poisoning
- **Backup restore rehearsed end to end.** An untested restore is not a backup
- Alerting on the security events in `07`, plus error rate, latency, and job failure
- Documented RTO and RPO targets, with the restore rehearsal as evidence they are achievable
- On-call reality stated honestly: with one developer there is no rotation, so alerting must be tuned to page only on genuine customer impact — an alerting scheme that cries wolf at 3 a.m. is worse than none

## Deliberately excluded

No Kubernetes. No microservices — one API service until there is a measured reason to split it. No multi-region — availability requirements do not justify the complexity at pilot scale. No self-managed database. No service mesh. Each of these is a reasonable choice for a larger team and an unreasonable one here, where operational simplicity is a survival requirement rather than a preference.
