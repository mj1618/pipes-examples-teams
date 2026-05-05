# PPZ Improvements

Feedback from building `agent-teams` — a multi-agent coordination tool on top of ppz.

---

## ~~1. Source lifecycle: no way to reuse or destroy sources~~ ✅ RESOLVED in v0.21.0

**Status:** `ppz source destroy` was added in v0.21.0 with glob pattern support (e.g. `ppz source destroy "my-team-*"`). Auto-provisioned pipes (broadcast, inbox) can also be destroyed by name since v0.22.1.

**Original problem:** `ppz terminal share <handle>` creates a source, but if that handle was ever used before (even in a previous session that exited cleanly), you get `E_SOURCE_TAKEN`. There's no `ppz source destroy` or `ppz source release` command.

**What we changed:** `stopTeam()` now destroys all worker and coordinator sources on cleanup. Tests properly clean up after themselves. The `stop --clean <pattern>` command allows manual glob-based cleanup of orphaned sources.

---

## 2. `ppz terminal share` and `ppz source create` are mutually exclusive

**Problem:** If you `ppz source create foo` then try `ppz terminal share foo`, it fails with `E_SOURCE_TAKEN`. They both try to create the source. There's no way to attach a terminal share to an already-created source.

**Impact:** You can't pre-create a source (to send messages to its inbox before the agent starts), then later bind a terminal share to it. The agent must already be running to receive messages, creating a race condition.

**Suggestion:**
- Allow `ppz terminal share` to attach to an existing source (maybe `ppz terminal share foo --attach`)
- Or separate source creation from terminal binding entirely: `ppz source create foo && ppz terminal bind foo -- cmd`

---

## 3. No way to list only sources (without pipe details)

**Problem:** `ppz ls` returns all pipes across all sources. With many sources (we had 20+ from test runs), the output becomes unwieldy. There's no `ppz source list` or `ppz ls --sources-only`.

**Impact:** Programmatic parsing of `ppz ls` becomes fragile as the org accumulates sources. Finding "my team's sources" requires client-side filtering.

**Suggestion:**
- Add `ppz source list` — just the source handles
- Add `ppz ls --filter <pattern>` or make the existing pattern matching work without `--watch`
- Add `ppz ls --json` for machine-readable output

---

## 4. `ppz ls` has no `--json` output mode

**Problem:** The `ppz ls` output is a formatted table. Parsing it programmatically requires splitting on whitespace columns, which is fragile (especially with variable-width fields and truncated payloads).

**Impact:** Our `PpzClient.ls()` implementation is brittle — it splits on `\s{2,}` and hopes for the best.

**Suggestion:** Add `ppz ls --json` that outputs structured JSON (array of `{ handle, pipe, unread, buffered, last_at, last_payload }`).

---

## 5. No message acknowledgement / delivery confirmation

**Problem:** `ppz send` returns successfully as soon as the daemon accepts the message, but there's no confirmation the target source exists or that the message was actually buffered on the server.

**Impact:** If you `ppz send nonexistent-handle "msg"`, it appears to succeed silently. In our coordinator, we had no way to know if a task was actually delivered to a worker.

**Suggestion:**
- Return an error (or warning) if the target source doesn't exist
- Or add `ppz send --confirm` that waits for server-side buffering confirmation
- Or return delivery metadata in the response (`{ id, buffered: true, target_exists: true }`)

---

## 6. `ppz read` cursor is per-session, but "session" is unclear

**Problem:** `ppz read` advances a cursor so you only get new messages. But it's unclear what defines a "session" — is it per-process? Per-source-switch? Per daemon restart? We found that messages read in one test were invisible to subsequent reads, which is correct, but the cursor scope is undocumented.

**Impact:** Hard to reason about in multi-consumer scenarios. If two agents both want to read the same pipe, they'd need separate cursors (or use `ppz reread`).

**Suggestion:**
- Document cursor semantics clearly (scoped to what? resettable how?)
- Add `ppz read --cursor <name>` for named cursors (multiple consumers)
- Add `ppz read --reset` to reset the cursor to the beginning

---

## 7. No structured message envelope at the transport level

**Problem:** ppz wraps payloads in `{ id, handle, payload (string), created_at }` but the payload is just an opaque string. There's no built-in sender identification, message type, or correlation ID.

**Impact:** Every application must define its own envelope format. Our agents had to JSON-encode everything, and the receiver had to `JSON.parse(envelope.payload)` to unwrap. Sender identity is particularly important — you can't tell who sent a message without encoding it in the payload.

**Suggestion:**
- Add optional sender metadata: `ppz send --from <handle> target payload` → stored as `{ ..., from: "handle" }`
- Or add header support: `ppz send --header "type=task.assign" target payload`
- Even just `from` would be enormously useful for multi-agent scenarios

---

## 8. `ppz terminal read` returns empty when the process is still initializing

**Problem:** Immediately after `ppz terminal share` starts a process, `ppz terminal read` returns nothing — even though `ppz ls` shows the `.stdout` pipe exists. You have to wait (we used a 2-second sleep) for output to appear.

**Impact:** Race condition in orchestration: you can't reliably poll terminal output right after spawning. No way to know when the process has actually started producing output.

**Suggestion:**
- `ppz terminal read --wait` that blocks until at least one frame is available
- Or a `ppz terminal status <handle>` that reports whether the PTY is active and has produced output
- Or emit a synthetic "session started" message on `.stdout` when the PTY connects

---

## 9. No way to send structured data to stdin (only raw text)

**Problem:** `ppz send <handle>.stdin "text"` sends raw text to the process's stdin. This works for simple cases, but for interactive CLIs (like Claude Code), you can't distinguish between "new prompt" and "raw keystrokes". There's no framing.

**Impact:** Sending a multi-line prompt to an interactive Claude session via stdin is unreliable. Special characters, newlines, and escape sequences can get mangled.

**Suggestion:**
- This might be inherent to PTY semantics and not fixable at the ppz level
- But a `ppz terminal send <handle> --line "text\n"` that ensures proper line termination would help
- Or a higher-level `ppz terminal prompt <handle> "text"` that waits for the current command to finish before sending

---

## 10. Broadcast and inbox are the only built-in pipes

**Problem:** Every source gets `.broadcast` and `.inbox` automatically. Custom pipes (`ppz pipe create`) exist but feel second-class — they require explicit creation and there's no convention for them.

**Impact:** For team coordination, we'd benefit from well-known pipe conventions: `.status`, `.tasks`, `.errors`. Currently everything goes through `.inbox` or `.broadcast` which conflates different message types.

**Suggestion:**
- Document recommended pipe conventions for multi-agent patterns
- Or allow source templates: `ppz source create foo --pipes "inbox,broadcast,status,tasks"`
- Or just make the built-in set configurable

---

## 11. No message filtering on `ppz read`

**Problem:** `ppz read target` returns ALL messages since the cursor. You can't filter server-side by content, sender, or message type.

**Impact:** A busy inbox requires client-side filtering. If a coordinator is receiving both status updates and chat messages on its inbox, it must read everything and discard what it doesn't need.

**Suggestion:**
- `ppz read target --jq '.type == "task.status"'` for payload-level filtering
- Or `ppz read target --from <handle>` to filter by sender (if sender metadata is added per #7)

---

## 12. `ppz reread` flag `-l` should be `--limit` for clarity

**Minor:** The short flag `-l N` works but there's no long-form `--limit`. Consistent long-form flags help with discoverability and readability in scripts.

---

## 13. Error messages could include suggestions

**Minor:** `E_SOURCE_TAKEN: source 'dev-api' already exists in this org` is clear about the problem but doesn't suggest a fix. Something like "...already exists. Use `ppz source switch dev-api` to select it, or choose a different handle" would help new users.

---

## Summary: Priority ranking

| Priority | Issue | Impact | Status |
|----------|-------|--------|--------|
| ~~🔴 High~~ | ~~#1 — No source destroy/reuse~~ | ~~Blocks clean multi-run workflows~~ | ✅ Resolved in v0.21.0 |
| 🔴 High | #2 — terminal share vs source create conflict | Blocks pre-provisioning patterns | Open |
| 🟠 Medium | #7 — No sender metadata | Every app reinvents envelope format | Open |
| 🟠 Medium | #4 — No `--json` on `ppz ls` | Fragile programmatic integration | Open |
| 🟠 Medium | #5 — Silent send to non-existent target | Hard to debug delivery failures | Open |
| 🟡 Low | #3 — No source-only listing | Quality of life | Open |
| 🟡 Low | #6 — Cursor semantics unclear | Documentation gap | Open |
| 🟡 Low | #8 — Terminal read race condition | Workaround exists (sleep) | Open |
| 🟡 Low | #9 — No structured stdin | Inherent PTY limitation | Open |
| 🟡 Low | #10–13 — Conventions & polish | Nice-to-haves | Open |
