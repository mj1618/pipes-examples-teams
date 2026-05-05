/**
 * End-to-end test: simulate a full team coordination flow via ppz
 * without actually spawning Claude agents.
 */
import { sendTask, sendChat } from "../src/core/coordinator.js";
import { ppz } from "../src/ppz/client.js";

async function main() {
  console.log("=== E2E Messaging Test ===\n");

  // 1. Send a task to dev-1
  console.log("1. Sending task to dev-1...");
  const taskId = await sendTask("dev-1", "Create a hello world Express server", "my-project-lead", {
    context: "Use TypeScript, port 3000",
    priority: "high",
  });
  console.log(`   ✓ Task sent (id: ${taskId})`);

  // 2. Send a chat to dev-2
  console.log("2. Sending chat to dev-2...");
  await sendChat("dev-2", "Please review dev-1's code when ready", "my-project-lead");
  console.log("   ✓ Chat sent");

  // 3. Read dev-1's inbox
  console.log("\n3. Reading dev-1 inbox...");
  const msgs1 = await ppz.readMessages("dev-1.inbox");
  console.log(`   Received ${msgs1.length} message(s):`);
  for (const msg of msgs1) {
    console.log(`   - [${msg.type}] ${msg.task?.description || msg.body || JSON.stringify(msg)}`);
  }

  // 4. Read dev-2's inbox
  console.log("\n4. Reading dev-2 inbox...");
  const msgs2 = await ppz.readMessages("dev-2.inbox");
  console.log(`   Received ${msgs2.length} message(s):`);
  for (const msg of msgs2) {
    console.log(`   - [${msg.type}] ${msg.body || msg.task?.description || JSON.stringify(msg)}`);
  }

  // 5. Simulate worker response
  console.log("\n5. Simulating dev-1 completion response...");
  await ppz.send("my-project-lead", {
    type: "task.status",
    id: `resp-${Date.now()}`,
    from: "dev-1",
    timestamp: new Date().toISOString(),
    taskId,
    status: "completed",
    detail: "Express server created with TypeScript on port 3000",
  });
  console.log("   ✓ Status sent to coordinator");

  // 6. Read coordinator inbox
  console.log("\n6. Reading coordinator inbox...");
  const coordMsgs = await ppz.readMessages("my-project-lead.inbox");
  console.log(`   Received ${coordMsgs.length} message(s):`);
  for (const msg of coordMsgs) {
    console.log(`   - [${msg.type}] status=${msg.status || "n/a"} detail="${msg.detail || msg.body || ""}"`);
  }

  // 7. Broadcast from coordinator
  console.log("\n7. Broadcasting from coordinator...");
  await ppz.sourceSwitch("my-project-lead");
  await ppz.broadcast("All tasks completed successfully!");
  console.log("   ✓ Broadcast sent");

  // 8. Verify broadcast visible
  console.log("\n8. Verifying broadcast...");
  const broadcastOutput = await ppz.reread("my-project-lead.broadcast", { limit: 1, json: true });
  if (broadcastOutput.includes("All tasks completed")) {
    console.log("   ✓ Broadcast is visible via reread");
  } else {
    console.log("   ✗ Broadcast not found");
    console.log("     Got:", broadcastOutput);
  }

  console.log("\n=== All E2E checks passed! ===");
}

main().catch((err) => {
  console.error("E2E test failed:", err);
  process.exit(1);
});
