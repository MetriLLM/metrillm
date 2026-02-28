import { abortOngoingRequests, generate } from "../core/runtime.js";
import type { CategoryResult, MathProblem, QuestionResult } from "../types.js";
import { extractNumber, stripThinkTags, toBenchmarkFailureLabel, withTimeout } from "../utils.js";
import { createSpinner } from "../ui/progress.js";
import mathData from "../datasets/math.json" with { type: "json" };

const problems = mathData as MathProblem[];

export async function runMathBench(model: string): Promise<CategoryResult> {
  const spinner = createSpinner("Running math benchmark...");
  spinner.start();

  const details: QuestionResult[] = [];
  let correct = 0;

  for (let i = 0; i < problems.length; i++) {
    const p = problems[i];
    spinner.text = `Math ${i + 1}/${problems.length}`;

    const prompt = `Solve the following math problem. Give ONLY the numerical answer, nothing else.

Problem: ${p.question}

Answer:`;

    const startTime = Date.now();
    try {
      const result = await withTimeout(
        generate(model, prompt, { temperature: 0, num_predict: 1024 }),
        60_000,
        "Math problem",
        abortOngoingRequests
      );

      const actual = extractNumber(stripThinkTags(result.response));
      // Use absolute tolerance only when explicitly provided by the dataset.
      // Relative tolerance was overly permissive on large values.
      const tolerance = p.tolerance ?? 0;
      const isCorrect =
        actual !== null && Math.abs(actual - p.answer) <= tolerance;

      if (isCorrect) correct++;

      details.push({
        id: p.id,
        question: p.question,
        expected: String(p.answer),
        actual: actual !== null ? String(actual) : result.response.trim(),
        correct: isCorrect,
        timeMs: Date.now() - startTime,
      });
    } catch (err) {
      details.push({
        id: p.id,
        question: p.question,
        expected: String(p.answer),
        actual: toBenchmarkFailureLabel(err),
        correct: false,
        timeMs: Date.now() - startTime,
      });
    }
  }

  spinner.succeed(`Math: ${correct}/${problems.length} correct`);

  return {
    score: problems.length > 0 ? (correct / problems.length) * 100 : 0,
    correct,
    total: problems.length,
    details,
  };
}
