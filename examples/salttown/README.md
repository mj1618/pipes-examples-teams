# Salt Town

A **Gas City-inspired** multi-agent topology built on [agent-teams](../../README.md).

Salt Town replicates the core architecture of Steve Yegge's [Gas Town](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04) / [Gas City](https://steve-yegge.medium.com/welcome-to-gas-city-57f564bb3607) using ppz messaging and the agent-teams framework, proving you can build the same coordination patterns with a lightweight config-driven approach.

## Topology

```
                        ┌─────────────┐
                        │  Mine Owner │   (you)
                        └──────┬──────┘
                               │
                        ┌──────▼──────┐
                        │   Sheriff   │   coordinator
                        │  (= Mayor)  │   dispatches, monitors, escalates
                        └──┬───┬───┬──┘
               ┌───────────┘   │   └────────────┐
          ┌────▼────┐    ┌─────▼─────┐    ┌─────▼─────┐
          │ Miners  │    │  Smelter  │    │  Lookout  │
          │(=Poles) │    │(=Refinery)│    │(=Witness) │
          ├─────────┤    ├───────────┤    ├───────────┤
          │miner-api│    │ reviews   │    │ monitors  │
          │miner-tst│    │ tests     │    │ health    │
          │ (swarm) │    │ merges    │    │ patrols   │
          └─────────┘    └───────────┘    └───────────┘
            workers         worker           worker
```

## Role Mapping

| Gas Town | Salt Town | Description |
|----------|-----------|-------------|
| **Mayor** | **Sheriff** | Primary coordinator. Receives goals, breaks them into tasks, dispatches to miners, monitors progress, handles escalations. |
| **Polecats** | **Miners** | Ephemeral swarm workers. Execute coding tasks in parallel, report completion. `miner-api` builds features, `miner-test` writes tests. |
| **Refinery** | **Smelter** | Integration/QA agent. Reviews all miner output, runs tests, fixes integration issues, approves work. The quality gate. |
| **Witness** | **Lookout** | Health patrol. Monitors miner terminal output for signs of life, detects stuck agents, reports to Sheriff. Runs on `haiku` for efficiency. |
| **Deacon/Dogs** | *(folded into Sheriff)* | In Gas Town these handle infrastructure maintenance. In Salt Town, the Sheriff handles escalation directly since ppz manages the infrastructure. |
| **Crew** | *(not used)* | Gas Town's persistent named agents for design work. Could be added as additional workers with custom prompts. |

## Key Concepts Replicated

### GUPP (Gas Town Universal Propulsion Principle)
> "If there is work on your hook, YOU MUST RUN IT."

Every Salt Town worker checks its inbox immediately on startup. If work is there, it executes without hesitation. This mirrors Gas Town's pull-based model where agents autonomously check hooks and execute.

### Swarming
Miners work in parallel (like Polecats), each assigned to a non-overlapping part of the codebase. The Sheriff coordinates which miner handles which files to prevent collisions.

### Merge Queue
The Smelter processes work sequentially, just like Gas Town's Refinery. It reviews miner output, runs the test suite, fixes minor integration issues, and reports the final status.

### Health Patrol
The Lookout runs periodic patrol cycles reading miner terminal output, just like Gas Town's Witness monitors Polecat health and detects stuck agents.

### Escalation Hierarchy
```
Lookout detects stuck miner
    → reports to Sheriff
        → Sheriff nudges miner or reassigns work
            → if unresolvable, user (Mine Owner) intervenes
```

## Usage

### AI-Coordinated Mode (recommended)

```bash
# From the repo root:
agent-teams start examples/salttown/team.yaml \
  --ai-coordinator \
  --goal "Build a Salt Ledger REST API with Express: POST /deposits to record salt deposits, GET /deposits to list all, GET /balance to show totals by type, with an in-memory store and full test coverage"
```

### Manual Mode

```bash
# Start the team (you act as Sheriff):
agent-teams start examples/salttown/team.yaml

# Assign work to miners:
agent-teams send miner-api "Build src/store.js (in-memory deposit store) and src/server.js (Express API with POST /deposits, GET /deposits, GET /balance)"
agent-teams send miner-test "Wait for miner-api to finish, then write tests/api.test.js covering all endpoints"

# Monitor progress:
agent-teams logs
agent-teams status

# After miners complete, trigger the smelter:
agent-teams send smelter "Review all code in src/ and tests/, run the test suite, fix any integration issues"

# When done:
agent-teams stop
```

### Watch the Action

```bash
# In separate terminals:
agent-teams terminal miner-api     # watch the API miner work
agent-teams terminal miner-test    # watch the test miner work
agent-teams terminal smelter       # watch the smelter review
agent-teams terminal lookout       # watch the health patrol
agent-teams logs                   # see all broadcasts
```

## Example Output

When run against the Salt Ledger goal, the team produces:

```
src/
  store.js       ← miner-api: in-memory deposit store (Map-based)
  server.js      ← miner-api: Express app with 3 endpoints
tests/
  api.test.js    ← miner-test: comprehensive test suite
```

## Customization

### Add More Miners
Add additional `miner-*` entries to `workers` in `team.yaml` to parallelize more:

```yaml
- handle: "miner-docs"
  model: "haiku"
  workingDir: "."
  systemPrompt: |
    You write API documentation. Read the source code and produce
    a clear API reference in docs/api.md.
```

### Add a Prospector (Deacon equivalent)
For larger projects, add a maintenance agent:

```yaml
- handle: "prospector"
  model: "haiku"
  workingDir: "."
  systemPrompt: |
    You are the Prospector (like Gas Town's Deacon). Run periodic
    maintenance: lint the codebase, check for unused imports,
    verify package.json dependencies, clean up temp files.
```

### Scale the Swarm
Gas Town runs 20-30 agents. You can scale Salt Town similarly by adding more miners with specific file/module assignments to prevent collisions.

## Architecture Comparison

| Aspect | Gas Town | Salt Town |
|--------|----------|-----------|
| **Communication** | Beads (Git-backed), Mail, Hooks | ppz pipes (inbox, broadcast) |
| **State persistence** | Dolt database, Git hooks | `.agent-teams-session.json` |
| **Process model** | tmux sessions, GUPP hooks | ppz terminal share, Claude `-p` mode |
| **Work tracking** | Beads with prefix routing | ppz message types (task.assign, task.status) |
| **Merge strategy** | Refinery + feature branches | Smelter reviews in working dir |
| **Health monitoring** | Witness + Deacon + Boot chain | Lookout reads terminal output |
| **Configuration** | `city.toml` + packs | `team.yaml` |
| **Scalability** | 20-30 agents, multi-rig | Limited by ppz capacity |
