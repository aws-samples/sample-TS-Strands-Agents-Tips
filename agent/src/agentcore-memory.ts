import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  ListEventsCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { Agent, Message, TextBlock } from '@strands-agents/sdk';

/**
 * AgentCore Memory integration for Strands TypeScript agents.
 *
 * Stores and retrieves conversation history from Amazon Bedrock AgentCore Memory.
 * Call loadHistory() BEFORE agent.stream()/invoke() to restore context.
 * Call saveNewMessages() AFTER to persist new turns.
 *
 * If your memory resource has long-term strategies (preference, semantic, summary),
 * AgentCore will automatically extract insights from stored conversations.
 */
export class AgentCoreMemory {
  private client: BedrockAgentCoreClient;
  private memoryId: string;
  private actorId: string;
  private sessionId: string;
  private savedMessageCount = 0;

  constructor(opts: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    region?: string;
  }) {
    this.memoryId = opts.memoryId;
    this.actorId = opts.actorId;
    this.sessionId = opts.sessionId;
    this.client = new BedrockAgentCoreClient({
      region: opts.region || process.env.AWS_REGION || 'us-east-1',
    });
  }

  /** Load previous conversation into agent.messages. Call before stream/invoke. */
  async loadHistory(agent: Agent): Promise<void> {
    if (agent.messages.length > 0) return;

    try {
      const response = await this.client.send(
        new ListEventsCommand({
          memoryId: this.memoryId,
          sessionId: this.sessionId,
          actorId: this.actorId,
          includePayloads: true,
          maxResults: 20,
        })
      );

      const events = response.events || [];
      // AgentCore returns events newest-first — reverse for chronological order
      events.reverse();

      for (const event of events) {
        if (!event.payload) continue;
        for (const item of event.payload) {
          if ('conversational' in item && item.conversational) {
            const { role, content } = item.conversational;
            if (role && content && 'text' in content && content.text) {
              agent.messages.push(
                new Message({
                  role: role.toLowerCase() as 'user' | 'assistant',
                  content: [new TextBlock(content.text)],
                })
              );
            }
          }
        }
      }

      this.savedMessageCount = agent.messages.length;
      if (agent.messages.length > 0) {
        console.log(`[AgentCoreMemory] Loaded ${agent.messages.length} messages`);
      }
    } catch (err) {
      console.error('[AgentCoreMemory] Failed to load:', err);
    }
  }

  /** Save new messages added since last save. Call after stream/invoke. */
  async saveNewMessages(agent: Agent): Promise<void> {
    const newMessages = agent.messages.slice(this.savedMessageCount);
    if (newMessages.length === 0) return;

    for (const msg of newMessages) {
      let text = '';
      for (const block of msg.content) {
        if ('text' in block && typeof (block as any).text === 'string') {
          text += (block as any).text;
        }
      }
      if (!text) continue;

      try {
        await this.client.send(
          new CreateEventCommand({
            memoryId: this.memoryId,
            actorId: this.actorId,
            sessionId: this.sessionId,
            eventTimestamp: new Date(),
            clientToken: crypto.randomUUID(),
            payload: [
              {
                conversational: {
                  role: msg.role.toUpperCase() as 'USER' | 'ASSISTANT',
                  content: { text },
                },
              },
            ],
          })
        );
      } catch (err) {
        console.error('[AgentCoreMemory] Failed to save message:', err);
      }
    }

    this.savedMessageCount = agent.messages.length;
    console.log(`[AgentCoreMemory] Saved ${newMessages.length} messages`);
  }
}
