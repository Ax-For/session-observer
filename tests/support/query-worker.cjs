process.on("message", (message) => {
  if (message.operation === "wait") return;
  if (message.operation === "fail") return process.send({ id: message.id, error: "fixture failure" });
  process.send({ id: message.id, result: message.args, memory: process.memoryUsage() });
});
process.on("disconnect", () => process.exit(0));
