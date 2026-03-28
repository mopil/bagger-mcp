import { getConfig } from "./config.js";
import { createApp } from "./http/app.js";

const config = getConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`MCP server listening on port ${config.port}`);
});

server.on("error", (error) => {
  console.error("Server failed to start", error);
  process.exitCode = 1;
});
