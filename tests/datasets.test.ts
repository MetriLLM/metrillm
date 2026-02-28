/**
 * Test intent:
 * - Assert structural integrity of benchmark datasets (reasoning, math, coding).
 * - Validate cardinality, IDs, and minimal schema expectations.
 *
 * Why it matters:
 * - Bad datasets lead to invalid benchmark runs or skewed scoring.
 * - These checks prevent silent content drift when datasets are edited.
 */
import { describe, it, expect } from "vitest";
import reasoningData from "../src/datasets/reasoning.json";
import mathData from "../src/datasets/math.json";
import codingData from "../src/datasets/coding.json";
import instructionData from "../src/datasets/instruction-following.json";
import structuredData from "../src/datasets/structured-output.json";
import multilingualData from "../src/datasets/multilingual.json";
import type { ReasoningQuestion, MathProblem, CodingTask } from "../src/types.js";

const reasoning = reasoningData as ReasoningQuestion[];
const math = mathData as MathProblem[];
const coding = codingData as CodingTask[];
const instructionFollowing = instructionData as Array<{
  id: number;
  category: string;
  prompt: string;
  validation: string;
  params: Record<string, unknown>;
}>;
const structuredOutput = structuredData as Array<{
  id: number;
  category: string;
  prompt: string;
  validation: string;
  params: Record<string, unknown>;
}>;
const multilingual = multilingualData as Array<{
  id: number;
  language: string;
  prompt: string;
  validation: string;
  acceptedAnswers?: string[];
  expectedNumber?: number;
  keywords?: string[];
}>;

function expectUniqueSequentialIds(items: Array<{ id: number }>, count: number): void {
  const ids = items.map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.slice().sort((a, b) => a - b)).toEqual(
    Array.from({ length: count }, (_, i) => i + 1)
  );
}

describe("reasoning dataset", () => {
  it("has 50 questions", () => {
    expect(reasoning).toHaveLength(50);
  });

  it("all questions have required fields", () => {
    for (const q of reasoning) {
      expect(q).toHaveProperty("id");
      expect(q).toHaveProperty("question");
      expect(q).toHaveProperty("choices");
      expect(q).toHaveProperty("answer");
      expect(q).toHaveProperty("category");
    }
  });

  it("all answers are valid choices (A-D)", () => {
    for (const q of reasoning) {
      expect(["A", "B", "C", "D"]).toContain(q.answer);
    }
  });

  it("all questions have exactly 4 choices", () => {
    for (const q of reasoning) {
      expect(q.choices).toHaveLength(4);
    }
  });

  it("IDs are unique", () => {
    expectUniqueSequentialIds(reasoning, 50);
  });
});

describe("math dataset", () => {
  it("has 50 problems", () => {
    expect(math).toHaveLength(50);
  });

  it("all problems have required fields", () => {
    for (const p of math) {
      expect(p).toHaveProperty("id");
      expect(p).toHaveProperty("question");
      expect(p).toHaveProperty("answer");
      expect(typeof p.answer).toBe("number");
    }
  });

  it("IDs are unique", () => {
    expectUniqueSequentialIds(math, 50);
  });
});

describe("coding dataset", () => {
  it("has 35 tasks", () => {
    expect(coding).toHaveLength(35);
  });

  it("all tasks have required fields", () => {
    for (const t of coding) {
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("functionName");
      expect(t).toHaveProperty("signature");
      expect(t).toHaveProperty("tests");
      expect(t.tests.length).toBeGreaterThan(0);
    }
  });

  it("all tests have input and expected", () => {
    for (const t of coding) {
      for (const test of t.tests) {
        expect(test).toHaveProperty("input");
        expect(test).toHaveProperty("expected");
        expect(Array.isArray(test.input)).toBe(true);
      }
    }
  });

  it("IDs are unique", () => {
    expectUniqueSequentialIds(coding, 35);
  });

  it("function names are unique", () => {
    const names = coding.map((t) => t.functionName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("instruction-following dataset", () => {
  it("has 20 tasks", () => {
    expect(instructionFollowing).toHaveLength(20);
  });

  it("all tasks have required fields", () => {
    for (const q of instructionFollowing) {
      expect(typeof q.id).toBe("number");
      expect(typeof q.category).toBe("string");
      expect(typeof q.prompt).toBe("string");
      expect(typeof q.validation).toBe("string");
      expect(typeof q.params).toBe("object");
      expect(q.params).not.toBeNull();
    }
  });

  it("IDs are unique and sequential 1..20", () => {
    expectUniqueSequentialIds(instructionFollowing, 20);
  });
});

describe("structured-output dataset", () => {
  it("has 15 tasks", () => {
    expect(structuredOutput).toHaveLength(15);
  });

  it("all tasks have required fields", () => {
    for (const q of structuredOutput) {
      expect(typeof q.id).toBe("number");
      expect(typeof q.category).toBe("string");
      expect(typeof q.prompt).toBe("string");
      expect(typeof q.validation).toBe("string");
      expect(typeof q.params).toBe("object");
      expect(q.params).not.toBeNull();
    }
  });

  it("IDs are unique and sequential 1..15", () => {
    expectUniqueSequentialIds(structuredOutput, 15);
  });
});

describe("multilingual dataset", () => {
  it("has 20 questions", () => {
    expect(multilingual).toHaveLength(20);
  });

  it("all questions have required fields", () => {
    for (const q of multilingual) {
      expect(typeof q.id).toBe("number");
      expect(typeof q.language).toBe("string");
      expect(typeof q.prompt).toBe("string");
      expect(typeof q.validation).toBe("string");
    }
  });

  it("validation payload matches validation type", () => {
    for (const q of multilingual) {
      if (q.validation === "stringMatch") {
        expect(Array.isArray(q.acceptedAnswers)).toBe(true);
        expect((q.acceptedAnswers ?? []).length).toBeGreaterThan(0);
      } else if (q.validation === "numberMatch") {
        expect(typeof q.expectedNumber).toBe("number");
      } else if (q.validation === "containsKeyword") {
        expect(Array.isArray(q.keywords)).toBe(true);
        expect((q.keywords ?? []).length).toBeGreaterThan(0);
      } else {
        throw new Error(`Unknown multilingual validation type: ${q.validation}`);
      }
    }
  });

  it("IDs are unique and sequential 1..20", () => {
    expectUniqueSequentialIds(multilingual, 20);
  });
});
