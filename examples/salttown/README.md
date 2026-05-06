# Salt Town

A **Gas City-inspired** multi-agent topology built on [agent-teams](../../README.md).

Salt Town replicates the core architecture of Steve Yegge's [Gas Town](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04) / [Gas City](https://steve-yegge.medium.com/welcome-to-gas-city-57f564bb3607) using ppz messaging and the agent-teams framework.

## Topology

```
                          ┌─────────────┐
                          │  Mine Owner │   (you)
                          └──────┬──────┘
                                 │
                          ┌──────▼──────┐
                          │   Sheriff   │   coordinator
                          │  (= Mayor)  │   deterministic routing table
                          └──┬──┬──┬──┬─┘   convoy tracking
              ┌──────────────┘  │  │  └──────────────┐
         ┌────▼────┐    ┌──────▼┐ ┌▼────────┐   ┌────▼──────┐
         │ Miners  │    │Smelt- │ │ Lookout │   │Prospector │
         │(=Poles) │    │  er   │ │(=Witn.) │   │(=Deacon)  │
         ├─────────┤    │(=Ref.)│ ├─────────┤   ├───────────┤
         │miner-api│    ├───────┤ │monitors │   │ watches   │
         │  branch:│    │merges │ │ miners  │   │ lookout   │
         │  salt/  │    │branch-│ │via hooks│   │ + system  │
         │  miner- │    │es to  │ │& termi- │   │  patrol   │
         │  api    │    │main   │ │nal read │   │ + maint.  │
         ├─────────┤    │sequen-│ └─────────┘   └───────────┘
         │miner-tst│    │tially │     ▲               │
         │  branch:│    └───────┘     │  watchdog      │
         │  salt/  │                  │  chain         │
         │  miner- │                  └────────────────┘
         │  test   │            Prospector → Lookout → Miners
         └─────────┘
           feature branches         two-tier monitoring
```

## Role Mapping

| Gas Town | Salt Town | Description |
|----------|-----------|-------------|
| **Mayor** | **Sheriff** | Coordinator with a **deterministic routing table** (not free-form LLM routing). Writes hook files before dispatching. Tracks work via convoy file. |
| **Polecats** | **Miners** | Ephemeral swarm workers on **isolated git branches** (`salt/miner-api`, `salt/miner-test`). Write gate files on completion. Support crash recovery via hook state. |
| **Refinery** | **Smelter** | Processes a **sequential merge queue** — merges miner branches to main one-at-a-time, runs tests after each merge, fixes integration issues. |
| **Witness** | **Lookout** | Health patrol via **three signals**: hook state files, gate files, and terminal output. Reports stuck miners to Sheriff. |
| **Deacon/Dogs/Boot** | **Prospector** | Town-level patrol. **Watches the Lookout** (two-tier watchdog chain). Runs codebase maintenance. Sends GUPP nudges to stuck Lookout. |

## Gas Town Concepts Implemented

### GUPP (Gas Town Universal Propulsion Principle)
> "If there is work on your hook, YOU MUST RUN IT."

Workers check `.salttown/hooks/<handle>.json` on startup. If a hook file exists (even from a crashed previous run), the agent reads it and executes immediately.

### Hooks (Durable State)
Each worker has a hook file at `.salttown/hooks/<handle>.json`:
```json
{"handle":"miner-api","task":"Build the REST API","branch":"salt/miner-api","status":"in_progress"}
```
If an agent crashes, a new instance reads the hook and resumes. This is Salt Town's lightweight equivalent of Gas Town's Beads-backed hooks.

### Gates (Async Coordination)
Workers signal completion by writing gate files to `.salttown/gates/`:
```
.salttown/gates/miner-api-done    ← miner-api finished
.salttown/gates/miner-test-done   ← miner-test finished
.salttown/gates/smelter-done      ← smelter merge complete
```
Downstream workers poll for gate files rather than relying on ppz messages alone. This mirrors Gas Town's gate system (`gh:run`, `timer`, `mail`).

### Convoy Tracking
The Sheriff writes `.salttown/convoy.json` — a batch tracker for the entire unit of work:
```json
{
  "id": "convoy-1",
  "status": "active",
  "tasks": {
    "miner-api": { "status": "in_progress", "branch": "salt/miner-api" },
    "miner-test": { "status": "pending", "branch": "salt/miner-test" },
    "smelter": { "status": "pending" }
  }
}
```
This mirrors Gas Town's convoy construct for grouping related beads.

### Deterministic Routing
The Sheriff follows a **fixed routing table**, not free-form LLM decisions:

| Worker | Owns | Branch | Depends On |
|--------|------|--------|------------|
| miner-api | `src/**` | `salt/miner-api` | (none) |
| miner-test | `tests/**` | `salt/miner-test` | miner-api |
| smelter | (reviews all) | merges to main | ALL miners |

This approximates Gas Town's deterministic SLING → HOOK → GUPP pipeline, where the LLM does the work but not the routing.

### Branch Isolation (Merge Queue)
Each miner works on its own git branch:
- `miner-api` → `salt/miner-api`
- `miner-test` → `salt/miner-test` (branched from `salt/miner-api`)

The Smelter merges branches to main **sequentially** (dependencies first), exactly like Gas Town's Refinery processes the merge queue one contribution at a time.

### Two-Tier Watchdog Chain
```
Gas Town:  Daemon → Boot → Deacon → Witness → Polecats
Salt Town:              Prospector → Lookout → Miners
```
The Prospector monitors the Lookout's terminal output. If the Lookout stops producing patrol reports, the Prospector sends a GUPP nudge. The Lookout monitors miners via hook files, gate files, and terminal output.

### Crash Recovery
If a miner crashes mid-work:
1. Its hook file persists in `.salttown/hooks/<handle>.json` with status `"in_progress"`
2. Its git branch persists with any committed work
3. A new agent instance reads the hook, checks out the branch, and resumes

This mirrors Gas Town's durability model where "if the system crashes, Gas Town will read the Git history and resume."

### Escalation Hierarchy
```
Prospector detects Lookout is dead
    → nudges Lookout with GUPP signal
    → if still dead, reports to Sheriff

Lookout detects stuck Miner
    → reports to Sheriff
        → Sheriff nudges Miner via chat
            → if 3 nudges fail, Sheriff broadcasts to Mine Owner (user)
```

## State Directory

```
.salttown/
├── convoy.json              ← Sheriff: batch tracking (= Gas Town convoys)
├── hooks/                   ← durable work assignments (= Gas Town hooks/beads)
│   ├── miner-api.json
│   ├── miner-test.json
│   └── smelter.json
└── gates/                   ← completion signals (= Gas Town gates)
    ├── miner-api-done
    ├── miner-test-done
    └── smelter-done
```

## Usage

### AI-Coordinated Mode (recommended)

```bash
# From the repo root:
agent-teams start examples/salttown/team.yaml \
  --ai-coordinator \
  --goal "Build a Salt Ledger REST API with Express: POST /deposits to record salt deposits with type and weight, GET /deposits to list all, GET /balance to show totals by type, with an in-memory store and full test coverage"
```

### Manual Mode

```bash
# Start the team (you act as Sheriff):
agent-teams start examples/salttown/team.yaml

# Initialize state directory:
mkdir -p .salttown/hooks .salttown/gates

# Assign work to miners:
agent-teams send miner-api "Build src/store.js and src/server.js — Express API with POST /deposits, GET /deposits, GET /balance. Work on branch salt/miner-api."
agent-teams send miner-test "Wait for .salttown/gates/miner-api-done, then write tests/api.test.js on branch salt/miner-test."

# Monitor:
agent-teams logs
ls .salttown/gates/

# After miners complete, trigger the smelter:
agent-teams send smelter "Merge salt/miner-api then salt/miner-test to main, run tests, review quality."

# When done:
agent-teams stop
```

### Watch the Action

```bash
# In separate terminals:
agent-teams terminal miner-api     # watch the API miner work
agent-teams terminal miner-test    # watch the test miner work
agent-teams terminal smelter       # watch the merge queue
agent-teams terminal lookout       # watch health patrol
agent-teams terminal prospector    # watch system patrol
agent-teams logs                   # see all broadcasts
cat .salttown/convoy.json          # check convoy state
ls .salttown/gates/                # check gate signals
```

## Architecture Comparison

| Aspect | Gas Town | Salt Town | Gap |
|--------|----------|-----------|-----|
| **Routing** | Deterministic (SLING→HOOK→GUPP) | Deterministic routing table in Sheriff prompt | Sheriff is still an LLM — routing is "strongly guided" not truly mechanical |
| **Branches** | Feature branches per Polecat | Feature branches per Miner | Equivalent |
| **Merge queue** | Refinery merges sequentially | Smelter merges sequentially | Equivalent |
| **State** | Beads in Dolt (git-versioned DB) | JSON files in `.salttown/` | Simpler but same concept — hook files + gate files |
| **Crash recovery** | Full replay from Dolt + hooks | Hook files + git branches persist | Less robust — no replay of LLM actions, but state survives |
| **Watchdog** | Daemon → Boot → Deacon → Witness (4-tier) | Prospector → Lookout (2-tier) | Missing bottom 2 tiers (no Go daemon, no Boot) |
| **Gates** | gh:run, gh:pr, timer, human, mail | File-based gates only | No external event gates (CI, PR, timer) |
| **Multi-rig** | Multiple projects, cross-rig routing | Single project only | Framework limitation |
| **Convoys** | Bead groups with completion tracking | convoy.json batch file | Same concept, simpler implementation |
| **Scale** | 20-30 agents | 6 agents (1 coord + 5 workers) | Can add more miners in config |
| **Config** | city.toml + packs | team.yaml | Different format, same idea |

## Remaining Gaps (Framework Limitations)

These require changes to the agent-teams framework itself, not just prompts:

1. **True deterministic routing** — The Sheriff's routing table is in its prompt, but it's still an LLM interpreting it. Gas Town's SLING is actual code.
2. **External gates** — Gas Town can wait for GitHub Actions, PR merges, timers. We only have file-based gates.
3. **Multi-rig** — Gas Town manages multiple repos. Agent-teams operates on one project.
4. **Process-level watchdog** — Gas Town's Daemon is a Go binary. We have no non-LLM monitor.
5. **Dolt backing** — Gas Town's full audit trail in a git-versioned database. We use plain JSON files.
