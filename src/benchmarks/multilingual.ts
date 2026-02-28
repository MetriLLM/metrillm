import { abortOngoingRequests, generate } from "../core/ollama-client.js";
import type { CategoryResult, QuestionResult } from "../types.js";
import { extractNumber, stripThinkTags, toBenchmarkFailureLabel, withTimeout } from "../utils.js";
import { createSpinner } from "../ui/progress.js";
import mlData from "../datasets/multilingual.json" with { type: "json" };

interface MLQuestion {
  id: number;
  language: string;
  prompt: string;
  validation: string;
  acceptedAnswers?: string[];
  expectedNumber?: number;
  keywords?: string[];
}

const questions = mlData as MLQuestion[];

const NEGATION_PATTERNS: RegExp[] = [
  /\b(?:not|never|no|non|pas|nicht|kein|keine|ningun|ninguna|nunca|jamas)\b/u,
  /\bn'?est\s+pas\b/u,
  /(?:不是|并非|沒有|没有)/u,
  /(?:ではない|じゃない|ではありません)/u,
];

function normalizeForCompare(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function canonicalizeResponse(value: string): string {
  const firstLine = value.trim().split(/\r?\n/)[0] ?? "";
  return firstLine
    .replace(/^(?:answer|réponse|respuesta|antwort|回答|答え)\s*[:：-]\s*/i, "")
    .replace(/^[\s"'`“”‘’()[\]{}]+|[\s"'`“”‘’()[\]{}]+$/g, "")
    .replace(/[.,;:!?。！？、]+$/u, "")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsStandaloneMatch(text: string, target: string): boolean {
  if (text === target) return true;
  if (!target) return false;
  // CJK answers often have no word boundaries; use direct containment there.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(target)) {
    return text.includes(target);
  }
  const re = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegex(target)}(?:$|[^\\p{L}\\p{N}])`,
    "u"
  );
  return re.test(text);
}

function hasNegation(text: string): boolean {
  return NEGATION_PATTERNS.some((re) => re.test(text));
}

export function validateMultilingualResponse(response: string, q: MLQuestion): boolean {
  const canonical = canonicalizeResponse(response);
  const normalized = normalizeForCompare(canonical);
  if (!normalized) return false;
  if (hasNegation(normalized)) return false;

  switch (q.validation) {
    case "stringMatch": {
      const answers = q.acceptedAnswers ?? [];
      return answers.some((a) =>
        containsStandaloneMatch(normalized, normalizeForCompare(a))
      );
    }

    case "numberMatch": {
      const expected = q.expectedNumber;
      if (expected === undefined) return false;
      const actual = extractNumber(canonical);
      return actual !== null && actual === expected;
    }

    case "containsKeyword": {
      const keywords = q.keywords ?? [];
      return keywords.some((k) =>
        containsStandaloneMatch(normalized, normalizeForCompare(k))
      );
    }

    default:
      return false;
  }
}

export async function runMultilingualBench(model: string): Promise<CategoryResult> {
  const spinner = createSpinner("Running multilingual benchmark...");
  spinner.start();

  const details: QuestionResult[] = [];
  let correct = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    spinner.text = `Multilingual ${i + 1}/${questions.length}: ${q.language}`;

    const startTime = Date.now();
    try {
      const result = await withTimeout(
        generate(model, q.prompt, { temperature: 0, num_predict: 1024 }),
        60_000,
        "Multilingual task",
        abortOngoingRequests
      );

      const answer = stripThinkTags(result.response);
      const isCorrect = validateMultilingualResponse(answer, q);
      if (isCorrect) correct++;

      const expectedStr = q.expectedNumber !== undefined
        ? String(q.expectedNumber)
        : (q.acceptedAnswers ?? q.keywords ?? []).join("|");

      details.push({
        id: q.id,
        question: q.prompt,
        expected: expectedStr,
        actual: answer.slice(0, 200),
        correct: isCorrect,
        timeMs: Date.now() - startTime,
      });
    } catch (err) {
      const expectedStr = q.expectedNumber !== undefined
        ? String(q.expectedNumber)
        : (q.acceptedAnswers ?? q.keywords ?? []).join("|");

      details.push({
        id: q.id,
        question: q.prompt,
        expected: expectedStr,
        actual: toBenchmarkFailureLabel(err),
        correct: false,
        timeMs: Date.now() - startTime,
      });
    }
  }

  spinner.succeed(`Multilingual: ${correct}/${questions.length} correct`);

  return {
    score: questions.length > 0 ? (correct / questions.length) * 100 : 0,
    correct,
    total: questions.length,
    details,
  };
}
