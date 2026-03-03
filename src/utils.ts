import vm from "node:vm";
import { execFile } from "node:child_process";

export function openUrl(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  execFile(cmd, [url]);
}

export function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = avg(nums);
  const variance = nums.reduce((sum, v) => sum + (v - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function sanitizeNonNegative(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

export function lerp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + t * (outMax - outMin);
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "Operation",
  onTimeout?: () => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        onTimeout?.();
      } catch {
        // Ignore timeout cleanup errors and preserve timeout as root cause
      }
      reject(new Error(`${label} timed out after ${formatDuration(ms)}`));
    }, ms);
    promise
      .then((v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
  });
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && /timed out after/i.test(err.message);
}

export function toBenchmarkFailureLabel(err: unknown): string {
  if (isTimeoutError(err)) return "TIMEOUT";
  const message = err instanceof Error ? err.message : String(err);
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return "ERROR";
  const maxLen = 120;
  return compact.length > maxLen
    ? `ERROR: ${compact.slice(0, maxLen - 1)}…`
    : `ERROR: ${compact}`;
}

/**
 * Strip <think>...</think> blocks emitted by reasoning models (e.g. deepseek-r1).
 * Also strips trailing chat-template tokens frequently emitted by local runtimes.
 */
export function stripThinkTags(text: string): string {
  // Handle <think>...</think> and <thinking>...</thinking>
  const withoutThinking = text.replace(/<think(?:ing)?[\s>][\s\S]*?<\/think(?:ing)?>/gi, "");
  const withoutTrailingWhitespace = withoutThinking.trimEnd();

  // Some backends return chat delimiter tokens in final text; keep only semantic content.
  const withoutTrailingControlTokens = withoutTrailingWhitespace.replace(
    /(?:\s*(?:<\|(?:im_end|eot_id|end_of_text|eom_id|end)\|>|<\/s>))+$/gi,
    ""
  );

  return withoutTrailingControlTokens.trim();
}

export function hasThinkingContent(response: string, thinkingField?: string): boolean {
  if (thinkingField && thinkingField.trim().length > 0) return true;
  if (/<think(?:ing)?[\s>]/i.test(response)) return true;
  // Some runtimes emit plain-text reasoning headers instead of dedicated fields/tags.
  return /^\s*(?:thinking|thought)\s+process\s*:/i.test(response);
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function extractNumber(text: string): number | null {
  const numberPattern = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[-+]?\d+)?/i;
  const numberPatternGlobal = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[-+]?\d+)?/gi;
  const parseNumericToken = (token: string): number | null => {
    const normalized = token.replace(/,/g, "");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // Try common patterns in order of specificity

  // "The answer is X" pattern
  const answerMatch = text.match(
    new RegExp(`(?:answer|result|total|equals?)\\s*(?:is|:)?\\s*(${numberPattern.source})`, "i")
  );
  if (answerMatch) {
    return parseNumericToken(answerMatch[1]);
  }

  // Last number in the text (most likely to be the final answer)
  const allNumbers = text.match(numberPatternGlobal);
  if (allNumbers && allNumbers.length > 0) {
    return parseNumericToken(allNumbers[allNumbers.length - 1]);
  }

  return null;
}

export function extractChoice(text: string): string | null {
  // Extract a single letter choice (A, B, C, D) from model output
  const cleaned = text.trim();

  // Direct single letter
  if (/^[A-D]$/i.test(cleaned)) return cleaned.toUpperCase();

  // "The answer is X" or "answer: X" pattern
  const answerMatch = cleaned.match(/(?:the\s+)?answer\s+is\s+([A-D])\b/i);
  if (answerMatch) return answerMatch[1].toUpperCase();

  // "Option X" / "Choice X" pattern
  const optionMatch = cleaned.match(/(?:option|choice)\s*[:\-]?\s*([A-D])\b/i);
  if (optionMatch) return optionMatch[1].toUpperCase();

  // "X)" or "X." or "X:" at start of text (common model response format)
  const prefixMatch = cleaned.match(/^([A-D])[).:](?!\w)/i);
  if (prefixMatch) return prefixMatch[1].toUpperCase();

  // "I choose B", "my answer: C", "final answer D"
  const decisionMatch = cleaned.match(
    /\b(?:choose|chosen|pick|picked|answer|final answer)\b[\s:=\-]*(?:option|choice)?[\s:=\-]*([A-D])\b/i
  );
  if (decisionMatch) return decisionMatch[1].toUpperCase();

  // Last standalone choice at end of response.
  const endMatch = cleaned.match(/\b([A-D])\b[\s.!?]*$/i);
  if (endMatch) return endMatch[1].toUpperCase();

  return null;
}

function stripInterfaceDeclarations(code: string): string {
  const interfaceRe = /^\s*(?:export\s+)?interface\s+\w+(?:<[^>]*>)?\s*\{/gm;
  let match: RegExpExecArray | null;
  const ranges: [number, number][] = [];
  while ((match = interfaceRe.exec(code)) !== null) {
    const start = match.index;
    let depth = 0;
    let end = -1;
    for (let i = start + match[0].length - 1; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end !== -1) ranges.push([start, end]);
  }
  // Remove ranges in reverse to preserve indices
  let result = code;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [s, e] = ranges[i];
    result = result.slice(0, s) + result.slice(e);
  }
  return result;
}

/**
 * Strip TypeScript type annotations from code so it can run in a plain JS vm.Script.
 * Only strips if the code does NOT compile as-is (avoids mangling valid JS).
 */
export function stripTypeAnnotations(code: string): string {
  // If it already compiles as JS, leave it alone.
  try {
    new vm.Script(`${code}\n;`);
    return code;
  } catch {
    // needs stripping
  }

  // Strategy 1 (opt-in): Node 22.6+ built-in TS stripping.
  // Disabled by default because Node currently emits an ExperimentalWarning.
  if (process.env.METRILLM_ENABLE_EXPERIMENTAL_TS_STRIP === "1") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("node:module") as { stripTypeScriptTypes?: (code: string) => string };
      if (typeof mod.stripTypeScriptTypes === "function") {
        const stripped = mod.stripTypeScriptTypes(code);
        try {
          new vm.Script(`${stripped}\n;`);
          return stripped;
        } catch {
          // stripTypeScriptTypes may fail on TS enums etc., fall through
        }
      }
    } catch {
      // node:module API not available, fall through
    }
  }

  // Strategy 2: Regex fallback for common LLM-generated TS patterns
  let result = code;

  // Remove interface declarations (handles nested braces via balanced counting)
  result = stripInterfaceDeclarations(result);
  // Remove type alias declarations
  result = result.replace(/^\s*(?:export\s+)?type\s+\w+(?:<[^>]*>)?\s*=\s*[^;]+;\s*$/gm, "");

  // Strip generic type params on function declarations: function foo<T, U>( → function foo(
  result = result.replace(/(function\s+\w+)\s*<[^>]+>/g, "$1");

  // Strip generic type params on arrow const: const foo = <T>( → const foo = (
  result = result.replace(/((?:const|let|var)\s+\w+\s*=\s*)<[^>]+>\s*\(/g, "$1(");

  // Strip return type annotations: ): Type { → ) { and ): Type => → ) =>
  // Supports generic types like Record<string, string[]> by consuming balanced <>
  result = result.replace(/\)\s*:\s*(?:[^=>{,()]|<[^>]*>)+(?=\s*\{)/g, ")");
  result = result.replace(/\)\s*:\s*(?:[^=>{,()]|<[^>]*>)+(?=\s*=>)/g, ")");

  // Strip parameter type annotations: (a: string, b: number) → (a, b)
  // Only match identifier followed by colon (not destructured objects like {a: 1})
  result = result.replace(/(\((?:[^()]*\([^()]*\))*[^()]*\))/g, (parenBlock) => {
    return parenBlock.replace(/([A-Za-z_$]\w*)\s*:\s*(?:[^,)=]|<[^>]*>)+/g, (m, name, mOffset) => {
      // Skip if this looks like an object literal key (preceded by { or ,)
      const before = parenBlock.slice(0, mOffset).trimEnd();
      if (before.endsWith("{") || before.endsWith(",")) {
        // Could be inside destructured default value — leave it alone
        const afterOpen = parenBlock.lastIndexOf("{", mOffset);
        const afterClose = parenBlock.lastIndexOf("}", mOffset);
        if (afterOpen > afterClose) return m; // inside an object literal
      }
      return name;
    });
  });

  // Strip variable type annotations: const x: string = → const x =
  result = result.replace(/((?:const|let|var)\s+\w+)\s*:\s*(?:[^=;]|<[^>]*>)+(?=\s*=)/g, "$1");

  // Strip 'as Type' casts
  result = result.replace(/\s+as\s+(?:\w+(?:<[^>]*>)?(?:\[\])*)/g, "");

  // Strip non-null assertion operator: x!. → x.
  result = result.replace(/(\w)!\./g, "$1.");

  // Check if the stripped version compiles
  try {
    new vm.Script(`${result}\n;`);
    return result;
  } catch {
    // Regex stripping wasn't enough, return original (will fail in sandbox but
    // that's the same behavior as before this feature)
    return code;
  }
}

export function extractCodeBlock(text: string, preferredFunctionName?: string): string {
  const isValidSnippet = (snippet: string): boolean => {
    if (!snippet) return false;
    try {
      new vm.Script(`${snippet}\n;`);
      return true;
    } catch {
      return false;
    }
  };

  function extractBalancedBlock(startIndex: number): string | null {
    const openIndex = text.indexOf("{", startIndex);
    if (openIndex === -1) return null;

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let i = openIndex; i < text.length; i++) {
      const ch = text[i];
      const next = i + 1 < text.length ? text[i + 1] : "";

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }

      if (inSingle) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "'") inSingle = false;
        continue;
      }

      if (inDouble) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") inDouble = false;
        continue;
      }

      if (inTemplate) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "`") inTemplate = false;
        continue;
      }

      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }

      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === "\"") {
        inDouble = true;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }

      if (ch === "{") {
        depth++;
        continue;
      }
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          return text.slice(startIndex, i + 1).trim();
        }
      }
    }

    return null;
  }

  function extractArrowExpression(startIndex: number): string | null {
    const header = /(?:const|let|var)\s+\w+\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/;
    const head = header.exec(text.slice(startIndex));
    if (!head) return null;

    let i = startIndex + head[0].length;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (; i < text.length; i++) {
      const ch = text[i];
      const next = i + 1 < text.length ? text[i + 1] : "";

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }

      if (inSingle) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "'") inSingle = false;
        continue;
      }

      if (inDouble) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") inDouble = false;
        continue;
      }

      if (inTemplate) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "`") inTemplate = false;
        continue;
      }

      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }

      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === "\"") {
        inDouble = true;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }

      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);

      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (ch === ";") {
          const candidate = text.slice(startIndex, i + 1).trim();
          if (isValidSnippet(candidate)) return candidate;
        }
        if (ch === "\n") {
          const candidate = text.slice(startIndex, i).trim();
          if (isValidSnippet(candidate)) return candidate;
        }
        if (ch === " " && /[A-Za-z]/.test(next)) {
          // Typical model pattern: "const f = x => x + 1 and ...".
          const candidate = text.slice(startIndex, i).trim();
          if (isValidSnippet(candidate)) return candidate;
        }
      }
    }

    const tail = text.slice(startIndex).trim();
    return isValidSnippet(tail) ? tail : null;
  }

  // Extract code from markdown code block (prefer this, most reliable)
  const match = text.match(/```(?:javascript|js|typescript|ts)?\s*\n([\s\S]*?)```/);
  if (match) return match[1].trim();

  // Generic code block
  const genericMatch = text.match(/```\s*\n([\s\S]*?)```/);
  if (genericMatch) return genericMatch[1].trim();

  const escapeRegex = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // When we know the expected function name, prefer extracting that exact symbol.
  if (preferredFunctionName) {
    const fnName = escapeRegex(preferredFunctionName);

    const namedFunctionStart = text.search(
      new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`)
    );
    if (namedFunctionStart !== -1) {
      const extracted = extractBalancedBlock(namedFunctionStart);
      if (extracted) return extracted;
    }

    const namedArrowBlockStart = text.search(
      new RegExp(
        `(?:const|let|var)\\s+${fnName}\\s*=\\s*(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>\\s*\\{`
      )
    );
    if (namedArrowBlockStart !== -1) {
      const extracted = extractBalancedBlock(namedArrowBlockStart);
      if (extracted) return extracted;
    }

    const namedArrowExprStart = text.search(
      new RegExp(
        `(?:const|let|var)\\s+${fnName}\\s*=\\s*(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>\\s*(?!\\{)`
      )
    );
    if (namedArrowExprStart !== -1) {
      const extracted = extractArrowExpression(namedArrowExprStart);
      if (extracted) return extracted;
    }

    const namedFunctionExprStart = text.search(
      new RegExp(`(?:const|let|var)\\s+${fnName}\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{`)
    );
    if (namedFunctionExprStart !== -1) {
      const extracted = extractBalancedBlock(namedFunctionExprStart);
      if (extracted) return extracted;
    }
  }

  // If no code block, try to find a function declaration with balanced braces.
  const funcStart = text.search(/function\s+\w+\s*\([^)]*\)\s*\{/);
  if (funcStart !== -1) {
    const extracted = extractBalancedBlock(funcStart);
    if (extracted) return extracted;
  }

  // Try arrow function with block body and balanced braces.
  const arrowStart = text.search(/(?:const|let|var)\s+\w+\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/);
  if (arrowStart !== -1) {
    const extracted = extractBalancedBlock(arrowStart);
    if (extracted) return extracted;
  }

  // Try arrow function with expression body.
  const arrowExprStart = text.search(/(?:const|let|var)\s+\w+\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?!\{)/);
  if (arrowExprStart !== -1) {
    const extracted = extractArrowExpression(arrowExprStart);
    if (extracted) return extracted;
  }

  // Try function expression assignment: const fn = function(...) { ... }
  const functionExprStart = text.search(/(?:const|let|var)\s+\w+\s*=\s*function\s*\([^)]*\)\s*\{/);
  if (functionExprStart !== -1) {
    const extracted = extractBalancedBlock(functionExprStart);
    if (extracted) return extracted;
  }

  return text.trim();
}
