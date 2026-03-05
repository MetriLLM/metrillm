import chalk from "chalk";
import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, saveConfig, type MetriLLMConfig } from "../core/store.js";
import {
  isValidEmail,
  isValidNickname,
  normalizeEmail,
  normalizeNickname,
  toSubmitterIdentity,
  toSubmitterProfile,
  type SubmitterProfile,
} from "../core/submitter.js";

export interface ShareSubmitter {
  nickname: string;
  email: string;
  emailHash: string;
}

interface SubmitterPromptDeps {
  askLine?: (prompt: string) => Promise<string | null>;
  loadUserConfig?: () => Promise<MetriLLMConfig>;
  saveUserConfig?: (config: MetriLLMConfig) => Promise<void>;
}

function canPromptInteractively(): boolean {
  return Boolean(input.isTTY && output.isTTY && input.readable && !input.readableEnded);
}

async function askLine(prompt: string): Promise<string | null> {
  if (!input.readable || input.readableEnded) {
    return null;
  }

  const previousRawMode = input.isTTY ? input.isRaw : false;
  if (input.isTTY && previousRawMode) {
    input.setRawMode(false);
  }

  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      input.off("end", onEnd);
      rl.off("close", onClose);
      try {
        rl.close();
      } catch {
        // Ignore close failures.
      }
      if (input.isTTY && previousRawMode) {
        input.setRawMode(true);
      }
      resolve(value);
    };

    const onEnd = () => finish(null);
    const onClose = () => finish(null);

    input.once("end", onEnd);
    rl.once("close", onClose);

    rl.question(prompt, (answer) => {
      finish(answer);
    });
  });
}

async function promptSubmitterProfile(
  deps: SubmitterPromptDeps,
  defaults: { nickname?: string; email?: string } = {}
): Promise<SubmitterProfile | null> {
  const ask = deps.askLine ?? askLine;

  let nicknameCandidate = defaults.nickname ?? "";
  while (true) {
    const nicknameHint = defaults.nickname ? ` [${defaults.nickname}]` : "";
    const nicknameAnswer = await ask(`Nickname${nicknameHint} > `);
    if (nicknameAnswer === null) return null;

    nicknameCandidate = nicknameAnswer.trim().length > 0
      ? nicknameAnswer
      : (defaults.nickname ?? "");

    if (isValidNickname(nicknameCandidate)) {
      break;
    }
    console.log(chalk.yellow("Nickname must be between 2 and 40 characters."));
  }

  while (true) {
    const emailHint = defaults.email ? ` [${defaults.email}]` : "";
    console.log(chalk.dim("Your email is never stored — only a SHA-256 hash is saved to match your leaderboard entries."));
    const emailAnswer = await ask(`Email${emailHint} > `);
    if (emailAnswer === null) return null;

    const emailCandidate = emailAnswer.trim().length > 0
      ? emailAnswer
      : (defaults.email ?? "");

    if (!isValidEmail(emailCandidate)) {
      console.log(chalk.yellow("Please enter a valid email address."));
      continue;
    }

    return toSubmitterProfile({
      nickname: normalizeNickname(nicknameCandidate),
      email: normalizeEmail(emailCandidate),
    });
  }
}

export async function resolveSubmitterForShare(
  deps: SubmitterPromptDeps = {}
): Promise<ShareSubmitter | null> {
  const loadUserConfig = deps.loadUserConfig ?? loadConfig;
  const saveUserConfig = deps.saveUserConfig ?? saveConfig;
  const ask = deps.askLine ?? askLine;

  const config = await loadUserConfig();

  if (isValidNickname(config.submitterNickname ?? "") && isValidEmail(config.submitterEmail ?? "")) {
    const profile = toSubmitterProfile({
      nickname: config.submitterNickname!,
      email: config.submitterEmail!,
    });
    const identity = toSubmitterIdentity(profile);
    return { ...profile, emailHash: identity.emailHash };
  }

  if (!canPromptInteractively() && !deps.askLine) {
    return null;
  }

  console.log("");
  console.log(chalk.bold.cyan("Link Your Benchmark History (optional)"));
  console.log(chalk.dim("Add a nickname and email to find your future benchmark dashboard."));
  console.log(chalk.dim("Email stays private; only a hash is attached to the public benchmark record."));

  const consent = (await ask("Add nickname + email now? [Y/n] > "))?.trim().toLowerCase();
  if (consent === "n" || consent === "no") {
    return null;
  }

  const profile = await promptSubmitterProfile(deps, {
    nickname: config.submitterNickname,
    email: config.submitterEmail,
  });

  if (!profile) {
    return null;
  }

  await saveUserConfig({
    ...config,
    submitterNickname: profile.nickname,
    submitterEmail: profile.email,
  });

  const identity = toSubmitterIdentity(profile);
  return { ...profile, emailHash: identity.emailHash };
}

export async function promptAndSaveSubmitterProfile(
  deps: SubmitterPromptDeps = {}
): Promise<SubmitterProfile | null> {
  const loadUserConfig = deps.loadUserConfig ?? loadConfig;
  const saveUserConfig = deps.saveUserConfig ?? saveConfig;

  if (!canPromptInteractively() && !deps.askLine) {
    return null;
  }

  const config = await loadUserConfig();
  const profile = await promptSubmitterProfile(deps, {
    nickname: config.submitterNickname,
    email: config.submitterEmail,
  });

  if (!profile) {
    return null;
  }

  await saveUserConfig({
    ...config,
    submitterNickname: profile.nickname,
    submitterEmail: profile.email,
  });

  return profile;
}
