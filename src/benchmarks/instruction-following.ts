import { abortOngoingRequests, generate } from "../core/runtime.js";
import type { CategoryResult, QuestionResult } from "../types.js";
import { stripThinkTags, toBenchmarkFailureLabel, withTimeout } from "../utils.js";
import { createSpinner } from "../ui/progress.js";
import ifData from "../datasets/instruction-following.json" with { type: "json" };

export interface IFQuestion {
  id: number;
  category: string;
  prompt: string;
  validation: string;
  params: Record<string, unknown>;
}

const questions = ifData as IFQuestion[];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsStandaloneToken(text: string, token: string): boolean {
  const source = escapeRegex(token.toLowerCase());
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${source}(?:$|[^\\p{L}\\p{N}_])`, "u");
  return re.test(text);
}

function normalizeExpectedValue(value: string): string {
  return value
    .trim()
    .replace(/^[\s"'`“”‘’()[\]{}]+|[\s"'`“”‘’()[\]{}]+$/g, "")
    .replace(/[.,;:!?]+$/g, "")
    .toLowerCase();
}

export function validateInstructionFollowingResponse(response: string, q: IFQuestion): boolean {
  const text = response.trim();
  const p = q.params;

  switch (q.validation) {
    case "numberedList": {
      const count = p.expectedCount as number;
      const matches = text.match(/^\d+[.)]\s/gm);
      return matches !== null && matches.length === count;
    }

    case "sentenceCount": {
      const count = p.expectedCount as number;
      // Count sentence-ending punctuation
      const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
      return sentences.length === count;
    }

    case "commaSeparated": {
      const count = p.expectedCount as number;
      const items = text.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      return items.length === count;
    }

    case "wordCount": {
      const count = p.expectedCount as number;
      const words = text.split(/\s+/).filter((w) => w.length > 0);
      return words.length === count;
    }

    case "paragraphCount": {
      const count = p.expectedCount as number;
      const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
      return paragraphs.length === count;
    }

    case "forbiddenWords": {
      const forbidden = p.forbidden as string[];
      const lower = text.toLowerCase();
      return forbidden.every((w) => !containsStandaloneToken(lower, w));
    }

    case "forbiddenLetters": {
      const forbidden = p.forbidden as string[];
      const lower = text.toLowerCase();
      return forbidden.every((letter) => !lower.includes(letter.toLowerCase()));
    }

    case "forbiddenPattern": {
      const pattern = new RegExp(p.pattern as string);
      return !pattern.test(text);
    }

    case "prosConsStructure": {
      const prosCount = p.prosCount as number | undefined;
      const consCount = p.consCount as number | undefined;

      const prosMatch = text.match(/(?:^|\n)\s*Pros\s*:\s*([\s\S]*?)(?=(?:\n\s*Cons\s*:)|$)/i);
      const consMatch = text.match(/(?:^|\n)\s*Cons\s*:\s*([\s\S]*)$/i);
      if (!prosMatch || !consMatch) return false;
      if ((prosMatch.index ?? 0) >= (consMatch.index ?? Number.MAX_SAFE_INTEGER)) return false;

      const countItems = (block: string): number => {
        const lines = block
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        const bulletLines = lines.filter((l) => /^([-*]|\d+[.)])\s+/.test(l));
        if (bulletLines.length > 0) return bulletLines.length;
        return lines.length;
      };

      const prosItems = countItems(prosMatch[1] ?? "");
      const consItems = countItems(consMatch[1] ?? "");

      if (prosCount !== undefined && prosItems !== prosCount) return false;
      if (consCount !== undefined && consItems !== consCount) return false;
      return prosItems > 0 && consItems > 0;
    }

    case "startEnd": {
      const start = (p.start as string).toLowerCase();
      const end = (p.end as string).toLowerCase();
      const lower = text.toLowerCase();
      return lower.startsWith(start) && lower.endsWith(end);
    }

    case "allQuestions": {
      const sentences = text.split(/[.!?]\s*/).filter((s) => s.trim().length > 0);
      if (sentences.length === 0) return false;
      // At least 80% should end with ? or be in the form of questions
      const questionCount = (text.match(/\?/g) ?? []).length;
      return questionCount >= sentences.length * 0.8;
    }

    case "answerFormat": {
      const expected = p.expectedValue as string;
      const match = text.match(/^\s*ANSWER:\s*(.+)\s*$/im);
      if (!match) return false;
      return normalizeExpectedValue(match[1]) === normalizeExpectedValue(expected);
    }

    case "dashList": {
      const count = p.expectedCount as number;
      const dashes = text.match(/^-\s/gm);
      return dashes !== null && dashes.length === count;
    }

    case "fruitStartLength": {
      const startLetter = (p.startLetter as string).toLowerCase();
      const minLength = p.minLength as number;
      // Extract the first word or main answer
      const words = text.split(/[\s,.:;!?]+/).filter((w) => /^[a-zA-Z]+$/.test(w));
      return words.some(
        (w) => w.toLowerCase().startsWith(startLetter) && w.length >= minLength
      );
    }

    case "wordLength": {
      const expected = p.expectedLength as number;
      const words = text.split(/\s+/).filter((w) => /^[a-zA-Z]+$/.test(w));
      return words.some((w) => w.length === expected);
    }

    case "listCount": {
      const count = p.expectedCount as number;
      // Count items: numbered, dashed, or comma-separated
      const numbered = text.match(/^\d+[.)]\s/gm);
      const dashed = text.match(/^-\s/gm);
      const commaItems = text.split(",").filter((s) => s.trim().length > 0);
      if (numbered && numbered.length === count) return true;
      if (dashed && dashed.length === count) return true;
      if (commaItems.length === count) return true;
      // Also check line-based items
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      return lines.length === count;
    }

    case "planetOrder": {
      const lower = text.toLowerCase();
      const jupiterIdx = lower.indexOf("jupiter");
      const saturnIdx = lower.indexOf("saturn");
      // Accept either Uranus or Neptune as 3rd
      const uranusIdx = lower.indexOf("uranus");
      const neptuneIdx = lower.indexOf("neptune");
      if (jupiterIdx === -1 || saturnIdx === -1) return false;
      if (jupiterIdx >= saturnIdx) return false;
      const thirdIdx = uranusIdx !== -1 ? uranusIdx : neptuneIdx;
      if (thirdIdx === -1) return false;
      return saturnIdx < thirdIdx;
    }

    default:
      return false;
  }
}

export async function runInstructionFollowingBench(model: string): Promise<CategoryResult> {
  const spinner = createSpinner("Running instruction following benchmark...");
  spinner.start();

  const details: QuestionResult[] = [];
  let correct = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    spinner.text = `Instruction Following ${i + 1}/${questions.length}: ${q.category}`;

    const prompt = q.prompt;

    const startTime = Date.now();
    try {
      const result = await withTimeout(
        generate(model, prompt, { temperature: 0, num_predict: 1024 }),
        60_000,
        "Instruction following task",
        abortOngoingRequests
      );

      const answer = stripThinkTags(result.response);
      const isCorrect = validateInstructionFollowingResponse(answer, q);
      if (isCorrect) correct++;

      details.push({
        id: q.id,
        question: q.prompt,
        expected: q.validation,
        actual: answer.slice(0, 200),
        correct: isCorrect,
        timeMs: Date.now() - startTime,
      });
    } catch (err) {
      details.push({
        id: q.id,
        question: q.prompt,
        expected: q.validation,
        actual: toBenchmarkFailureLabel(err),
        correct: false,
        timeMs: Date.now() - startTime,
      });
    }
  }

  spinner.succeed(`Instruction Following: ${correct}/${questions.length} correct`);

  return {
    score: questions.length > 0 ? (correct / questions.length) * 100 : 0,
    correct,
    total: questions.length,
    details,
  };
}
