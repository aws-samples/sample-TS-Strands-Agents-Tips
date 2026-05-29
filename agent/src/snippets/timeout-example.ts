import { Agent } from '@strands-agents/sdk';

// Timeout pattern: kill the agent if it's still running after 25 seconds.
// agent.cancel() uses AbortSignal under the hood.

const agent = new Agent({ systemPrompt: 'You are a helpful assistant.' });
const message = 'What are my recent orders?';
const userId = 'user-123';

const timeout = setTimeout(() => agent.cancel(), 25_000);

try {
  const result = await agent.invoke(message, { invocationState: { userId } });
  // result.stopReason === 'cancelled' if it timed out
} finally {
  clearTimeout(timeout);
}
