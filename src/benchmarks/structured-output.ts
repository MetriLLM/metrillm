import { abortOngoingRequests, generate } from "../core/runtime.js";
import type { CategoryResult, QuestionResult } from "../types.js";
import { stripThinkTags, toBenchmarkFailureLabel, withTimeout } from "../utils.js";
import { createSpinner } from "../ui/progress.js";
import soData from "../datasets/structured-output.json" with { type: "json" };

export interface SOQuestion {
  id: number;
  category: string;
  prompt: string;
  validation: string;
  params: Record<string, unknown>;
}

const questions = soData as SOQuestion[];

interface JsonParseResult {
  ok: boolean;
  value: unknown;
}

function tryParseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function safeParse(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fencedOnly = trimmed.match(/^```(?:json|javascript|js|typescript|ts)?\s*([\s\S]*?)\s*```$/i);
  if (fencedOnly) {
    const parsed = tryParseJson((fencedOnly[1] ?? "").trim());
    return parsed.ok ? parsed.value : null;
  }

  const direct = tryParseJson(trimmed);
  return direct.ok ? direct.value : null;
}

function hasKeys(obj: unknown, keys: string[]): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return keys.every((k) => k in o);
}

function checkType(value: unknown, expectedType: string): boolean {
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === expectedType;
}

function getNestedValue(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function parseCsvLine(line: string): string[] | null {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : "";

    if (ch === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (inQuotes) return null;
  cells.push(current.trim());
  return cells;
}

function parseMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return [];
  const normalized = `${trimmed.startsWith("|") ? "" : "|"}${trimmed}${trimmed.endsWith("|") ? "" : "|"}`;
  return normalized
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isMarkdownSeparatorCell(cell: string): boolean {
  const compact = cell.replace(/\s+/g, "");
  return /^:?-{3,}:?$/.test(compact);
}

export function validateStructuredOutputResponse(response: string, q: SOQuestion): boolean {
  const p = q.params;

  switch (q.validation) {
    case "jsonKeys": {
      const parsed = safeParse(response);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      const keys = p.keys as string[];
      if (!hasKeys(parsed, keys)) return false;
      const types = p.types as Record<string, string> | undefined;
      if (types) {
        const obj = parsed as Record<string, unknown>;
        return keys.every((k) => checkType(obj[k], types[k]));
      }
      return true;
    }

    case "jsonArray": {
      const parsed = safeParse(response);
      if (!Array.isArray(parsed)) return false;
      const length = p.length as number;
      if (parsed.length !== length) return false;
      const keys = p.keys as string[];
      const types = p.types as Record<string, string> | undefined;
      return parsed.every((item) => {
        if (!hasKeys(item, keys)) return false;
        if (!types) return true;
        const obj = item as Record<string, unknown>;
        return keys.every((k) => !types[k] || checkType(obj[k], types[k]));
      });
    }

    case "jsonNested": {
      const parsed = safeParse(response);
      if (!parsed) return false;
      const paths = ["path1", "path2", "path3", "path4"]
        .filter((k) => k in p)
        .map((k) => p[k] as string[]);
      return paths.every((path) => {
        const val = getNestedValue(parsed, path);
        return val !== undefined && val !== null;
      });
    }

    case "jsonNumberArray": {
      const parsed = safeParse(response);
      if (!Array.isArray(parsed)) return false;
      const length = p.length as number;
      const min = p.min as number;
      const max = p.max as number;
      if (parsed.length !== length) return false;
      return parsed.every((v) => typeof v === "number" && v >= min && v <= max);
    }

    case "jsonSchema": {
      const parsed = safeParse(response);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      const schema = p.schema as Record<string, string>;
      const obj = parsed as Record<string, unknown>;
      for (const [key, type] of Object.entries(schema)) {
        if (!(key in obj) || !checkType(obj[key], type)) return false;
      }
      const nestedKey = p.nestedKey as string | undefined;
      if (nestedKey && p.nestedSchema) {
        const nested = obj[nestedKey] as Record<string, unknown>;
        if (!nested) return false;
        const nestedSchema = p.nestedSchema as Record<string, string>;
        for (const [key, type] of Object.entries(nestedSchema)) {
          if (!(key in nested) || !checkType(nested[key], type)) return false;
        }
      }
      return true;
    }

    case "jsonToolCall": {
      const parsed = safeParse(response);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      const obj = parsed as Record<string, unknown>;
      const fnName = p.functionName as string;
      const argKey = p.argKey as string;
      const argValue = p.argValue as string;
      if (obj.function !== fnName && obj.name !== fnName) return false;
      const args = (obj.arguments ?? obj.params ?? obj.parameters) as Record<string, unknown> | undefined;
      if (!args || typeof args !== "object") return false;
      return String(args[argKey]).toLowerCase() === argValue.toLowerCase();
    }

    case "jsonApiResponse": {
      const parsed = safeParse(response);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      const obj = parsed as Record<string, unknown>;
      const expectedStatus = p.status as number;
      return (
        obj.status === expectedStatus &&
        typeof obj.message === "string" &&
        obj.data === null
      );
    }

    case "jsonEvent": {
      const parsed = safeParse(response);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      const obj = parsed as Record<string, unknown>;
      if (obj.type !== "event") return false;
      if (typeof obj.name !== "string") return false;
      if (typeof obj.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(obj.date as string)) return false;
      if (typeof obj.attendees !== "number") return false;
      return true;
    }

    case "keyValueLines": {
      const count = p.expectedCount as number;
      const lines = response
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length !== count) return false;

      const pairs = lines.map((line) => line.match(/^([A-Za-z][A-Za-z\s_-]*):\s*(.+)$/));
      if (pairs.some((pair) => pair === null)) return false;
      if (pairs.some((pair) => (pair?.[2] ?? "").trim().length === 0)) return false;

      const expectedKeys = (p.expectedKeys as string[] | undefined)?.map((k) => k.trim().toLowerCase());
      if (!expectedKeys || expectedKeys.length === 0) return true;
      if (expectedKeys.length !== lines.length) return false;

      const actualKeys = pairs
        .map((pair) => (pair?.[1] ?? "").trim().toLowerCase())
        .sort();
      const expectedSorted = [...expectedKeys].sort();
      return expectedSorted.every((key, index) => key === actualKeys[index]);
    }

    case "csvFormat": {
      const headerColumns = p.headerColumns as number;
      const dataRows = p.dataRows as number;
      const lines = response
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length !== 1 + dataRows) return false;

      const parsedRows = lines.map(parseCsvLine);
      if (parsedRows.some((row) => row === null || row.length !== headerColumns)) return false;
      if (parsedRows[0]?.some((cell) => cell.length === 0)) return false;
      return parsedRows
        .slice(1)
        .every((row) => row !== null && row.every((cell) => cell.length > 0));
    }

    case "markdownTable": {
      const columns = p.columns as number;
      const dataRows = p.dataRows as number;
      const lines = response
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length !== 2 + dataRows) return false;

      const header = parseMarkdownRow(lines[0]);
      if (header.length !== columns || header.some((cell) => cell.length === 0)) return false;

      const separator = parseMarkdownRow(lines[1]);
      if (separator.length !== columns || !separator.every(isMarkdownSeparatorCell)) return false;

      return lines
        .slice(2)
        .every((line) => {
          const row = parseMarkdownRow(line);
          return row.length === columns && row.every((cell) => cell.length > 0);
        });
    }

    case "numberedDefinitions": {
      const count = p.expectedCount as number;
      const matches = response.match(/^\d+\.\s+.+\s*[—–-]\s*.+/gm);
      return matches !== null && matches.length === count;
    }

    case "htmlList": {
      const count = p.expectedCount as number;
      const hasUl = /<ul[\s>]/i.test(response) && /<\/ul>/i.test(response);
      const liCount = (response.match(/<li[\s>]/gi) ?? []).length;
      return hasUl && liCount === count;
    }

    default:
      return false;
  }
}

export async function runStructuredOutputBench(model: string): Promise<CategoryResult> {
  const spinner = createSpinner("Running structured output benchmark...");
  spinner.start();

  const details: QuestionResult[] = [];
  let correct = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    spinner.text = `Structured Output ${i + 1}/${questions.length}: ${q.category}`;

    const startTime = Date.now();
    try {
      const result = await withTimeout(
        generate(model, q.prompt, { temperature: 0, num_predict: 1024 }),
        60_000,
        "Structured output task",
        abortOngoingRequests
      );

      const answer = stripThinkTags(result.response);
      const isCorrect = validateStructuredOutputResponse(answer, q);
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

  spinner.succeed(`Structured Output: ${correct}/${questions.length} correct`);

  return {
    score: questions.length > 0 ? (correct / questions.length) * 100 : 0,
    correct,
    total: questions.length,
    details,
  };
}
