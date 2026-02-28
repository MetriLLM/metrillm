/**
 * Test intent:
 * - Validate that coding dataset test cases are correct against reference implementations.
 * - Ensure each task's expected outputs are internally consistent.
 *
 * Why it matters:
 * - If benchmark test cases are wrong, model evaluation becomes meaningless.
 * - This suite protects the benchmark from bad ground-truth data.
 */
import { describe, it, expect } from "vitest";
import codingData from "../src/datasets/coding.json";
import type { CodingTask } from "../src/types.js";

const tasks = codingData as CodingTask[];

// Reference implementations to validate test cases
const implementations: Record<string, (...args: any[]) => any> = {
  groupByFirstLetter: (words: string[]) => {
    const out: Record<string, string[]> = {};
    for (const word of words) {
      if (!word) continue;
      const key = word[0].toLowerCase();
      (out[key] ??= []).push(word);
    }
    return out;
  },
  runLengthEncode: (s: string) => {
    const out: Array<[string, number]> = [];
    if (!s) return out;
    let current = s[0];
    let count = 1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] === current) {
        count++;
      } else {
        out.push([current, count]);
        current = s[i];
        count = 1;
      }
    }
    out.push([current, count]);
    return out;
  },
  deepFlatten: (arr: any[]) => {
    const out: any[] = [];
    const visit = (value: any): void => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else {
        out.push(value);
      }
    };
    visit(arr);
    return out;
  },
  permutations: (s: string) => {
    if (s.length === 0) return [""];
    const chars = s.split("");
    const used = Array(chars.length).fill(false);
    const out = new Set<string>();
    chars.sort();
    const path: string[] = [];
    const dfs = () => {
      if (path.length === chars.length) {
        out.add(path.join(""));
        return;
      }
      for (let i = 0; i < chars.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        path.push(chars[i]);
        dfs();
        path.pop();
        used[i] = false;
      }
    };
    dfs();
    return [...out].sort();
  },
  romanToInt: (s: string) => {
    const map: Record<string, number> = {
      I: 1,
      V: 5,
      X: 10,
      L: 50,
      C: 100,
      D: 500,
      M: 1000,
    };
    let out = 0;
    for (let i = 0; i < s.length; i++) {
      const current = map[s[i]] ?? 0;
      const next = map[s[i + 1]] ?? 0;
      if (current < next) out -= current;
      else out += current;
    }
    return out;
  },
  firstUniqCharIndex: (s: string) => {
    const freq = new Map<string, number>();
    for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
    for (let i = 0; i < s.length; i++) {
      if ((freq.get(s[i]) ?? 0) === 1) return i;
    }
    return -1;
  },
  add: (a: number, b: number) => a + b,
  factorial: (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1)),
  isPalindrome: (str: string) => {
    const cleaned = str.toLowerCase().replace(/\s/g, "");
    return cleaned === cleaned.split("").reverse().join("");
  },
  fibonacci: (n: number): number => {
    if (n <= 0) return 0;
    if (n === 1) return 1;
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
      [a, b] = [b, a + b];
    }
    return b;
  },
  reverseArray: (arr: any[]) => [...arr].reverse(),
  findMax: (arr: number[]) => Math.max(...arr),
  removeDuplicates: (arr: any[]) => [...new Set(arr)],
  countVowels: (str: string) => (str.match(/[aeiou]/gi) || []).length,
  flatten: (arr: any[]) => arr.flat(1),
  toTitleCase: (str: string) =>
    str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()),
  isPrime: (n: number) => {
    if (n < 2) return false;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
    return true;
  },
  intersection: (a: any[], b: any[]) => [...new Set(a)].filter((x) => new Set(b).has(x)),
  groupBy: (arr: any[], key: string) => {
    const result: Record<string, any[]> = {};
    for (const item of arr) {
      const k = String(item[key]);
      (result[k] ??= []).push(item);
    }
    return result;
  },
  toRoman: (num: number) => {
    const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const syms = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
    let result = "";
    for (let i = 0; i < vals.length; i++) {
      while (num >= vals[i]) {
        result += syms[i];
        num -= vals[i];
      }
    }
    return result;
  },
  binarySearch: (arr: number[], target: number) => {
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (arr[mid] === target) return mid;
      if (arr[mid] < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  },
  longestCommonPrefix: (words: string[]) => {
    if (words.length === 0) return "";
    let prefix = words[0] ?? "";
    for (let i = 1; i < words.length; i++) {
      const w = words[i] ?? "";
      while (!w.startsWith(prefix)) {
        prefix = prefix.slice(0, -1);
        if (prefix === "") return "";
      }
    }
    return prefix;
  },
  isValidBrackets: (s: string) => {
    const stack: string[] = [];
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    for (const ch of s) {
      if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
      else if (ch in pairs) {
        if (stack.pop() !== pairs[ch]) return false;
      }
    }
    return stack.length === 0;
  },
  mergeIntervals: (intervals: number[][]) => {
    if (intervals.length === 0) return [];
    const sorted = intervals.map((x) => [...x]).sort((a, b) => a[0] - b[0]);
    const out: number[][] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const curr = sorted[i];
      const last = out[out.length - 1];
      if (curr[0] <= last[1]) last[1] = Math.max(last[1], curr[1]);
      else out.push(curr);
    }
    return out;
  },
  topKFrequent: (nums: number[], k: number) => {
    const m = new Map<number, number>();
    for (const n of nums) m.set(n, (m.get(n) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
      .slice(0, k)
      .map(([n]) => n);
  },
  coinChangeMin: (coins: number[], amount: number) => {
    const dp = Array(amount + 1).fill(Infinity);
    dp[0] = 0;
    for (let a = 1; a <= amount; a++) {
      for (const c of coins) {
        if (c <= a) dp[a] = Math.min(dp[a], dp[a - c] + 1);
      }
    }
    return Number.isFinite(dp[amount]) ? dp[amount] : -1;
  },
  editDistance: (a: string, b: string) => {
    const dp = Array.from({ length: a.length + 1 }, () =>
      Array<number>(b.length + 1).fill(0)
    );
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
        else {
          dp[i][j] = 1 + Math.min(
            dp[i - 1][j],
            dp[i][j - 1],
            dp[i - 1][j - 1]
          );
        }
      }
    }
    return dp[a.length][b.length];
  },
  simplifyPath: (path: string) => {
    const stack: string[] = [];
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return "/" + stack.join("/");
  },
  spiralOrder: (matrix: number[][]) => {
    const out: number[] = [];
    if (matrix.length === 0 || matrix[0].length === 0) return out;
    let top = 0;
    let bottom = matrix.length - 1;
    let left = 0;
    let right = matrix[0].length - 1;
    while (top <= bottom && left <= right) {
      for (let c = left; c <= right; c++) out.push(matrix[top][c]);
      top++;
      for (let r = top; r <= bottom; r++) out.push(matrix[r][right]);
      right--;
      if (top <= bottom) {
        for (let c = right; c >= left; c--) out.push(matrix[bottom][c]);
        bottom--;
      }
      if (left <= right) {
        for (let r = bottom; r >= top; r--) out.push(matrix[r][left]);
        left++;
      }
    }
    return out;
  },
  longestIncreasingSubsequence: (nums: number[]) => {
    const tails: number[] = [];
    for (const n of nums) {
      let lo = 0, hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tails[mid] < n) lo = mid + 1;
        else hi = mid;
      }
      tails[lo] = n;
    }
    return tails.length;
  },
  evalRPN: (tokens: string[]) => {
    const stack: number[] = [];
    for (const t of tokens) {
      if (t === "+" || t === "-" || t === "*" || t === "/") {
        const b = stack.pop()!;
        const a = stack.pop()!;
        if (t === "+") stack.push(a + b);
        else if (t === "-") stack.push(a - b);
        else if (t === "*") stack.push(a * b);
        else stack.push(Math.trunc(a / b));
      } else {
        stack.push(Number(t));
      }
    }
    return stack[0] ?? 0;
  },
  shortestPath: (graph: Record<string, string[]>, start: string, end: string) => {
    if (start === end) return 0;
    const queue: Array<[string, number]> = [[start, 0]];
    const visited = new Set<string>([start]);
    while (queue.length > 0) {
      const [node, dist] = queue.shift()!;
      for (const next of graph[node] ?? []) {
        if (visited.has(next)) continue;
        if (next === end) return dist + 1;
        visited.add(next);
        queue.push([next, dist + 1]);
      }
    }
    return -1;
  },
  hasCycle: (graph: Record<string, string[]>) => {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (node: string): boolean => {
      if (visiting.has(node)) return true;
      if (visited.has(node)) return false;
      visiting.add(node);
      for (const next of graph[node] ?? []) {
        if (dfs(next)) return true;
      }
      visiting.delete(node);
      visited.add(node);
      return false;
    };

    return Object.keys(graph).some((node) => dfs(node));
  },
  isValidBST: (root: any) => {
    const check = (node: any, min: number, max: number): boolean => {
      if (node === null) return true;
      if (node.val <= min || node.val >= max) return false;
      return check(node.left, min, node.val) && check(node.right, node.val, max);
    };
    return check(root, -Infinity, Infinity);
  },
  isValidSudoku: (board: number[][]) => {
    const rows = Array.from({ length: 9 }, () => new Set<number>());
    const cols = Array.from({ length: 9 }, () => new Set<number>());
    const boxes = Array.from({ length: 9 }, () => new Set<number>());

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = board[r][c];
        if (val === 0) continue;
        const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        if (rows[r].has(val) || cols[c].has(val) || boxes[box].has(val)) return false;
        rows[r].add(val);
        cols[c].add(val);
        boxes[box].add(val);
      }
    }
    return true;
  },
  maxSubarraySum: (arr: number[], k: number) => {
    if (k <= 0 || k > arr.length) return -1;
    let window = 0;
    for (let i = 0; i < k; i++) window += arr[i];
    let best = window;
    for (let i = k; i < arr.length; i++) {
      window += arr[i] - arr[i - k];
      best = Math.max(best, window);
    }
    return best;
  },
  autocomplete: (words: string[], prefix: string) =>
    words.filter((w) => w.startsWith(prefix)).sort((a, b) => a.localeCompare(b)),
  mergeKSorted: (arrays: number[][]) => arrays.flat().sort((a, b) => a - b),
  longestCommonSubsequence: (a: string, b: string) => {
    const dp = Array.from({ length: a.length + 1 }, () =>
      Array<number>(b.length + 1).fill(0)
    );
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[a.length][b.length];
  },
  calculate: (expression: string) => {
    const chars = expression.replace(/\s+/g, "");
    let num = 0;
    let op = "+";
    const stack: number[] = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (/\d/.test(ch)) {
        num = num * 10 + Number(ch);
      }
      if (!/\d/.test(ch) || i === chars.length - 1) {
        if (op === "+") stack.push(num);
        else if (op === "-") stack.push(-num);
        else if (op === "*") stack.push((stack.pop() ?? 0) * num);
        else if (op === "/") stack.push(Math.trunc((stack.pop() ?? 0) / num));
        op = ch;
        num = 0;
      }
    }
    return stack.reduce((sum, n) => sum + n, 0);
  },
  isMatch: (s: string, p: string) => {
    const m = s.length;
    const n = p.length;
    const dp = Array.from({ length: m + 1 }, () => Array<boolean>(n + 1).fill(false));
    dp[0][0] = true;
    for (let j = 2; j <= n; j++) {
      if (p[j - 1] === "*") dp[0][j] = dp[0][j - 2];
    }
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const pc = p[j - 1];
        if (pc === "." || pc === s[i - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else if (pc === "*") {
          dp[i][j] = dp[i][j - 2];
          const prev = p[j - 2];
          if (prev === "." || prev === s[i - 1]) {
            dp[i][j] = dp[i][j] || dp[i - 1][j];
          }
        }
      }
    }
    return dp[m][n];
  },
};

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a as Record<string, unknown>).sort();
    const keysB = Object.keys(b as Record<string, unknown>).sort();
    if (!deepEqual(keysA, keysB)) return false;
    return keysA.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    );
  }
  return false;
}

describe("coding dataset test cases validation", () => {
  it("has a reference implementation for every coding task", () => {
    const missing = tasks
      .map((task) => task.functionName)
      .filter((name) => !implementations[name]);
    expect(missing).toHaveLength(0);
  });

  for (const task of tasks) {
    describe(`${task.functionName} (task ${task.id})`, () => {
      const impl = implementations[task.functionName];
      if (!impl) {
        it(`missing reference implementation for ${task.functionName}`, () => {
          expect(typeof impl).toBe("function");
        });
        return;
      }

      for (let i = 0; i < task.tests.length; i++) {
        const test = task.tests[i];
        it(`test case ${i + 1}: ${JSON.stringify(test.input)} → ${JSON.stringify(test.expected)}`, () => {
          const result = impl(...(test.input as any[]));
          expect(deepEqual(result, test.expected)).toBe(true);
        });
      }
    });
  }
});
