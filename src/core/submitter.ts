import { createHash } from "node:crypto";
import type { SubmitterIdentity } from "../types.js";

const NICKNAME_MIN_LEN = 2;
const NICKNAME_MAX_LEN = 40;
const EMAIL_MAX_LEN = 254;

export interface SubmitterProfile {
  nickname: string;
  email: string;
}

export function normalizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidNickname(value: string): boolean {
  const nickname = normalizeNickname(value);
  return nickname.length >= NICKNAME_MIN_LEN && nickname.length <= NICKNAME_MAX_LEN;
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (email.length === 0 || email.length > EMAIL_MAX_LEN) return false;
  // Simple pragmatic check for CLI collection.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function hashEmail(value: string): string {
  return createHash("sha256").update(normalizeEmail(value)).digest("hex");
}

export function toSubmitterProfile(value: { nickname: string; email: string }): SubmitterProfile {
  return {
    nickname: normalizeNickname(value.nickname),
    email: normalizeEmail(value.email),
  };
}

export function toSubmitterIdentity(profile: SubmitterProfile): SubmitterIdentity {
  return {
    nickname: profile.nickname,
    emailHash: hashEmail(profile.email),
  };
}
