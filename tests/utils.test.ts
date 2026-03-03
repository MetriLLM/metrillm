/**
 * Test intent:
 * - Validate low-level utility helpers used by scoring, parsing and CLI output.
 * - Cover edge cases that previously caused wrong scores or parsing failures.
 *
 * Why it matters:
 * - If these helpers regress, benchmark results become misleading.
 * - Most benchmark modules depend on these helpers, so this is high-leverage coverage.
 */
import { describe, it, expect } from "vitest";
import {
  avg,
  stddev,
  formatBytes,
  formatDuration,
  clamp,
  lerp,
  isTimeoutError,
  toBenchmarkFailureLabel,
  withTimeout,
  extractNumber,
  extractChoice,
  extractCodeBlock,
  stripThinkTags,
  hasThinkingContent,
  estimateTokenCount,
  stripTypeAnnotations,
} from "../src/utils.js";

describe("avg", () => {
  it("returns 0 for empty array", () => {
    expect(avg([])).toBe(0);
  });

  it("computes average of numbers", () => {
    expect(avg([1, 2, 3, 4, 5])).toBe(3);
  });

  it("handles single element", () => {
    expect(avg([42])).toBe(42);
  });

  it("handles negative numbers", () => {
    expect(avg([-2, 2])).toBe(0);
  });
});

describe("stddev", () => {
  it("returns 0 for fewer than 2 elements", () => {
    expect(stddev([])).toBe(0);
    expect(stddev([42])).toBe(0);
  });

  it("returns 0 for identical values", () => {
    expect(stddev([5, 5, 5])).toBe(0);
  });

  it("computes population standard deviation", () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, variance=4, stddev=2
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it("computes correctly for two values", () => {
    // [0, 10] → mean=5, variance=25, stddev=5
    expect(stddev([0, 10])).toBe(5);
  });
});

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512.0 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("formats with decimals", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  // Edge cases fixed by audit
  it("handles negative bytes", () => {
    expect(formatBytes(-1)).toBe("0 B");
  });

  it("handles Infinity", () => {
    expect(formatBytes(Infinity)).toBe("0 B");
  });

  it("handles NaN", () => {
    expect(formatBytes(NaN)).toBe("0 B");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1500)).toBe("1.5s");
  });

  it("formats minutes", () => {
    expect(formatDuration(125000)).toBe("2m5s");
  });

  it("formats exact seconds", () => {
    expect(formatDuration(3000)).toBe("3.0s");
  });

  it("does not round minute remainder to 60 seconds", () => {
    expect(formatDuration(119999)).toBe("1m59s");
  });
});

describe("clamp", () => {
  it("clamps below min", () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it("returns value in range", () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it("returns min when equal", () => {
    expect(clamp(0, 0, 100)).toBe(0);
  });

  it("returns max when equal", () => {
    expect(clamp(100, 0, 100)).toBe(100);
  });

  // Edge case fixed by audit
  it("handles NaN by returning min", () => {
    expect(clamp(NaN, 0, 100)).toBe(0);
  });
});

describe("lerp", () => {
  it("interpolates at min", () => {
    expect(lerp(0, 0, 100, 0, 40)).toBe(0);
  });

  it("interpolates at max", () => {
    expect(lerp(100, 0, 100, 0, 40)).toBe(40);
  });

  it("interpolates at midpoint", () => {
    expect(lerp(50, 0, 100, 0, 40)).toBe(20);
  });

  it("clamps below range", () => {
    expect(lerp(-10, 0, 100, 0, 40)).toBe(0);
  });

  it("clamps above range", () => {
    expect(lerp(200, 0, 100, 0, 40)).toBe(40);
  });

  // Edge case fixed by audit: division by zero
  it("returns outMin when inMax equals inMin", () => {
    expect(lerp(5, 5, 5, 10, 20)).toBe(10);
  });

  // Inverted ranges (for TTFT/memory scoring)
  it("supports inverted output ranges (higher input = lower output)", () => {
    expect(lerp(500, 500, 1000, 30, 25)).toBe(30);
    expect(lerp(1000, 500, 1000, 30, 25)).toBe(25);
    expect(lerp(750, 500, 1000, 30, 25)).toBe(27.5);
  });
});

describe("extractNumber", () => {
  it("extracts integer from answer pattern", () => {
    expect(extractNumber("The answer is 42")).toBe(42);
  });

  it("extracts decimal from result pattern", () => {
    expect(extractNumber("Result: 3.14")).toBe(3.14);
  });

  it("extracts negative", () => {
    expect(extractNumber("Temperature is -5 degrees")).toBe(-5);
  });

  it("returns null for no number", () => {
    expect(extractNumber("no numbers here")).toBeNull();
  });

  // Fixed by audit: now takes LAST number (more likely to be the final answer)
  it("extracts last number when multiple present", () => {
    expect(extractNumber("I calculated 2+3 and got 5")).toBe(5);
  });

  it("extracts standalone number", () => {
    expect(extractNumber("42")).toBe(42);
  });

  it("prefers answer pattern over last number", () => {
    expect(extractNumber("Step 1: compute 7. The answer is 14.")).toBe(14);
  });

  it("parses scientific notation", () => {
    expect(extractNumber("result: 1e-3")).toBe(0.001);
  });

  it("parses thousands separators", () => {
    expect(extractNumber("The answer is 1,259.712")).toBe(1259.712);
  });
});

describe("extractChoice", () => {
  it("extracts single letter", () => {
    expect(extractChoice("C")).toBe("C");
  });

  it("extracts lowercase letter", () => {
    expect(extractChoice("b")).toBe("B");
  });

  it('extracts from "The answer is X" pattern', () => {
    expect(extractChoice("The answer is B")).toBe("B");
  });

  it('extracts from "answer is X" pattern', () => {
    expect(extractChoice("answer is D")).toBe("D");
  });

  it("returns null for no choice", () => {
    expect(extractChoice("I don't know")).toBeNull();
  });

  it("handles trimming", () => {
    expect(extractChoice("  A  ")).toBe("A");
  });

  it("does not treat sentence article as the chosen option", () => {
    expect(extractChoice("A good analysis shows D")).toBe("D");
  });

  it("extracts prefix format like 'C)'", () => {
    expect(extractChoice("C) Paris")).toBe("C");
  });

  it("prefers explicit option pattern over later letters", () => {
    expect(extractChoice("Choice: B. I considered C and D as distractors.")).toBe("B");
  });

  it("extracts choice from 'I choose option X' phrasing", () => {
    expect(extractChoice("I choose option C for this question.")).toBe("C");
  });
});

describe("extractCodeBlock", () => {
  it("extracts from js code block", () => {
    const input = '```javascript\nfunction add(a, b) { return a + b; }\n```';
    expect(extractCodeBlock(input)).toBe("function add(a, b) { return a + b; }");
  });

  it("extracts from generic code block", () => {
    const input = '```\nfunction test() {}\n```';
    expect(extractCodeBlock(input)).toBe("function test() {}");
  });

  it("extracts multi-line function with braces", () => {
    const input = "Here is the code:\nfunction add(a, b) {\n  return a + b;\n}\nThat's it.";
    expect(extractCodeBlock(input)).toContain("function add(a, b)");
    expect(extractCodeBlock(input)).toContain("return a + b;");
  });

  it("extracts inline function declaration from prose-wrapped response", () => {
    const input = "Sure! function add(a,b){ return a+b; } Let me know if you want tests.";
    expect(extractCodeBlock(input)).toBe("function add(a,b){ return a+b; }");
  });

  it("extracts full non-fenced function body with nested blocks", () => {
    const input =
      "Try this: function solve(nums){ if(!nums.length){ return 0; } let s=0; for(let i=0;i<nums.length;i++){ if(nums[i]>0){ s+=nums[i]; } } return s; } done.";
    expect(extractCodeBlock(input)).toBe(
      "function solve(nums){ if(!nums.length){ return 0; } let s=0; for(let i=0;i<nums.length;i++){ if(nums[i]>0){ s+=nums[i]; } } return s; }"
    );
  });

  it("prefers the expected function when prose includes helper functions first", () => {
    const input =
      "Here you go: function helper(x){ return x * x; } function solve(n){ if(n < 2){ return n; } return helper(n); }";
    expect(extractCodeBlock(input, "solve")).toBe(
      "function solve(n){ if(n < 2){ return n; } return helper(n); }"
    );
  });

  it("extracts arrow function expression", () => {
    const input = "const add = (a, b) => a + b;";
    expect(extractCodeBlock(input)).toBe("const add = (a, b) => a + b;");
  });

  it("extracts function-expression assignment from prose", () => {
    const input = "Answer: const add = function(a, b) { return a + b; };";
    expect(extractCodeBlock(input, "add")).toBe(
      "const add = function(a, b) { return a + b; }"
    );
  });

  it("extracts arrow expression with non-parenthesized parameter name", () => {
    const input = "const inc = value => value + 1;";
    expect(extractCodeBlock(input)).toBe("const inc = value => value + 1;");
  });

  it("stops arrow-expression extraction at semicolon before trailing prose", () => {
    const input = "const f = x => x + 1; done.";
    expect(extractCodeBlock(input)).toBe("const f = x => x + 1;");
  });

  it("stops arrow-expression extraction before trailing prose without semicolon", () => {
    const input = "const f = x => x + 1 and this is the final answer";
    expect(extractCodeBlock(input)).toBe("const f = x => x + 1");
  });

  it("returns trimmed text as fallback", () => {
    const input = "  some random text  ";
    expect(extractCodeBlock(input)).toBe("some random text");
  });
});

describe("stripThinkTags", () => {
  it("strips <think>...</think> block", () => {
    const input = "<think>\nLet me reason about this...\nThe answer should be B.\n</think>\nB";
    expect(stripThinkTags(input)).toBe("B");
  });

  it("strips <thinking>...</thinking> block", () => {
    const input = "<thinking>Some reasoning here</thinking>\nThe answer is 42";
    expect(stripThinkTags(input)).toBe("The answer is 42");
  });

  it("returns original text when no think tags", () => {
    expect(stripThinkTags("Just a normal answer")).toBe("Just a normal answer");
  });

  it("handles multiple think blocks", () => {
    const input = "<think>first</think> mid <think>second</think> final";
    expect(stripThinkTags(input)).toBe("mid  final");
  });

  it("handles empty think block", () => {
    const input = "<think></think>Answer";
    expect(stripThinkTags(input)).toBe("Answer");
  });

  it("preserves content after think block with code", () => {
    const input = "<think>\nI need to write a function...\n</think>\n```javascript\nfunction add(a, b) { return a + b; }\n```";
    expect(stripThinkTags(input)).toContain("function add(a, b)");
    expect(stripThinkTags(input)).not.toContain("I need to write");
  });

  it("strips trailing local-runtime control tokens", () => {
    expect(stripThinkTags("B <|im_end|>")).toBe("B");
    expect(stripThinkTags("The answer is 42 <|eot_id|>")).toBe("The answer is 42");
    expect(stripThinkTags("Answer <|im_end|>\n")).toBe("Answer");
    expect(stripThinkTags("Answer </s>   ")).toBe("Answer");
  });

  it("strips repeated trailing control tokens", () => {
    const input = "Final answer\n<|im_end|>\n<|eot_id|>\n</s>";
    expect(stripThinkTags(input)).toBe("Final answer");
  });

  it("keeps token-like text when it is not a trailing control marker", () => {
    const input = "In this format guide, <|im_end|> is shown as a literal token.";
    expect(stripThinkTags(input)).toBe(input);
  });
});

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100, "test")).resolves.toBe("ok");
  });

  it("rejects on timeout and runs onTimeout callback", async () => {
    let called = false;
    const never = new Promise<string>(() => {
      // intentionally never resolves
    });

    await expect(
      withTimeout(never, 30, "slow op", () => {
        called = true;
      })
    ).rejects.toThrow(/slow op timed out/);

    expect(called).toBe(true);
  });
});

describe("hasThinkingContent", () => {
  it("returns true when thinkingField is provided", () => {
    expect(hasThinkingContent("normal response", "some thinking")).toBe(true);
  });

  it("returns true when response contains <think> tags", () => {
    expect(hasThinkingContent("<think>reasoning here</think>\nAnswer")).toBe(true);
  });

  it("returns true when response contains <thinking> tags", () => {
    expect(hasThinkingContent("<thinking>reasoning</thinking>\nAnswer")).toBe(true);
  });

  it("returns false for normal response without thinking", () => {
    expect(hasThinkingContent("Just a normal answer")).toBe(false);
  });

  it("returns false when thinkingField is empty string", () => {
    expect(hasThinkingContent("normal response", "")).toBe(false);
  });

  it("returns false when thinkingField is whitespace only", () => {
    expect(hasThinkingContent("normal response", "   ")).toBe(false);
  });
});

describe("estimateTokenCount", () => {
  it("counts words split by whitespace", () => {
    expect(estimateTokenCount("one two three four")).toBe(4);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("handles multiple spaces and newlines", () => {
    expect(estimateTokenCount("  hello  world\n  foo  ")).toBe(3);
  });

  it("handles single word", () => {
    expect(estimateTokenCount("word")).toBe(1);
  });
});

describe("stripTypeAnnotations", () => {
  it("returns valid JS unchanged", () => {
    const js = "function add(a, b) { return a + b; }";
    expect(stripTypeAnnotations(js)).toBe(js);
  });

  it("strips parameter type annotations", () => {
    const ts = "function add(a: number, b: number) { return a + b; }";
    const result = stripTypeAnnotations(ts);
    expect(result).not.toContain(": number");
    // Node's stripTypeScriptTypes may pad with spaces; just verify it compiles
    expect(result).toMatch(/function add\(a\s*,\s*b\s*\)/);
  });

  it("strips return type annotations", () => {
    const ts = "function add(a, b): number { return a + b; }";
    const result = stripTypeAnnotations(ts);
    expect(result).not.toContain(": number");
    expect(result).toContain("function add(a, b)");
  });

  it("strips complex return type like Record<string, string[]>", () => {
    const ts = 'function group(items): Record<string, string[]> { return {}; }';
    const result = stripTypeAnnotations(ts);
    expect(result).not.toContain("Record");
  });

  it("strips variable type annotations", () => {
    const ts = 'const x: string = "hello";';
    const result = stripTypeAnnotations(ts);
    expect(result).not.toContain(": string");
    expect(result).toMatch(/const x\s*=\s*"hello"/);
  });

  it("removes interface declarations", () => {
    const ts = "interface Foo { bar: string; }\nfunction test() { return 1; }";
    const result = stripTypeAnnotations(ts);
    expect(result).not.toContain("interface");
    expect(result).toContain("function test()");
  });

  it("removes interface with nested braces", () => {
    const ts = "interface Foo { nested: { x: number }; }\nfunction test() { return 1; }";
    const result = stripTypeAnnotations(ts);
    expect(result).not.toContain("interface");
    expect(result).toContain("function test()");
  });

  it("removes type alias declarations", () => {
    const ts = "type ID = string | number;\nfunction test() { return 1; }";
    const result = stripTypeAnnotations(ts);
    expect(result).not.toContain("type ID");
    expect(result).toContain("function test()");
  });

  it("strips 'as Type' casts", () => {
    const ts = "const x = value as string;";
    const result = stripTypeAnnotations(ts);
    expect(result).not.toContain("as string");
  });

  it("strips generic type params on functions", () => {
    const ts = "function identity<T>(x: T): T { return x; }";
    const result = stripTypeAnnotations(ts);
    expect(result).not.toContain("<T>");
    // Node's stripTypeScriptTypes may pad with spaces
    expect(result).toMatch(/function identity\s*\(/);
  });

  it("strips non-null assertion operator", () => {
    const ts = "const x = obj!.property;";
    const result = stripTypeAnnotations(ts);
    // Node's stripTypeScriptTypes replaces ! with space; regex fallback replaces !. with .
    expect(result).toMatch(/obj\s*\.property/);
  });
});

describe("benchmark failure helpers", () => {
  it("detects timeout errors", () => {
    expect(isTimeoutError(new Error("Operation timed out after 2s"))).toBe(true);
    expect(isTimeoutError(new Error("Other failure"))).toBe(false);
  });

  it("formats timeout and non-timeout labels", () => {
    expect(toBenchmarkFailureLabel(new Error("Task timed out after 30s"))).toBe("TIMEOUT");
    expect(toBenchmarkFailureLabel(new Error("socket closed"))).toBe("ERROR: socket closed");
  });
});
