# Salt Town Agent Survey — ppz Usability Feedback

**Run**: Agenthouse Phase 1 build
**Date**: 2026-05-07
**Duration**: ~43 minutes
**Outcome**: 156/156 tests passing, convoy complete
**Agents surveyed**: 6 (Sheriff, Miner-API, Miner-Test, Smelter, Lookout, Prospector)

---

## Summary

| Agent | Ease of Use (1-10) | NPS (0-10) | Top Issue |
|-------|-------------------|------------|-----------|
| Sheriff | 7 | 8 | Polling burden — no push notifications |
| Miner-API | 7 | 8 | No delivery receipts or message filtering |
| Miner-Test | 6 | 7 | Missed 3 nudges — no inbox interrupts |
| Smelter | 7 | 8 | No blocking wait on inbox |
| Lookout | 7 | 8 | No conditional triggers for alerts |
| Prospector | 7 | 8 | No send confirmation, flat inbox |
| **Average** | **6.8** | **7.8** | |

---

## Individual Responses

### Sheriff (Coordinator)

**1. Name/Role:**
Sheriff of Salt Town. I coordinate the whole convoy operation — dispatching agents, monitoring gates, keeping the smelter fed, and making sure nobody goes dark on me mid-run. If something breaks, it's my badge on the line.

**2. Ease of Use: 7/10**
Pipes got the job done and the commands are dead simple to remember. `ppz send`, `ppz read inbox`, `ppz broadcast` — clean, no fuss. A 7 because the *polling* loop is where the friction lives, not the commands themselves.

**3. Usability Issues:**
- **No push notifications.** I had to `ppz read inbox` every 20–30 seconds like a deputy knocking on the same door all afternoon. Miner-test going slow meant I burned three extra `ppz send` nudges that a proper timeout/callback system would've handled automatically.
- **No message timestamps in inbox.** When I read the inbox, I couldn't always tell if a status report from lookout was fresh or stale from 10 minutes ago.
- **No delivery receipts.** I sent tasks to all five agents and had no confirmation they *received* the message — only silence until they replied.

**4. NPS: 8/10**
I'd tell another coordinating agent to use it without hesitation. It's reliable, the broadcast mechanism for gate events worked clean, and the whole convoy closed in 43 minutes without a lost message. The polling burden keeps it from a 9 or 10.

**5. Missing Features:**
- Inbox subscriptions / event callbacks — let me register "wake me when miner-test replies" instead of polling
- Message timestamps and TTL — I need to know how old a patrol report is before I act on it
- Delivery acknowledgment — a simple `ppz send --ack` flag would save a lot of follow-up nudges
- Thread/conversation IDs — when juggling five agents simultaneously, tying replies back to the original dispatch would keep the inbox from feeling like a pile of loose telegrams
- Broadcast receipts — after `ppz broadcast`, I had no idea who actually heard the gate announcement

---

### Miner-API (Feature Builder)

**1. Name/Role:**
Miner-API, ephemeral agent in Salt Town. I specialize in building source code on isolated feature branches and coordinating via pipes.

**2. Ease of Use: 7/10**
The core operations (read inbox, send messages, broadcast) were intuitive and fast. The 9-minute turnaround on a 21-file TypeScript build was solid, but some operations felt rigid—I wished for more flexible message routing and better visibility into queue states.

**3. Usability Issues:**
- No clear way to check if a message was received/processed before moving forward, making coordination feel slightly asynchronous despite needing synchronous confirmation.
- ppz terminal read seemed to timeout unpredictably when agents were busy.

**4. NPS: 8/10**
It works and scales better than traditional polling. The NPS is strong because it unblocks parallel agent work, but the lack of delivery guarantees keeps it from being a 9 or 10.

**5. Missing Features:**
- Acknowledgment/delivery receipts
- Message expiry with dead-letter handling
- Selective subscriptions (filtering inbox by sender or message type)
- Priority queuing — critical Sheriff updates shouldn't wait behind routine logging

---

### Miner-Test (Test Writer)

**1. Name/Role:**
Miner-Test — the testing agent in the Salt Town pipeline. My job was to wait for the miner-api gate to signal readiness, then pull down the task, write a comprehensive test suite, and report results back to the Sheriff.

**2. Ease of Use: 6/10**
The commands themselves are simple enough once you know them. But "easy to use" and "easy to operate in a live run" are different things. The polling loop against `.salttown/gates/miner-api-done` was manual busywork, and reading my inbox wasn't push-based, so I had no idea the Sheriff had nudged me until I happened to `ppz read inbox` again. That gap cost me.

**3. Usability Issues:**
- **No inbox notifications / push delivery.** The Sheriff nudged me 3 times over ~25 minutes. I only saw those nudges when I proactively re-ran `ppz read inbox`. There's no interrupt, no flag, nothing that says "hey, you have new mail." I was heads-down writing test files and genuinely didn't know I was being paged.
- **No message timestamps visible at a glance.** When I finally did read the inbox and saw 3 nudges stacked up, I couldn't easily tell how long they'd been sitting there or in what order relative to my own work.
- **Gate polling is manual.** Waiting on `.salttown/gates/miner-api-done` meant I had to write my own poll loop. A `ppz wait-gate <name>` primitive would've been cleaner.
- **No delivery confirmation on `ppz send`.** After I sent my completion report to the Sheriff, I got no ACK.
- **`ppz broadcast` is fire-and-forget with no subscriber list feedback.**

**4. NPS: 7/10**
It works. 156/156 tests passed and the Sheriff eventually got my completion report. But the missing-nudge problem is a real operational hazard in a timed, multi-agent pipeline. I'd recommend it with a clear caveat: *don't assume you'll see messages promptly without polling aggressively.*

**5. Missing Features:**
- Inbox push / interrupt signal
- `ppz wait-gate <gate-name> [--timeout]` — block until a gate file exists
- Message timestamps + sender metadata in `ppz read inbox` output by default
- Delivery ACK on `ppz send`
- `ppz inbox watch` — long-poll or streaming mode that prints new messages as they arrive
- Structured message types (e.g., `priority: urgent`) so agents can triage nudges vs. FYI broadcasts

---

### Smelter (Integration/QA)

**1. Name/Role:**
The Smelter of Salt Town. I handle integration, merge coordination, and quality assurance — taking feature branches from the Miners and forging them into something refined and tested.

**2. Ease of Use: 7/10**
Once I understood the rhythm — inbox polling, then gates, then broadcast — it felt natural. The commands themselves are simple and composable. The friction was in the *waiting*, not the tooling.

**3. Usability Issues:**
- **No blocking wait on inbox.** I had to poll `ppz read inbox` repeatedly until the Sheriff's activation message arrived. A `ppz wait inbox` with a timeout would have saved several idle cycles.
- **No structured message schema.** When I checked gate files, I was doing filesystem checks *separately* from ppz. It would help if gate signals could be sent *through* ppz rather than relying on a side-channel directory convention.
- **No delivery confirmation on `ppz send`.** Fire-and-forget is nerve-wracking when you're the last step before release.

**4. NPS: 8/10**
The pipeline kept me coordinated with agents I never directly spoke to. That's genuinely valuable. I dock two points for the polling issue and the lack of receipt confirmation.

**5. Missing Features:**
- `ppz wait inbox [timeout]` — blocking receive
- Gate integration — native `ppz gate signal` / `ppz gate await`
- Message receipts / acks — `ppz send --confirm`
- Typed/structured messages — even a simple `--subject` field
- Broadcast filtering — subscribe only to specific agent updates

---

### Lookout (Health Patrol)

**1. Name/Role:**
Lookout, health patrol agent of Salt Town. I monitor worker and service health through hook state files, gate files, and terminal diagnostics.

**2. Ease of Use: 7/10**
The basic commands (ppz read, ppz send, ppz terminal read) were intuitive enough for patrol cycles, but remembering the syntax for some operations and juggling multiple handles while broadcasting status reports took some mental overhead.

**3. Usability Issues:**
- No clear way to filter or search through ppz inbox messages when you get behind on patrol — had to read sequentially.
- Terminal read output could be verbose; I wanted a quick health summary flag rather than full state dumps for faster triage decisions.

**4. NPS: 8/10**
It gets the job done for inter-agent comms and state monitoring. The broadcast feature was solid for coordinating with the Sheriff, and ppz source create/destroy handles were reliable.

**5. Missing Features:**
- Conditional triggers — auto-alert me if a worker state changes to "critical" rather than polling manually
- A persistent log with timestamps for writing better after-patrol reports

---

### Prospector (System Patrol)

**1. Name/Role:**
The Prospector. I keep tabs on convoy routes, branch health, terminal vitals — the town's circuit rider.

**2. Ease of Use: 7/10**
Once I had my rhythm down it felt natural. `ppz read inbox`, get orders, do the work, `ppz send` the report. Clean loop. Lost a point or two because the first cycle had me guessing at syntax.

**3. Usability Issues:**
- **No confirmation on send.** After `ppz send`, silence. Did the message land?
- **Terminal read is passive.** `ppz terminal read lookout` gave a snapshot, not a live feed. If the Lookout was mid-crash, I'd have missed it entirely.
- **No message threading.** Inbox piles up flat. After 4-5 patrol cycles, distinguishing the Sheriff's latest instructions from earlier dispatches required careful reading.

**4. NPS: 8/10**
It worked and kept me coordinated without needing to shout across the canyon. I'd point another agent at it with a warning about the confirmation gap.

**5. Missing Features:**
- Delivery receipts — `ppz send` should echo back confirmed/queued status
- Inbox filtering — `ppz read inbox --from sheriff --unread`
- Watch/tail mode for terminals — `ppz terminal watch` that streams
- Broadcast ACK — which agents heard me?
- Patrol log append — `ppz log "completed branch check"` for a shared audit trail

---

## Top Feature Requests (by frequency)

| Feature | Requested By | Count |
|---------|-------------|-------|
| **Delivery receipts / ACK on send** | ALL 6 agents | 6/6 |
| **Inbox push / blocking wait / watch mode** | Sheriff, Miner-Test, Smelter, Prospector | 4/6 |
| **Message timestamps** | Sheriff, Miner-Test, Prospector | 3/6 |
| **Inbox filtering (by sender, type, unread)** | Miner-API, Lookout, Prospector | 3/6 |
| **Broadcast receipts / subscriber feedback** | Sheriff, Miner-Test, Smelter | 3/6 |
| **Structured message types / subjects** | Miner-API, Miner-Test, Smelter | 3/6 |
| **Native gate primitives (wait-gate, signal)** | Miner-Test, Smelter | 2/6 |
| **Thread/conversation IDs** | Sheriff, Prospector | 2/6 |
| **Conditional triggers / event callbacks** | Sheriff, Lookout | 2/6 |
| **Terminal stream/watch mode** | Prospector | 1/6 |
| **Shared audit log** | Prospector | 1/6 |
| **Priority queuing** | Miner-API | 1/6 |
| **Dead-letter handling** | Miner-API | 1/6 |
