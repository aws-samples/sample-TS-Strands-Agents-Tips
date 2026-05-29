import express from 'express';
import cors from 'cors';
import { createAgent, isSimpleQuery, NOVA_MICRO, CLAUDE_SONNET } from './agent.js';
import { addGuardrails, withTimeout } from './guardrails.js';
import { AgentCoreMemory } from './agentcore-memory.js';

const app = express();
const PORT = process.env.PORT || 3001;
const REQUEST_TIMEOUT_MS = 25_000;
const AGENTCORE_MEMORY_ID = process.env.AGENTCORE_MEMORY_ID || 'tsagenttest-RQli683MiI';
const AGENTCORE_REGION = process.env.AWS_REGION || 'us-west-2';

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

app.get('/ping', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/chat', async (req, res) => {
  const { message, userId, sessionId } = req.body;

  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const sid = sessionId || `session-${Date.now()}`;
  // ⚠️ DEMO ONLY: In production, never accept userId from the request body.
  // The userId should come from your authenticated session (e.g., Cognito JWT claims),
  // not from user-controlled input. See the AgentCore /invocations handler below for
  // the production pattern where userId is extracted from the verified Cognito token
  // by the Lambda before the request reaches the agent.
  const uid = userId || 'demo-user';

  // AgentCore Memory persists conversation history across requests.
  // Swap region/memoryId via env vars for different environments.
  const memory = new AgentCoreMemory({
    memoryId: AGENTCORE_MEMORY_ID,
    actorId: uid,
    sessionId: sid,
    region: AGENTCORE_REGION,
  });

  // Route to a cheaper model for simple queries — Nova Micro is significantly
  // cheaper than Sonnet and supports tool calling via the Converse API.
  const agent = createAgent({ model: isSimpleQuery(message) ? NOVA_MICRO : CLAUDE_SONNET });
  await memory.loadHistory(agent);

  const cleanupGuardrails = addGuardrails(agent, { maxToolCalls: 20 });
  const timeout = withTimeout(agent, REQUEST_TIMEOUT_MS);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.socket?.setNoDelay(true);
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let agentResult;
    let thinkingDepth = 0;
    let tagBuffer = '';

    for await (const event of agent.stream(message, { invocationState: { userId: uid } })) {
      if (
        event.type === 'modelStreamUpdateEvent' &&
        event.event.type === 'modelContentBlockDeltaEvent' &&
        event.event.delta.type === 'textDelta'
      ) {
        const text = event.event.delta.text;

        // Buffer text to detect <thinking> and </thinking> tags that arrive across chunks
        tagBuffer += text;

        // Check for opening tags
        while (tagBuffer.includes('<thinking>')) {
          const idx = tagBuffer.indexOf('<thinking>');
          // Send any text before the tag (if not inside thinking)
          if (thinkingDepth === 0 && idx > 0) {
            send({ type: 'text', content: tagBuffer.slice(0, idx) });
          }
          tagBuffer = tagBuffer.slice(idx + '<thinking>'.length);
          thinkingDepth++;
        }

        // Check for closing tags
        while (tagBuffer.includes('</thinking>')) {
          const idx = tagBuffer.indexOf('</thinking>');
          tagBuffer = tagBuffer.slice(idx + '</thinking>'.length);
          thinkingDepth = Math.max(0, thinkingDepth - 1);
        }

        // If not inside thinking and no partial tag, flush the buffer
        if (thinkingDepth === 0) {
          // Keep potential partial tags in the buffer (anything starting with '<')
          const lastAngle = tagBuffer.lastIndexOf('<');
          if (lastAngle === -1) {
            if (tagBuffer) send({ type: 'text', content: tagBuffer });
            tagBuffer = '';
          } else if (lastAngle === 0) {
            // Entire buffer might be a partial tag — hold it
          } else {
            send({ type: 'text', content: tagBuffer.slice(0, lastAngle) });
            tagBuffer = tagBuffer.slice(lastAngle);
          }
        }
      }

      if (event.type === 'beforeToolCallEvent') {
        send({ type: 'tool_start', tool: event.toolUse.name });
      }

      if (event.type === 'afterToolCallEvent') {
        send({ type: 'tool_end', tool: event.toolUse.name });
      }

      if (event.type === 'agentResultEvent') {
        agentResult = event.result;
      }
    }

    // Flush any remaining buffer
    if (tagBuffer && thinkingDepth === 0) {
      send({ type: 'text', content: tagBuffer });
    }

    const metrics = agentResult?.metrics;
    send({
      type: 'done',
      sessionId: sid,
      metrics: metrics ? {
        cycles: metrics.cycleCount,
        durationMs: metrics.totalDuration,
        tokens: metrics.accumulatedUsage,
        toolUsage: metrics.toolUsage,
      } : null,
    });
  } catch (err) {
    console.error('Agent error:', err);
    send({ type: 'error', content: 'Something went wrong' });
  } finally {
    clearTimeout(timeout);
    cleanupGuardrails();
    await memory.saveNewMessages(agent);
  }

  res.end();
});

app.listen(PORT, () => {
  console.log(`Agent server running on http://localhost:${PORT}`);
  console.log(`AgentCore Memory: ${AGENTCORE_MEMORY_ID} (${AGENTCORE_REGION})`);
});

// ---------------------------------------------------------------------------
// AgentCore Runtime endpoints (used when deployed to Amazon Bedrock AgentCore)
// ---------------------------------------------------------------------------
// AgentCore expects the container to expose GET /ping and POST /invocations on
// port 8080. The Lambda bridge extracts userId from the Cognito JWT and forwards
// { message, sessionId, userId } as a JSON payload — we parse it here so the
// agent has the authenticated userId in appState rather than trusting client input.
//
// To run locally as an AgentCore container: set PORT=8080 and use agentcore dev.
// ---------------------------------------------------------------------------

const AGENTCORE_PORT = process.env.AGENTCORE_PORT ? parseInt(process.env.AGENTCORE_PORT) : null;

if (AGENTCORE_PORT) {
  const agentcoreApp = express();
  agentcoreApp.use(express.json());

  // Health check — required by AgentCore Runtime
  agentcoreApp.get('/ping', (_, res) => {
    res.json({ status: 'Healthy', time_of_last_update: Math.floor(Date.now() / 1000) });
  });

  // Agent invocation — required by AgentCore Runtime
  // The Lambda bridge sends { message, sessionId, userId } as a binary JSON payload.
  agentcoreApp.post('/invocations', express.raw({ type: '*/*' }), async (req, res) => {
    let body: { message: string; sessionId?: string; userId: string };

    try {
      body = JSON.parse(new TextDecoder().decode(req.body as Buffer));
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    if (!body.message || !body.userId) {
      res.status(400).json({ error: 'message and userId are required' });
      return;
    }

    const sid = body.sessionId || `session-${Date.now()}`;

    const memory = new AgentCoreMemory({
      memoryId: AGENTCORE_MEMORY_ID,
      actorId: body.userId,
      sessionId: sid,
      region: AGENTCORE_REGION,
    });

    // userId comes from the Lambda (extracted from the Cognito JWT), not from the agent
    const agent = createAgent({ model: isSimpleQuery(body.message) ? NOVA_MICRO : CLAUDE_SONNET });
    await memory.loadHistory(agent);

    const cleanupGuardrails = addGuardrails(agent, { maxToolCalls: 20 });
    const timeout = withTimeout(agent, REQUEST_TIMEOUT_MS);

    try {
      const response = await agent.invoke(body.message, { invocationState: { userId: body.userId } });
      await memory.saveNewMessages(agent);
      res.json({ response, sessionId: sid });
    } catch (err) {
      console.error('AgentCore invocation error:', err);
      res.status(500).json({ error: 'Agent invocation failed' });
    } finally {
      clearTimeout(timeout);
      cleanupGuardrails();
    }
  });

  agentcoreApp.listen(AGENTCORE_PORT, () => {
    console.log(`AgentCore Runtime server on port ${AGENTCORE_PORT}`);
  });
}
