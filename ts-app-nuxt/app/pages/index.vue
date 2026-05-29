<script setup lang="ts">
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: string[];
  metrics?: { cycles: number; durationMs: number; tokens: any };
}

const messages = ref<ChatMessage[]>([]);
const input = ref('');
const isStreaming = ref(false);
const currentToolCall = ref<string | null>(null);
const messagesContainer = ref<HTMLElement | null>(null);

const AGENT_URL = 'http://localhost:3001';
const sessionId = ref(`session-${Date.now()}`);

function scrollToBottom() {
  nextTick(() => {
    messagesContainer.value?.scrollTo(0, messagesContainer.value.scrollHeight);
  });
}

function lastMessage() {
  return messages.value[messages.value.length - 1]!;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || isStreaming.value) return;

  input.value = '';
  messages.value.push({ role: 'user', content: text, toolCalls: [] });
  isStreaming.value = true;
  currentToolCall.value = '_thinking';
  scrollToBottom();

  let assistantAdded = false;
  function ensureAssistantMessage() {
    if (!assistantAdded) {
      messages.value.push({ role: 'assistant', content: '', toolCalls: [] });
      assistantAdded = true;
    }
  }

  try {
    const res = await fetch(`${AGENT_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: sessionId.value }),
    });

    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;

        const event = JSON.parse(line.slice(6));

        switch (event.type) {
          case 'text':
            ensureAssistantMessage();
            currentToolCall.value = null;
            lastMessage().content += event.content;
            scrollToBottom();
            break;
          case 'tool_start':
            currentToolCall.value = event.tool;
            ensureAssistantMessage();
            lastMessage().toolCalls.push(event.tool);
            break;
          case 'tool_end':
            currentToolCall.value = null;
            break;
          case 'done':
            ensureAssistantMessage();
            if (event.metrics) {
              lastMessage().metrics = event.metrics;
            }
            break;
          case 'error':
            ensureAssistantMessage();
            lastMessage().content += `\n\nError: ${event.content}`;
            break;
        }
      }
    }
  } catch {
    ensureAssistantMessage();
    lastMessage().content = 'Failed to connect to the agent. Make sure the server is running on port 3001.';
  }

  isStreaming.value = false;
  currentToolCall.value = null;
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function toolCallLabel(toolName: string): string {
  if (toolName === '_thinking') return 'Thinking...';
  const labels: Record<string, string> = {
    get_user_orders: 'Looking up your orders...',
    get_product_info: 'Searching products...',
    create_support_ticket: 'Creating support ticket...',
    http_request: 'Making request...',
  };
  return labels[toolName] || `Using tool: ${toolName}...`;
}
</script>

<template>
  <div class="min-h-screen bg-slate-900 flex items-start justify-center pt-12 px-4">
    <div class="w-full max-w-4xl h-[75vh] flex flex-col bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden ring-1 ring-orange-500/10">

      <!-- Header -->
      <div class="px-6 py-4 border-b border-slate-700/50 bg-gradient-to-r from-slate-800 via-slate-800 to-orange-950/20">
        <h1 class="text-lg font-semibold text-white">Store Assistant</h1>
        <p class="text-sm text-slate-400">Ask about your orders, products, or get support</p>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-6 py-4 space-y-4">

        <!-- Empty state -->
        <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-full text-center">
          <p class="text-slate-400 mb-4">Try asking:</p>
          <div class="space-y-2">
            <button
              class="block w-full max-w-xs px-4 py-2.5 text-sm text-left text-slate-300 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-lg transition"
              @click="input = 'What are my recent orders?'; sendMessage()"
            >
              What are my recent orders?
            </button>
            <button
              class="block w-full max-w-xs px-4 py-2.5 text-sm text-left text-slate-300 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-lg transition"
              @click="input = 'Do you have any keyboards in stock?'; sendMessage()"
            >
              Do you have any keyboards in stock?
            </button>
            <button
              class="block w-full max-w-xs px-4 py-2.5 text-sm text-left text-slate-300 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-lg transition"
              @click="input = 'I need help with order ORD-001'; sendMessage()"
            >
              I need help with order ORD-001
            </button>
          </div>
        </div>

        <!-- Message list -->
        <template v-for="(msg, i) in messages" :key="i">
          <!-- User message -->
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <div class="max-w-[80%] px-4 py-2.5 bg-blue-600 text-white rounded-2xl rounded-br-sm text-sm">
              {{ msg.content }}
            </div>
          </div>

          <!-- Assistant message (only show when has content) -->
          <div v-else-if="msg.content" class="flex justify-start">
            <div class="max-w-[80%]">
              <div class="px-4 py-2.5 bg-slate-700 text-slate-100 rounded-2xl rounded-bl-sm text-sm whitespace-pre-wrap">
                {{ msg.content }}
              </div>
              <div v-if="msg.toolCalls.length && !isStreaming" class="mt-1.5 flex flex-wrap gap-1">
                <span v-for="tc in msg.toolCalls" :key="tc" class="text-xs px-2 py-0.5 bg-orange-900/30 text-orange-300 border border-orange-700/40 rounded-full">
                  {{ tc }}
                </span>
              </div>
              <div v-if="msg.metrics" class="mt-1 text-xs text-slate-500">
                {{ msg.metrics.cycles }} cycles · {{ Math.round(msg.metrics.durationMs) }}ms · {{ msg.metrics.tokens?.inputTokens + msg.metrics.tokens?.outputTokens }} tokens
              </div>
            </div>
          </div>
        </template>

        <!-- Tool/thinking indicator -->
        <div v-if="currentToolCall" class="flex justify-start">
          <div class="px-4 py-2 text-sm text-orange-400 animate-pulse">
            {{ toolCallLabel(currentToolCall) }}
          </div>
        </div>
      </div>

      <!-- Input area -->
      <div class="px-4 py-3 border-t border-slate-700/50 bg-gradient-to-r from-slate-800/80 via-slate-800/80 to-orange-950/10">
        <form class="flex gap-2" @submit.prevent="sendMessage">
          <textarea
            v-model="input"
            placeholder="Ask about orders, products, or get support..."
            :disabled="isStreaming"
            rows="1"
            class="flex-1 px-4 py-2.5 bg-slate-700/80 border border-slate-600 rounded-xl text-sm text-white placeholder-slate-400 resize-none outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 transition disabled:opacity-50"
            @keydown="handleKeydown"
          />
          <button
            type="submit"
            :disabled="isStreaming || !input.trim()"
            class="px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition shadow-lg shadow-orange-500/20 disabled:shadow-none"
          >
            {{ isStreaming ? '...' : 'Send' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
