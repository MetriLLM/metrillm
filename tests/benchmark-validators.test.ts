/**
 * Test intent:
 * - Lock validator behavior for instruction-following, structured-output and multilingual tasks.
 * - Cover edge cases that previously caused false positives/false negatives.
 *
 * Why it matters:
 * - These validators directly impact benchmark scores and model ranking.
 * - Regressions here can silently invalidate comparisons across models.
 */
import { describe, it, expect } from "vitest";
import {
  validateInstructionFollowingResponse,
  type IFQuestion,
} from "../src/benchmarks/instruction-following.js";
import {
  validateStructuredOutputResponse,
  type SOQuestion,
} from "../src/benchmarks/structured-output.js";
import {
  validateMultilingualResponse,
} from "../src/benchmarks/multilingual.js";

describe("instruction-following validator", () => {
  const answerFormatQuestion: IFQuestion = {
    id: 1,
    category: "structural",
    prompt: "Reply in format ANSWER: <value>",
    validation: "answerFormat",
    params: { expectedValue: "56" },
  };

  it("requires exact ANSWER value instead of substring contains", () => {
    expect(
      validateInstructionFollowingResponse("ANSWER: 560", answerFormatQuestion)
    ).toBe(false);
  });

  it("accepts normalized exact values (quotes and punctuation)", () => {
    expect(
      validateInstructionFollowingResponse("ANSWER: \"56.\"", answerFormatQuestion)
    ).toBe(true);
  });

  it("requires strict Pros/Cons sections and expected counts", () => {
    const q: IFQuestion = {
      id: 2,
      category: "structural",
      prompt: "pros/cons",
      validation: "prosConsStructure",
      params: { prosCount: 2, consCount: 2 },
    };
    const pass = [
      "Pros:",
      "- fast",
      "- flexible",
      "Cons:",
      "- expensive",
      "- noisy",
    ].join("\n");
    const fail = "This context and progress discussion has pros and cons words.";

    expect(validateInstructionFollowingResponse(pass, q)).toBe(true);
    expect(validateInstructionFollowingResponse(fail, q)).toBe(false);
  });

  it("uses word boundaries for forbidden words", () => {
    const q: IFQuestion = {
      id: 3,
      category: "negative",
      prompt: "forbidden words",
      validation: "forbiddenWords",
      params: { forbidden: ["pet"] },
    };
    expect(validateInstructionFollowingResponse("A carpet is on the floor.", q)).toBe(true);
    expect(validateInstructionFollowingResponse("A pet is on the floor.", q)).toBe(false);
  });

  it("covers all instruction-following validation types with representative pass cases", () => {
    const cases: Array<{ question: IFQuestion; response: string }> = [
      {
        question: { id: 10, category: "format", prompt: "", validation: "numberedList", params: { expectedCount: 3 } },
        response: "1. one\n2. two\n3. three",
      },
      {
        question: { id: 11, category: "format", prompt: "", validation: "sentenceCount", params: { expectedCount: 1 } },
        response: "One complete sentence.",
      },
      {
        question: { id: 12, category: "format", prompt: "", validation: "commaSeparated", params: { expectedCount: 4 } },
        response: "a, b, c, d",
      },
      {
        question: { id: 13, category: "format", prompt: "", validation: "wordCount", params: { expectedCount: 3 } },
        response: "one two three",
      },
      {
        question: { id: 14, category: "format", prompt: "", validation: "paragraphCount", params: { expectedCount: 2 } },
        response: "Para one.\n\nPara two.",
      },
      {
        question: { id: 15, category: "negative", prompt: "", validation: "forbiddenLetters", params: { forbidden: ["z"] } },
        response: "alpha beta",
      },
      {
        question: { id: 16, category: "negative", prompt: "", validation: "forbiddenPattern", params: { pattern: "[0-9]" } },
        response: "letters only",
      },
      {
        question: { id: 17, category: "structural", prompt: "", validation: "startEnd", params: { start: "hello", end: "bye" } },
        response: "Hello middle Bye",
      },
      {
        question: { id: 18, category: "structural", prompt: "", validation: "allQuestions", params: {} },
        response: "Who are you? Where now?",
      },
      {
        question: { id: 19, category: "structural", prompt: "", validation: "dashList", params: { expectedCount: 2 } },
        response: "- a\n- b",
      },
      {
        question: { id: 20, category: "content", prompt: "", validation: "fruitStartLength", params: { startLetter: "b", minLength: 6 } },
        response: "banana",
      },
      {
        question: { id: 21, category: "content", prompt: "", validation: "wordLength", params: { expectedLength: 4 } },
        response: "kite",
      },
      {
        question: { id: 22, category: "content", prompt: "", validation: "listCount", params: { expectedCount: 3 } },
        response: "1. a\n2. b\n3. c",
      },
      {
        question: { id: 23, category: "content", prompt: "", validation: "planetOrder", params: {} },
        response: "Jupiter, Saturn, Uranus",
      },
    ];

    for (const { question, response } of cases) {
      expect(validateInstructionFollowingResponse(response, question)).toBe(true);
    }
  });
});

describe("structured-output validator", () => {
  const jsonKeysQuestion: SOQuestion = {
    id: 1,
    category: "json-validity",
    prompt: "Output JSON object with name, age, city",
    validation: "jsonKeys",
    params: {
      keys: ["name", "age", "city"],
      types: { name: "string", age: "number", city: "string" },
    },
  };

  it("extracts first parseable JSON from prose without greedy truncation", () => {
    const response = [
      "Sure, here is the object:",
      "{\"name\":\"Alice\",\"age\":31,\"city\":\"Lyon\"}",
      "Extra notes with braces {not json}.",
    ].join("\n");

    expect(validateStructuredOutputResponse(response, jsonKeysQuestion)).toBe(true);
  });

  it("rejects csv output with extra rows when exact row count is required", () => {
    const csvQuestion: SOQuestion = {
      id: 2,
      category: "structured-text",
      prompt: "CSV",
      validation: "csvFormat",
      params: { headerColumns: 3, dataRows: 2 },
    };
    const response = "name,email,age\nAlice,a@example.com,30\nBob,b@example.com,31\nEve,e@example.com,29";

    expect(validateStructuredOutputResponse(response, csvQuestion)).toBe(false);
  });

  it("rejects markdown tables without a valid separator row", () => {
    const mdQuestion: SOQuestion = {
      id: 3,
      category: "structured-text",
      prompt: "Markdown table",
      validation: "markdownTable",
      params: { columns: 2, dataRows: 2 },
    };
    const response = "| Language | Year |\n| JS | 1995 |\n| Python | 1991 |";

    expect(validateStructuredOutputResponse(response, mdQuestion)).toBe(false);
  });

  it("supports quoted CSV cells containing commas", () => {
    const csvQuestion: SOQuestion = {
      id: 4,
      category: "structured-text",
      prompt: "CSV",
      validation: "csvFormat",
      params: { headerColumns: 3, dataRows: 2 },
    };
    const response = "name,city,age\nAlice,\"Paris, France\",30\nBob,\"New York, USA\",31";
    expect(validateStructuredOutputResponse(response, csvQuestion)).toBe(true);
  });

  it("rejects malformed CSV with unclosed quoted fields", () => {
    const csvQuestion: SOQuestion = {
      id: 5,
      category: "structured-text",
      prompt: "CSV",
      validation: "csvFormat",
      params: { headerColumns: 3, dataRows: 1 },
    };
    const response = "name,city,age\nAlice,\"Paris, France,30";
    expect(validateStructuredOutputResponse(response, csvQuestion)).toBe(false);
  });

  it("covers all structured-output validation types with representative pass cases", () => {
    const cases: Array<{ question: SOQuestion; response: string }> = [
      {
        question: {
          id: 10,
          category: "json-validity",
          prompt: "",
          validation: "jsonArray",
          params: { length: 2, keys: ["id", "label"], types: { id: "number", label: "string" } },
        },
        response: '[{"id":1,"label":"a"},{"id":2,"label":"b"}]',
      },
      {
        question: {
          id: 11,
          category: "json-validity",
          prompt: "",
          validation: "jsonNested",
          params: { path1: ["user", "name"], path2: ["prefs", "lang"] },
        },
        response: '{"user":{"name":"A"},"prefs":{"lang":"fr"}}',
      },
      {
        question: {
          id: 12,
          category: "json-validity",
          prompt: "",
          validation: "jsonNumberArray",
          params: { length: 3, min: 1, max: 10 },
        },
        response: "[1,2,3]",
      },
      {
        question: {
          id: 13,
          category: "json-validity",
          prompt: "",
          validation: "jsonSchema",
          params: {
            schema: { success: "boolean", data: "object", count: "number" },
            nestedKey: "data",
            nestedSchema: { items: "array" },
          },
        },
        response: '{"success":true,"data":{"items":["x"]},"count":1}',
      },
      {
        question: {
          id: 14,
          category: "json-validity",
          prompt: "",
          validation: "jsonToolCall",
          params: { functionName: "get_weather", argKey: "city", argValue: "London" },
        },
        response: '{"function":"get_weather","arguments":{"city":"London"}}',
      },
      {
        question: {
          id: 15,
          category: "json-validity",
          prompt: "",
          validation: "jsonApiResponse",
          params: { status: 200 },
        },
        response: '{"status":200,"message":"ok","data":null}',
      },
      {
        question: {
          id: 16,
          category: "json-validity",
          prompt: "",
          validation: "jsonEvent",
          params: {},
        },
        response: '{"type":"event","name":"Launch","date":"2026-01-01","attendees":42}',
      },
      {
        question: {
          id: 17,
          category: "structured-text",
          prompt: "",
          validation: "keyValueLines",
          params: { expectedCount: 2, expectedKeys: ["name", "role"] },
        },
        response: "Name: Alice\nRole: Engineer",
      },
      {
        question: {
          id: 18,
          category: "structured-text",
          prompt: "",
          validation: "numberedDefinitions",
          params: { expectedCount: 2 },
        },
        response: "1. API - interface\n2. DB - storage",
      },
      {
        question: {
          id: 19,
          category: "structured-text",
          prompt: "",
          validation: "htmlList",
          params: { expectedCount: 2 },
        },
        response: "<ul><li>a</li><li>b</li></ul>",
      },
    ];

    for (const { question, response } of cases) {
      expect(validateStructuredOutputResponse(response, question)).toBe(true);
    }
  });

  it("rejects jsonArray entries with wrong field types", () => {
    const q: SOQuestion = {
      id: 20,
      category: "json-validity",
      prompt: "",
      validation: "jsonArray",
      params: { length: 2, keys: ["id", "label"], types: { id: "number", label: "string" } },
    };
    const bad = '[{"id":"1","label":"a"},{"id":2,"label":"b"}]';
    expect(validateStructuredOutputResponse(bad, q)).toBe(false);
  });

  it("rejects jsonApiResponse when data is not null", () => {
    const q: SOQuestion = {
      id: 21,
      category: "json-validity",
      prompt: "",
      validation: "jsonApiResponse",
      params: { status: 200 },
    };
    const bad = '{"status":200,"message":"ok","data":{"x":1}}';
    expect(validateStructuredOutputResponse(bad, q)).toBe(false);
  });

  it("rejects keyValueLines with unexpected keys or extra non-kv lines", () => {
    const q: SOQuestion = {
      id: 22,
      category: "structured-text",
      prompt: "",
      validation: "keyValueLines",
      params: { expectedCount: 3, expectedKeys: ["name", "role", "experience"] },
    };
    const wrongKeys = "Name: Alice\nRole: Engineer\nLocation: Paris";
    const extraLine = "Name: Alice\nRole: Engineer\nExperience: 5 years\nNote only";
    expect(validateStructuredOutputResponse(wrongKeys, q)).toBe(false);
    expect(validateStructuredOutputResponse(extraLine, q)).toBe(false);
  });
});

describe("multilingual validator", () => {
  it("rejects negated answers even when expected token appears", () => {
    const q = {
      id: 1,
      language: "fr",
      prompt: "capital",
      validation: "stringMatch",
      acceptedAnswers: ["Canberra"],
    };
    expect(validateMultilingualResponse("Not Canberra", q)).toBe(false);
  });

  it("rejects substring-only matches that are not standalone answers", () => {
    const q = {
      id: 2,
      language: "en",
      prompt: "capital",
      validation: "stringMatch",
      acceptedAnswers: ["Rome"],
    };
    expect(validateMultilingualResponse("romeville", q)).toBe(false);
  });

  it("matches CJK standalone answers without latin word boundaries", () => {
    const q = {
      id: 3,
      language: "zh",
      prompt: "capital",
      validation: "stringMatch",
      acceptedAnswers: ["巴黎"],
    };
    expect(validateMultilingualResponse("答案：巴黎。", q)).toBe(true);
  });
});
