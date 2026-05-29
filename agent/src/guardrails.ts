import {
  Agent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
} from '@strands-agents/sdk';

/**
 * Adds production guardrails to an agent using Strands lifecycle hooks.
 *
 * - Tool call budget: max calls per request before the agent is stopped.
 *   Uses invocationState (request-scoped) so the counter resets automatically
 *   on each new agent.stream()/invoke() call — no cross-request bleed.
 * - Destructive operation blocking: prevents delete/drop tools
 * - Single retry on tool failure
 * - Request timeout via AbortSignal
 *
 * Returns a cleanup function that removes all hooks (React useEffect pattern).
 */
export function addGuardrails(agent: Agent, opts: { maxToolCalls?: number } = {}) {
  const maxToolCalls = opts.maxToolCalls ?? 20;
  const cleanups: (() => void)[] = [];

  // Before each tool call: enforce budget and block destructive ops.
  // event.invocationState is the same object threaded through all hooks and tools
  // for this single invocation — mutations here are visible to subsequent hooks.
  cleanups.push(
    agent.addHook(BeforeToolCallEvent, (event) => {
      const toolName = event.toolUse.name;

      // Block destructive operations — check common destructive prefixes/patterns
      const destructivePrefixes = ['delete_', 'drop_', 'remove_', 'purge_', 'destroy_', 'truncate_'];
      if (destructivePrefixes.some(p => toolName.startsWith(p))) {
        event.cancel = 'Destructive operations are not allowed in this session';
        return;
      }

      // Enforce tool call budget (invocationState resets each request)
      const count = (event.invocationState.toolCallCount as number) ?? 0;
      event.invocationState.toolCallCount = count + 1;

      if (count + 1 > maxToolCalls) {
        event.cancel = `Tool call budget exceeded (max ${maxToolCalls} per request)`;
      }
    })
  );

  // After each tool call: retry once on failure
  cleanups.push(
    agent.addHook(AfterToolCallEvent, (event) => {
      if (event.error && !event.retry) {
        // Retry the tool once. If it fails again, event.retry won't be set
        // so it won't loop.
        event.retry = true;
      }
    })
  );

  // Return cleanup function that removes all hooks
  return () => cleanups.forEach(fn => fn());
}

/**
 * Sets a timeout on an agent invocation.
 * Uses the web-standard AbortSignal pattern.
 * Tools can pass agent.cancelSignal to fetch() for cooperative cancellation.
 */
export function withTimeout(agent: Agent, ms: number): NodeJS.Timeout {
  return setTimeout(() => agent.cancel(), ms);
}
