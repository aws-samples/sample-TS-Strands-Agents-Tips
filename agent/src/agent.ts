import { Agent, SlidingWindowConversationManager } from '@strands-agents/sdk';
import type { SessionManager } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { httpRequest } from '@strands-agents/sdk/vended-tools/http-request';
import { notebook } from '@strands-agents/sdk/vended-tools/notebook';
import { getUserOrders, getProductInfo, createSupportTicket } from './tools.js';

// Enable OpenTelemetry tracing if the packages are installed.
// Two levels of observability:
//     Set TRACE_CONSOLE=1 in dev to see spans in the terminal.
try {
  const { setupTracer } = await import('@strands-agents/sdk/telemetry');
  setupTracer({
    exporters: {
      otlp: !process.env.TRACE_CONSOLE,   // OTLP → CloudWatch GenAI Observability in production
      console: !!process.env.TRACE_CONSOLE, // console output in dev
    },
  });
} catch {
  // OpenTelemetry packages not installed — tracing disabled
}






// Model routing: two pre-built model instances, chosen per-request in index.ts.
// Nova Micro handles simple queries cheaply; Sonnet handles complex reasoning.
// Both use cross-region inference profile IDs (required for on-demand throughput).
// Check https://aws.amazon.com/bedrock/pricing/ for current rates.
export const NOVA_MICRO = new BedrockModel({ modelId: 'us.amazon.nova-micro-v1:0' });
export const CLAUDE_SONNET = new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' });

/**
 * Returns true for short, keyword-simple messages that don't need a large model.
 * Tune this to your traffic — even routing 30% of requests to Nova Micro
 * meaningfully reduces cost at scale.
 */
export function isSimpleQuery(message: string): boolean {
  if (message.length < 80) return true;
  return /\b(status|price|available|in stock|how much|what is|show me|list my)\b/i.test(message);
}

/**
 * Creates a configured agent with production features:
 * - Optional model override for cost routing (pass NOVA_MICRO or CLAUDE_SONNET)
 * - SessionManager for persisting conversation state across requests
 * - SlidingWindowConversationManager to prevent context window overflow
 *
 * userId is NOT stored in appState here. Pass it per-request via invocationState:
 *   agent.stream(message, { invocationState: { userId } })
 *   agent.invoke(message, { invocationState: { userId } })
 *
 * invocationState is request-scoped (resets each call), so there's no risk of
 * cross-request leakage when the agent instance is reused across requests.
 *
 * Portable: same code works from Express, Lambda, AgentCore, or a test script.
 */
export function createAgent(opts: { model?: BedrockModel; sessionManager?: SessionManager } = {}) {
  const agent = new Agent({
    model: opts.model,
    systemPrompt: `You are a helpful customer support assistant for an online store.
You can look up orders, search for products, and create support tickets.
You can also make HTTP requests to check external services and use a notebook to track multi-step tasks.
Be concise and friendly. When showing orders or products, format them clearly.
If the user asks something you can't help with, let them know politely.`,
    tools: [getUserOrders, getProductInfo, createSupportTicket, httpRequest, notebook],
    printer: false,
    conversationManager: new SlidingWindowConversationManager({ windowSize: 40 }),
    sessionManager: opts.sessionManager,
  });

  return agent;
}
