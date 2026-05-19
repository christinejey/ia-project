export interface QueueMsg {
  userId: string;
  chatId: string;
  content: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ContextEntry {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Env {
  AI: Ai;
  KV_CHATS: KVNamespace;
  KV_CONTEXT: KVNamespace;
  KV_CONFIG: KVNamespace;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DEFAULT_SYSTEM = 'You are a helpful AI assistant.';
const MAX_CONTEXT = 20;

async function getMessages(kv: KVNamespace, userId: string, chatId: string): Promise<Message[]> {
  const raw = await kv.get(`messages:${userId}:${chatId}`);
  return raw ? (JSON.parse(raw) as Message[]) : [];
}

async function getContext(kv: KVNamespace, chatId: string): Promise<ContextEntry[]> {
  const raw = await kv.get(`context:${chatId}`);
  return raw ? (JSON.parse(raw) as ContextEntry[]) : [];
}

// Calls Workers AI with a dynamic model string.
// Ai.run is overloaded per model literal, so a cast is needed for runtime-configured models.
async function runAI(
  ai: Ai,
  model: string,
  messages: ContextEntry[],
): Promise<string> {
  type ChatInput = { messages: ContextEntry[] };
  type ChatOutput = { response?: string } | ReadableStream;
  const run = ai.run.bind(ai) as (model: string, input: ChatInput) => Promise<ChatOutput>;
  const out = await run(model, { messages });
  if (out instanceof ReadableStream) return '';
  return out.response?.trim() ?? '';
}

async function processMessage(body: QueueMsg, env: Env): Promise<void> {
  const { userId, chatId, content } = body;

  const [model, systemPrompt, context] = await Promise.all([
    env.KV_CONFIG.get('config:model').then(v => v ?? DEFAULT_MODEL),
    env.KV_CONFIG.get('config:system').then(v => v ?? DEFAULT_SYSTEM),
    getContext(env.KV_CONTEXT, chatId),
  ]);

  // Append user message and trim to MAX_CONTEXT before sending to AI
  const updatedCtx: ContextEntry[] = [...context, { role: 'user' as const, content }].slice(-MAX_CONTEXT);

  const reply =
    (await runAI(env.AI, model, [{ role: 'system', content: systemPrompt }, ...updatedCtx])) ||
    'Sorry, I could not generate a response.';

  // Write assistant message to KV_CHATS so the SSE stream picks it up
  const messages = await getMessages(env.KV_CHATS, userId, chatId);
  messages.push({
    id: crypto.randomUUID(),
    role: 'assistant',
    content: reply,
    timestamp: Date.now(),
  });
  await env.KV_CHATS.put(`messages:${userId}:${chatId}`, JSON.stringify(messages));

  // Persist updated context (user turn + assistant reply)
  const nextCtx: ContextEntry[] = [...updatedCtx, { role: 'assistant' as const, content: reply }].slice(
    -MAX_CONTEXT,
  );
  await env.KV_CONTEXT.put(`context:${chatId}`, JSON.stringify(nextCtx));
}

export default {
  async queue(batch: MessageBatch<QueueMsg>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processMessage(msg.body, env);
        msg.ack();
      } catch (err) {
        console.error('agent: failed to process message', err);
        msg.retry();
      }
    }
  },
};
