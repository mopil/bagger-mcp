import { config as loadEnv } from "dotenv";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import input from "node:readline/promises";
import { stdin as inputStream, stdout as outputStream } from "node:process";
import { fileURLToPath } from "node:url";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

loadEnv();
const envFilePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");

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

    const savedSession = session.save();
    await upsertEnvValue("TELEGRAM_SESSION", savedSession);

    console.log("\nTELEGRAM_SESSION:");
    console.log(savedSession);
    console.log(`\nSaved TELEGRAM_SESSION to ${envFilePath}.`);
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

async function upsertEnvValue(key: string, value: string): Promise<void> {
  let envContent = "";

  try {
    envContent = await readFile(envFilePath, "utf8");
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

    if (errorCode !== "ENOENT") {
      throw error;
    }
  }

  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  const nextContent = pattern.test(envContent)
    ? envContent.replace(pattern, line)
    : appendEnvLine(envContent, line);

  await writeFile(envFilePath, nextContent, "utf8");
}

function appendEnvLine(content: string, line: string): string {
  if (content.length === 0) {
    return `${line}\n`;
  }

  return content.endsWith("\n") ? `${content}${line}\n` : `${content}\n${line}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
