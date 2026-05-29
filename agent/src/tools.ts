import { tool } from '@strands-agents/sdk';
import { z } from 'zod/v4';

// Simulated delay to mimic real database latency (makes tool indicators visible in the UI).
// Remove this in production when you're hitting a real database.
const DEMO_DELAY_MS = 1500;
const demoDelay = () => new Promise(resolve => setTimeout(resolve, DEMO_DELAY_MS));

// Simulated data — in production this would be RDS PostgreSQL queries
const ORDERS = [
  { id: 'ORD-001', status: 'shipped', total: 59.99, item: 'Wireless Headphones', created_at: '2026-04-01' },
  { id: 'ORD-002', status: 'delivered', total: 129.00, item: 'Mechanical Keyboard', created_at: '2026-03-28' },
  { id: 'ORD-003', status: 'pending', total: 24.50, item: 'USB-C Cable Pack', created_at: '2026-04-08' },
  { id: 'ORD-004', status: 'shipped', total: 349.99, item: 'Monitor Stand', created_at: '2026-04-05' },
];

const PRODUCTS = [
  { id: 'PROD-001', name: 'Wireless Headphones', price: 59.99, in_stock: true },
  { id: 'PROD-002', name: 'Mechanical Keyboard', price: 129.00, in_stock: true },
  { id: 'PROD-003', name: 'USB-C Cable Pack', price: 24.50, in_stock: false },
  { id: 'PROD-004', name: 'Monitor Stand', price: 349.99, in_stock: true },
  { id: 'PROD-005', name: '4K Webcam', price: 89.99, in_stock: true },
];

export const getUserOrders = tool({
  name: 'get_user_orders',
  description: 'Get orders for the current authenticated user. Use this when the user asks about their orders, purchases, or deliveries.',
  inputSchema: z.object({
    status: z.enum(['pending', 'shipped', 'delivered']).optional()
      .describe('Filter by order status. Omit to get all orders.'),
    limit: z.number().int().min(1).max(50).default(10)
      .describe('Maximum number of orders to return'),
  }),
  callback: async (input, context) => {
    // userId comes from invocationState — set per-request by the handler from the JWT.
    const userId = context?.invocationState?.userId as string | undefined;
    if (!userId) throw new Error('userId missing from invocationState — request not authenticated');

    await demoDelay(); // Simulate database latency for visible tool indicators

    let results = ORDERS;
    if (input.status) {
      results = results.filter(o => o.status === input.status);
    }
    // Sort newest-first to match the ORDER BY created_at DESC a real SQL query would use
    results = [...results].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return JSON.stringify(results.slice(0, input.limit));
  },
});

export const getProductInfo = tool({
  name: 'get_product_info',
  description: 'Search for products by name. Use this when the user asks about products, prices, or availability.',
  inputSchema: z.object({
    query: z.string().describe('Product name or keyword to search for'),
  }),
  callback: async (input) => {
    await demoDelay();
    const results = PRODUCTS.filter(p =>
      p.name.toLowerCase().includes(input.query.toLowerCase())
    );
    return JSON.stringify(results);
  },
});

export const createSupportTicket = tool({
  name: 'create_support_ticket',
  description: 'Create a support ticket for the user. Use this when the user has a problem with an order or needs help.',
  inputSchema: z.object({
    subject: z.string().describe('Brief subject line for the ticket'),
    description: z.string().describe('Detailed description of the issue'),
    order_id: z.string().optional().describe('Related order ID if applicable'),
  }),
  callback: async (input, context) => {
    const userId = context?.invocationState?.userId as string | undefined;
    await demoDelay();
    // In production: insert into support_tickets table with userId for ownership/audit
    const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;
    return JSON.stringify({
      ticket_id: ticketId,
      status: 'open',
      subject: input.subject,
      created_by: userId ?? 'unknown',
      message: `Support ticket ${ticketId} created. We'll get back to you within 24 hours.`,
    });
  },
});
