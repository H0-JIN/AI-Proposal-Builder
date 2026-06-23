import OpenAI from 'openai';

export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY가 설정되어 있지 않습니다. .env.local 파일을 확인하세요.');
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function createStructuredJson<T>({
  schemaName,
  schema,
  system,
  user,
  timeoutMs,
  maxRetries,
}: {
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  timeoutMs?: number;
  // Per-request retry cap. Omit to keep the SDK default; pass 0 to disable, 1 for a single safe retry on
  // transient/timeout errors. Kept explicit (and small) so timeouts never balloon past the route's maxDuration.
  maxRetries?: number;
}): Promise<T> {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const requestOptions: { timeout?: number; maxRetries?: number } = {};
  if (timeoutMs) requestOptions.timeout = timeoutMs;
  if (maxRetries !== undefined) requestOptions.maxRetries = maxRetries;

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: true,
        schema,
      },
    },
    temperature: 0.4,
  }, Object.keys(requestOptions).length ? requestOptions : undefined);

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI 응답이 비어 있습니다.');
  }

  return JSON.parse(content) as T;
}
