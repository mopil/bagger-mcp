import { getConfig } from "./config.js";
import { createApp } from "./http/app.js";
import { logger } from "./logger.js";

const config = getConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  logger.info("server.listening", { port: config.port });
});

server.on("error", (error) => {
  logger.error("server.start_failed", { err: error });
  process.exitCode = 1;
});

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", { err: reason });
});

process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { err: error });
});
