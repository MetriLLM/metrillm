import { abortOngoingRequests, generate } from "../core/runtime.js";
import type { CategoryResult, ReasoningQuestion, QuestionResult } from "../types.js";
import { extractChoice, stripThinkTags, toBenchmarkFailureLabel, withTimeout } from "../utils.js";
import { createSpinner } from "../ui/progress.js";
import reasoningData from "../datasets/reasoning.json" with { type: "json" };

const questions = reasoningData as ReasoningQuestion[];
const DEFAULT_REASONING_TIMEOUT_MS = 120_000;

export async function runReasoningBench(
  model: string,
  opts?: { think?: boolean; timeoutMs?: number }
): Promise<CategoryResult> {
  const spinner = createSpinner("Running reasoning benchmark...");
  spinner.start();

  const details: QuestionResult[] = [];
  let correct = 0;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_REASONING_TIMEOUT_MS;

  try {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      spinner.text = `Reasoning ${i + 1}/${questions.length}: ${q.category}`;

      const prompt = `Answer the following multiple choice question. Reply with ONLY the letter (A, B, C, or D).

Question: ${q.question}
${q.choices.join("\n")}

Answer:`;

      const startTime = Date.now();
      try {
        const result = await withTimeout(
          generate(model, prompt, { temperature: 0, num_predict: 1024, think: opts?.think }),
          timeoutMs,
          "Reasoning question",
          abortOngoingRequests
        );

        const answer = stripThinkTags(result.response);
        const actual = extractChoice(answer) ?? answer.trim();
        const isCorrect = actual === q.answer;
        if (isCorrect) correct++;

        details.push({
          id: q.id,
          question: q.question,
          expected: q.answer,
          actual,
          correct: isCorrect,
          timeMs: Date.now() - startTime,
        });
      } catch (err) {
        details.push({
          id: q.id,
          question: q.question,
          expected: q.answer,
          actual: toBenchmarkFailureLabel(err),
          correct: false,
          timeMs: Date.now() - startTime,
        });
      }
    }

    spinner.succeed(`Reasoning: ${correct}/${questions.length} correct`);
  } catch (err) {
    spinner.fail("Reasoning benchmark failed");
    throw err;
  }

  return {
    score: questions.length > 0 ? (correct / questions.length) * 100 : 0,
    correct,
    total: questions.length,
    details,
  };
}
