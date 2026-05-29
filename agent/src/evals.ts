/**
 * Basic eval suite for the customer support agent.
 *
 * Run before deploying a new prompt or tool change to catch regressions:
 *   npx tsx src/evals.ts
 *
 * Exit code 0 = pass, 1 = fail. Wire this into CI to gate deployments.
 *
 * This is a lightweight hand-rolled runner. For a full eval framework with
 * reporting, latency distributions, and synthetic data generation, see:
 * https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-for-production-a-practical-guide-to-strands-evals/
 */

import { createAgent } from './agent.js';

interface EvalCase {
  name: string;
  input: string;
  /** Tool that must be called at least once for the case to pass. */
  expectedTool?: string;
  /** Substring that must appear in the final response text. */
  expectedOutput?: string;
}

const suite: EvalCase[] = [
  {
    name: 'order lookup — no filter',
    input: 'What are my recent orders?',
    expectedTool: 'get_user_orders',
  },
  {
    name: 'order lookup — status filter',
    input: 'Show me my shipped orders',
    expectedTool: 'get_user_orders',
  },
  {
    name: 'product search',
    input: 'Do you have any keyboards in stock?',
    expectedTool: 'get_product_info',
  },
  {
    name: 'support ticket creation',
    input: 'I need to return my headphones, they stopped working',
    expectedTool: 'create_support_ticket',
  },
  {
    name: 'out of scope — polite refusal',
    input: 'What is the capital of France?',
    expectedOutput: "can't help",
  },
];

async function runEvals() {
  let passed = 0;
  let failed = 0;

  for (const evalCase of suite) {
    const agent = createAgent();
    const toolsCalled: string[] = [];

    // Intercept tool calls to track which tools were used
    const { BeforeToolCallEvent } = await import('@strands-agents/sdk');
    agent.addHook(BeforeToolCallEvent, (event) => {
      toolsCalled.push(event.toolUse.name);
    });

    let responseText = '';
    try {
      for await (const event of agent.stream(evalCase.input, { invocationState: { userId: 'eval-user' } })) {
        if (
          event.type === 'modelStreamUpdateEvent' &&
          event.event.type === 'modelContentBlockDeltaEvent' &&
          event.event.delta.type === 'textDelta'
        ) {
          responseText += event.event.delta.text;
        }
      }

      let pass = true;
      const reasons: string[] = [];

      if (evalCase.expectedTool && !toolsCalled.includes(evalCase.expectedTool)) {
        pass = false;
        reasons.push(`expected tool '${evalCase.expectedTool}' not called (got: [${toolsCalled.join(', ')}])`);
      }

      if (evalCase.expectedOutput && !responseText.toLowerCase().includes(evalCase.expectedOutput.toLowerCase())) {
        pass = false;
        reasons.push(`expected output '${evalCase.expectedOutput}' not found in response`);
      }

      if (pass) {
        console.log(`  ✓ ${evalCase.name}`);
        passed++;
      } else {
        console.log(`  ✗ ${evalCase.name}`);
        reasons.forEach(r => console.log(`      → ${r}`));
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ ${evalCase.name} (threw: ${err})`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed}/${suite.length} passed`);
  const passRate = passed / suite.length;

  // Fail CI if pass rate drops below 80%
  const PASS_THRESHOLD = 0.8;
  if (passRate < PASS_THRESHOLD) {
    console.error(`Pass rate ${(passRate * 100).toFixed(0)}% is below threshold ${PASS_THRESHOLD * 100}%`);
    process.exit(1);
  }

  console.log(`Pass rate: ${(passRate * 100).toFixed(0)}% ✓`);
}

runEvals().catch(err => {
  console.error('Eval runner failed:', err);
  process.exit(1);
});
