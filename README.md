# SwiftGrid
**A Rust-powered distributed orchestration engine that is visual, scalable, developer-first.**

SwiftGrid provides a **visual DAG builder** and **distributed execution engine** designed for developers who want automation that scales **beyond a single runtime**.

Unlike platforms that run UI, scheduling, and execution inside one Node.js worker, SwiftGrid splits concerns cleanly:

- A **SvelteKit Control Plane** handles scheduling, state, and orchestration logic
- **Rust Workers** execute tasks in parallel with infra-grade performance
- **Redis Streams** coordinate distributed execution with delivery guarantees

If you're familiar with tools like n8n or Airflow, but want **systems-level primitives rather than a monolithic runtime**, that’s exactly the problem SwiftGrid solves.

![License](https://img.shields.io/badge/license-AGPLv3-blue.svg)
![MadeWith](https://img.shields.io/badge/built_with-Rust_&_SvelteKit-red.svg)
![Scales](https://img.shields.io/badge/scales-horizontally-green.svg)
![PRs](https://img.shields.io/badge/PRs-welcome-blueviolet.svg)


## The Vision

SwiftGrid is a **Distributed Workflow Orchestration Engine** that combines the usability of visual builders with the stability of systems-level architecture.

Traditional automation tools tend to bundle UI, orchestration, and execution into a single process. Convenient — until you need:

- real concurrency,
- safe state management,
- horizontal scaling,
- or to debug what actually happened.

SwiftGrid separates these responsibilities across the stack, giving developers distributed orchestration without treating JavaScript like it’s the only tool in the shed.

> Originally built after hitting real concurrency limits with JavaScript-based automation engines.

SwiftGrid wasn’t built as a concept — it was built because the alternatives buckled under real workloads.


## What SwiftGrid is NOT

Before someone builds a spaceship on top of this — a few guardrails:

- ❌ Built for accountants, marketers, or "citizen developers"
- ❌ AI fairy dust that figures everything out for you
- ❌ “Zapier clone, but self-hosted” that’s not the goal
- ❌ A place where background jobs go to never be seen again

SwiftGrid is for **developers** who want visual orchestration **with infra-grade execution guarantees**, backed by Rust, streams, and explicit control.

If you want a no-code SaaS for your accounting team — this probably isn't that.


## Architecture

SwiftGrid uses a control-plane / worker model with Redis Streams as the message bus.

```text
┌─────────────────────┐
│   Browser Client    │
│   (Svelte Flow)     │
└─────────┬───────────┘
          │ SSE Connection
          ▼
┌─────────────────────┐        ┌──────────────────┐
│   Control Plane     │◄──────►│    PostgreSQL    │
│   (SvelteKit)       │        │   (Persistence)  │
└─────────┬───────────┘        └──────────────────┘
          │
          │ XADD (Jobs)
          ▼
┌─────────────────────┐
│   Redis Streams     │
│  ┌───────────────┐  │
│  │ swiftgrid_    │  │
│  │ stream (jobs) │  │
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ swiftgrid_    │  │
│  │ results       │  │
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ swiftgrid_    │  │
│  │ chunks (live) │  │
│  └───────────────┘  │
└─────────┬───────────┘
          │ XREADGROUP (Claim)
          ▼
┌─────────────────────┐
│   Rust Workers      │
│   (Tokio + Reqwest) │
└─────────────────────┘
```

### Control Plane (SvelteKit)

The Control Plane is the brain:

- Renders the UI using Svelte Flow
- Determines execution order based on graph topology
- Sends jobs to Redis
- Streams live results back via SSE
- Resolves secrets server-side
- Stores immutable run history

The control plane understands the workflow. Workers don't need to.


### Message Bus (Redis Streams)

Redis Streams keeps everything decoupled and recoverable:

- `swiftgrid_stream` for jobs
- `swiftgrid_results` for completion events
- `swiftgrid_chunks` for real-time streaming (LLMs, progress)

If a worker crashes mid-run — the message waits patiently.


### Execution Engine (Rust)

Workers are intentionally simple:

1. Claim job  
2. Deserialize  
3. Execute (HTTP, code, delay, etc.)  
4. Publish result  

Stateless means:

- Low resource usage  
- Easy scaling  
- No hidden context  

QuickJS provides sandboxed JS execution with memory and timeout limits to prevent meltdown moments.


## Features

- **Visual Graph Builder:** Drag-and-connect workflows with real-time state feedback.
- **Real-Time Output Streaming:** SSE sends results instantly; LLMs stream token-by-token.
- **Data Passing Between Nodes:** Use syntax like `{{node_id.body.data.items[0].name}}`
- **Secure Secret Resolution:** Secrets resolve server-side, never sent to the browser or worker.
- **Workflow Snapshots & Versioning:** Every publish creates an immutable version.
- **Sub-Flows:** Call workflows inside workflows, recursion handled responsibly.
- **Map / Parallel Execution:** Run large batches with configurable concurrency across workers.

**Node Types:** HTTP | Code | Delay | Router | LLM | Webhook Wait | SubFlow | Map | *more coming*


## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Frontend | Svelte 5 (Runes), SvelteKit, TailwindCSS v4, Svelte Flow |
| Backend API | SvelteKit API Routes, Drizzle ORM, ioredis |
| Worker | Rust, Tokio, Reqwest, Serde, rquickjs, SQLx |
| Infrastructure | PostgreSQL 16, Redis 7, Docker Compose |


## Getting Started

### Prerequisites

- Docker & Docker Compose  
- Node.js v20+ and pnpm  
- Rust (cargo)  

### Installation

**1. Clone and start infrastructure**

```bash
git clone https://github.com/yourusername/swiftgrid.git
cd swiftgrid
docker compose up -d
```

**2. Set up the Control Plane**

```bash
cd apps/web
pnpm install
pnpm drizzle-kit push
pnpm dev
```

**3. Start the Rust Worker**

```bash
cd apps/worker
cargo run
```

**4. Open the app**

Visit: [http://localhost:5173](http://localhost:5173)

### Environment Variables (Production)

| Variable | Description |
| -------- | ----------- |
| `DATABASE_URL` | Postgres connection |
| `REDIS_URL` | Redis connection |
| `DB_POOL_SIZE` | Worker DB pool size (default 20). Keep below Postgres `max_connections` and leave headroom for web (defaults to 10). |
| `JS_MEMORY_LIMIT` | QuickJS memory limit |
| `JS_TIMEOUT_MS` | Execution timeout |
| `WORKER_VERBOSE` | Debug logs |


## Design Principles

**Push, Don't Pull**  
Events stream outward; the UI doesn't nag for updates.

**Typed Across Boundaries**  
Rust types generate TypeScript. Errors appear where you want them — before runtime.

**Stateless Execution**  
Workers don't know the graph; they just do the work.

**Generic Execution**  
No specialized vendor plugins. HTTP is the universal adapter.


## Contributing

Pull requests are welcome, especially:

- New node types
- Improved documentation
- Rust worker improvements
- Bug fixes and edge-case handling
- Ideas and feature proposals via Issues

If you break something and also fix it, you're officially part of the team.

### Guidelines

- Keep changes scoped
- Document behavior
- Don't surprise other devs on purpose
- Do surprise them with better performance

Before opening a PR, feel free to start a discussion issue to explore direction.


## Roadmap

| Idea | Status |
| ---- | ------ |
| Durable scheduled tasks | Soon |
| Web UI node marketplace | Planning |
| Native Python worker | Probably |
| AI Agent routing | When it's actually useful |
| Multi-tenant mode | Later |
| Dark mode | Already exists because priorities |

Questions not answered yet: The answer exists... just not in my head yet.


## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.  
See the [LICENSE](LICENSE) file for the full text.
