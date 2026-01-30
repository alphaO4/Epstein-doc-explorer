/**
 * Unified LLM Client for Local and Remote AI Endpoints
 *
 * Supports:
 * - Local OpenAI-compatible endpoints (Ollama, LM Studio, vLLM, llama.cpp, etc.)
 * - OpenRouter
 * - OpenAI API
 * - Anthropic Claude API (optional)
 *
 * Configuration via environment variables:
 * - LLM_PROVIDER: 'local' | 'openrouter' | 'openai' | 'anthropic' (default: 'local')
 * - LLM_BASE_URL: Base URL for the API (default: 'http://localhost:11434/v1' for Ollama)
 * - LLM_API_KEY: API key (not needed for most local endpoints)
 * - LLM_MODEL: Model name (default: 'llama3.2' for local, varies by provider)
 */

import 'dotenv/config';

// ============= Configuration =============

export type LLMProvider = 'local' | 'openrouter' | 'openai' | 'anthropic';

export interface LLMConfig {
  provider: LLMProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

// Default configurations per provider
const DEFAULT_CONFIGS: Record<LLMProvider, Partial<LLMConfig>> = {
  local: {
    baseUrl: 'http://localhost:11434/v1', // Ollama default
    apiKey: 'not-needed',
    model: 'llama3.2',
    maxTokens: 16000,
    temperature: 0.1,
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.1-8b-instruct',
    maxTokens: 16000,
    temperature: 0.1,
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    maxTokens: 16000,
    temperature: 0.1,
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-haiku-latest',
    maxTokens: 16000,
    temperature: 0.1,
  },
};

export function getConfig(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || 'local') as LLMProvider;
  const defaults = DEFAULT_CONFIGS[provider];

  return {
    provider,
    baseUrl: process.env.LLM_BASE_URL || defaults.baseUrl!,
    apiKey: process.env.LLM_API_KEY || defaults.apiKey || '',
    model: process.env.LLM_MODEL || defaults.model!,
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '') || defaults.maxTokens!,
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '') || defaults.temperature!,
  };
}

// ============= Response Types =============

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  usage: LLMUsage | null;
  finishReason: string | null;
}

export interface LLMQueryOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

// ============= OpenAI-Compatible Client =============

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

async function queryOpenAICompatible(
  prompt: string,
  config: LLMConfig,
  options: LLMQueryOptions = {}
): Promise<LLMResponse> {
  const messages: OpenAIMessage[] = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey && config.apiKey !== 'not-needed') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // OpenRouter requires additional headers
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/epstein-doc-explorer';
    headers['X-Title'] = 'Epstein Document Explorer';
  }

  const body = {
    model: options.model || config.model,
    messages,
    max_tokens: options.maxTokens || config.maxTokens,
    temperature: options.temperature ?? config.temperature,
  };

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const data: OpenAIResponse = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from LLM');
  }

  return {
    content: data.choices[0].message.content,
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : null,
    finishReason: data.choices[0].finish_reason,
  };
}

// ============= Anthropic Client =============

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

async function queryAnthropic(
  prompt: string,
  config: LLMConfig,
  options: LLMQueryOptions = {}
): Promise<LLMResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  };

  const body: Record<string, unknown> = {
    model: options.model || config.model,
    max_tokens: options.maxTokens || config.maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };

  if (options.systemPrompt) {
    body.system = options.systemPrompt;
  }

  const response = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data: AnthropicResponse = await response.json();

  const textContent = data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');

  return {
    content: textContent,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    },
    finishReason: data.stop_reason,
  };
}

// ============= Main Query Function =============

/**
 * Send a prompt to the configured LLM and get a response.
 *
 * @param prompt - The prompt to send
 * @param options - Optional query options (model, maxTokens, etc.)
 * @returns The LLM response
 */
export async function query(
  prompt: string,
  options: LLMQueryOptions = {}
): Promise<LLMResponse> {
  const config = getConfig();

  console.log(`[LLM] Using ${config.provider} provider with model: ${options.model || config.model}`);

  if (config.provider === 'anthropic') {
    return queryAnthropic(prompt, config, options);
  } else {
    // All other providers use OpenAI-compatible API
    return queryOpenAICompatible(prompt, config, options);
  }
}

/**
 * Extract JSON from LLM response that might be wrapped in markdown code blocks
 */
export function extractJSON(text: string): string {
  // Try to find JSON in markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0].trim();
  }

  // Try to find raw JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0].trim();
  }

  return text.trim();
}

/**
 * Parse JSON from LLM response with error handling
 */
export function parseJSONResponse<T>(text: string): T {
  const jsonText = extractJSON(text);
  return JSON.parse(jsonText) as T;
}

// ============= Batch Processing Utilities =============

export interface BatchOptions {
  batchSize?: number;
  delayMs?: number;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Process items in batches with configurable parallelism
 */
export async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: BatchOptions = {}
): Promise<R[]> {
  const { batchSize = 5, delayMs = 100, onProgress } = options;
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    if (onProgress) {
      onProgress(Math.min(i + batchSize, items.length), items.length);
    }

    // Add delay between batches to avoid overwhelming the API
    if (i + batchSize < items.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

// ============= Model Information =============

/**
 * Get the currently configured model name
 */
export function getModelName(): string {
  const config = getConfig();
  return process.env.LLM_MODEL || config.model;
}

/**
 * Print current LLM configuration
 */
export function printConfig(): void {
  const config = getConfig();
  console.log('\n=== LLM Configuration ===');
  console.log(`Provider: ${config.provider}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Model: ${config.model}`);
  console.log(`Max Tokens: ${config.maxTokens}`);
  console.log(`Temperature: ${config.temperature}`);
  console.log(`API Key: ${config.apiKey ? '***configured***' : 'not set'}`);
  console.log('========================\n');
}
