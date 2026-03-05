// ── Hardware ──────────────────────────────────────────────
export interface HardwareInfo {
  cpu: string;
  cpuCores: number;
  cpuPCores: number | null;
  cpuECores: number | null;
  cpuFreqGHz: number | null;
  totalMemoryGB: number;
  freeMemoryGB: number;
  memoryType: string | null;
  swapTotalGB: number;
  swapUsedGB: number;
  gpu: string;
  gpuCores: number | null;
  gpuVramMB: number | null;
  os: string;
  arch: string;
  machineModel?: string | null;
  powerMode?: "low-power" | "balanced" | "performance" | "unknown";
  cpuCurrentSpeedGHz?: number | null;
}

// ── Ollama model ─────────────────────────────────────────
export interface OllamaModel {
  name: string;
  size: number; // bytes
  parameterSize?: string;
  quantization?: string;
  family?: string;
  runtimeStatus?: string;
  modelFormat?: string; // exact runtime-reported weight format, for example: gguf, mlx, safetensors, ggml
}

export interface OllamaRunningModel {
  name: string;
  size: number;
  vramUsed: number;
}

// ── Performance metrics ──────────────────────────────────
export interface PerformanceMetrics {
  tokensPerSecond: number;
  tokensPerSecondEstimated?: boolean; // true when throughput falls back to heuristic token estimation
  firstChunkMs?: number; // ms — network/runtime latency until first streamed chunk
  ttft: number; // ms — time to first token
  loadTime: number; // ms — model load time
  loadTimeAvailable?: boolean; // false when runtime cannot report model load duration
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  memoryUsedGB: number; // model memory footprint delta (GB)
  memoryPercent: number; // model memory footprint delta (% of total RAM)
  memoryFootprintAvailable?: boolean; // false when model was already loaded and runtime can't provide per-model size
  memoryFootprintEstimated?: boolean; // true when the value comes from an LM Studio CLI estimate rather than direct measurement
  memoryHostUsedGB?: number; // host absolute RAM used after benchmark (GB)
  memoryHostPercent?: number; // host absolute RAM usage after benchmark (%)
  tpsStdDev?: number; // standard deviation of per-prompt tok/s values
  thinkingTokensEstimate?: number; // estimated thinking tokens (whitespace split)
}

// ── Quality metrics ──────────────────────────────────────
export interface QualityMetrics {
  reasoning: CategoryResult;
  math: CategoryResult;
  coding: CategoryResult;
  instructionFollowing: CategoryResult;
  structuredOutput: CategoryResult;
  multilingual: CategoryResult;
}

export interface CategoryResult {
  score: number; // 0-100
  correct: number;
  total: number;
  details: QuestionResult[];
}

export interface QuestionResult {
  id: number;
  question: string;
  expected: string;
  actual: string;
  correct: boolean;
  timeMs: number;
}

// ── Datasets ─────────────────────────────────────────────
export interface ReasoningQuestion {
  id: number;
  question: string;
  choices: string[];
  answer: string; // "A" | "B" | "C" | "D"
  category: string;
}

export interface MathProblem {
  id: number;
  question: string;
  answer: number;
  tolerance?: number;
}

export interface CodingTask {
  id: number;
  description: string;
  functionName: string;
  signature: string;
  difficulty?: "easy" | "medium" | "hard";
  tests: CodingTest[];
}

export interface CodingTest {
  input: unknown[];
  expected: unknown;
}

// ── Scoring ──────────────────────────────────────────────
export interface PerformanceScore {
  total: number; // 0-100
  speed: number; // 0-50
  ttft: number; // 0-20
  memory: number; // 0-30
}

export interface QualityScore {
  total: number; // 0-100
  reasoning: number; // 0-20
  coding: number; // 0-20
  instructionFollowing: number; // 0-20
  structuredOutput: number; // 0-15
  math: number; // 0-15
  multilingual: number; // 0-10
  timePenalties?: Record<string, number>; // nb of penalized answers per category
}

export interface HardwareFitTuning {
  profile: "ENTRY" | "BALANCED" | "HIGH-END";
  speed: {
    excellent: number;
    good: number;
    marginal: number;
    hardMin: number;
  };
  ttft: {
    excellentMs: number;
    goodMs: number;
    marginalMs: number;
    hardMaxMs: number;
  };
  loadTimeHardMaxMs: number;
}

export type FitnessVerdict =
  | "EXCELLENT"
  | "GOOD"
  | "MARGINAL"
  | "NOT RECOMMENDED";

export type CategoryLevel = "Strong" | "Adequate" | "Weak" | "Poor";

export interface CategoryLabel {
  category: string;
  rawScore: number;
  level: CategoryLevel;
}

export interface FitnessResult {
  verdict: FitnessVerdict;
  globalScore: number | null; // 0-100 (null if quality absent)
  hardwareFitScore: number; // 0-100 (performance only)
  performanceScore: PerformanceScore;
  qualityScore: QualityScore | null;
  categoryLabels: CategoryLabel[] | null;
  disqualifiers: string[];
  warnings: string[];
  interpretation: string;
  tuning: HardwareFitTuning;
}

// ── Run metadata ────────────────────────────────────────
export interface RunMetadata {
  benchmarkSpecVersion: string;
  promptPackVersion: string;
  runtimeVersion: string;    // Ollama version (e.g. "0.5.12")
  runtimeBackend?: string;   // "ollama" | "lm-studio" | "mlx" | "llamacpp" | "vllm"
  modelFormat?: string;      // exact runtime-reported format, for example: gguf, mlx, safetensors, onnx, ggml
  benchmarkProfile?: BenchmarkProfileMetadata;
  rawLogHash: string;        // SHA-256 hex digest of the serialised result (excl. this field)
}

export interface BenchmarkProfileMetadata {
  version: string;
  sampling: {
    temperature: number;
    topP: number;
    seed: number;
  };
  thinkingMode: "enabled" | "disabled";
  contextWindowTokens: number | null;
  contextPolicy: "runtime-default";
}

// ── Model info ──────────────────────────────────────────
export interface ModelInfo {
  parameterSize?: string;  // e.g. "8B"
  quantization?: string;   // e.g. "Q4_0"
  family?: string;         // e.g. "llama"
  // True when benchmark ran in thinking mode, false when run in non-thinking mode.
  thinkingDetected?: boolean;
}

export interface SubmitterIdentity {
  nickname: string;
  emailHash: string;
}

// ── Bench environment context ────────────────────────────
export interface BenchEnvironment {
  thermalPressureBefore?: "nominal" | "moderate" | "heavy" | "critical" | "unknown";
  thermalPressureAfter?: "nominal" | "moderate" | "heavy" | "critical" | "unknown";
  swapDeltaGB?: number;
  batteryPowered?: boolean;
  cpuAvgLoad?: number;
  cpuPeakLoad?: number;
}

// ── Bench result ─────────────────────────────────────────
export interface BenchResult {
  model: string;
  modelInfo?: ModelInfo;
  hardware: HardwareInfo;
  performance: PerformanceMetrics;
  quality: QualityMetrics | null;
  fitness: FitnessResult;
  benchEnvironment?: BenchEnvironment;
  timestamp: string;
  metadata: RunMetadata;
  submitter?: SubmitterIdentity;
}
