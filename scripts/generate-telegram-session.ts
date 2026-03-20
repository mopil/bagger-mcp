import { config as loadEnv } from "dotenv";
import { Buffer } from "node:buffer";
import input from "node:readline/promises";
import { stdin as inputStream, stdout as outputStream } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

loadEnv();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main(): Promise<void> {
  const apiIdRaw = requireEnv("TELEGRAM_API_ID");
  const apiHash = requireEnv("TELEGRAM_API_HASH");
  const apiId = Number(apiIdRaw);

  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID must be a positive integer");
  }

  const rl = input.createInterface({
    input: inputStream,
    output: outputStream,
  });

  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: async () => rl.question("Phone number: "),
      phoneCode: async () => rl.question("Login code: "),
      password: async () => promptHidden("2FA password (leave empty if none): "),
      onError: (error) => {
        throw error;
      },
    });

    console.log("\nTELEGRAM_SESSION:");
    console.log(session.save());
    console.log("\nStore this value in .env or Railway as TELEGRAM_SESSION.");
  } finally {
    rl.close();
    await client.disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed to generate session.");
  process.exitCode = 1;
});

async function promptHidden(question: string): Promise<string> {
  if (!inputStream.isTTY || !outputStream.isTTY) {
    throw new Error("Hidden password input requires a TTY.");
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";

    outputStream.write(question);
    inputStream.resume();
    inputStream.setRawMode(true);

    const cleanup = () => {
      inputStream.setRawMode(false);
      inputStream.pause();
      inputStream.removeListener("data", onData);
      outputStream.write("\n");
    };

    const onData = (chunk: Buffer) => {
      const key = chunk.toString("utf8");

      if (key === "\u0003") {
        cleanup();
        reject(new Error("Session generation cancelled."));
        return;
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(value);
        return;
      }

      if (key === "\u0008" || key === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      value += key;
    };

    inputStream.on("data", onData);
  });
}
