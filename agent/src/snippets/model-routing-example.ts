import { Agent } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';

// Two models: one cheap, one smart.
// Both use cross-region inference profile IDs (us.* prefix) for on-demand throughput.
const cheapModel = new BedrockModel({ modelId: 'us.amazon.nova-micro-v1:0' });
const smartModel = new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' });

// Simple heuristic: short messages or keyword matches go to the cheap model.
function isSimpleQuery(message: string): boolean {
  if (message.length < 80) return true;
  return /\b(status|price|available|in stock|how much|what is|show me|list my)\b/i.test(message);
}

// Route per-request based on query complexity.
const message = 'What are my recent orders?';
const model = isSimpleQuery(message) ? cheapModel : smartModel;

const agent = new Agent({ model, systemPrompt: 'You are a helpful assistant.' });
