/**
 * Lambda function that bridges API Gateway (OAuth/Cognito) to AgentCore (IAM).
 *
 * This is the auth separation pattern:
 * - Users authenticate at API Gateway with a Cognito JWT (OAuth)
 * - This Lambda extracts the userId from the verified JWT claims
 * - Then calls AgentCore using IAM credentials (the Lambda's execution role)
 * - Users can't call AgentCore directly — it requires IAM SigV4
 *
 * Deploy this as a Lambda behind your API Gateway with a Cognito JWT authorizer.
 */

import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const client = new BedrockAgentCoreClient({ region: process.env.AWS_REGION });
const AGENT_ARN = process.env.AGENT_ARN!;

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  // Extract userId from verified Cognito JWT.
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub;
  if (!userId) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
  }

  let parsed: { message?: string; sessionId?: string };
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { message, sessionId } = parsed;
  if (!message || typeof message !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'message is required' }) };
  }

  // Cap message length to prevent token abuse
  if (message.length > 10_000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'message too long (max 10000 chars)' }) };
  }

  // Scope sessionId to the authenticated user to prevent session hijacking.
  // Even if a user guesses another sessionId string, it's prefixed with their userId.
  const sid = `${userId}:${sessionId || Date.now()}`;

  try {
    // Call AgentCore using IAM auth (not the user's OAuth token).
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: AGENT_ARN,
      runtimeSessionId: sid,
      contentType: 'application/json',
      payload: new TextEncoder().encode(JSON.stringify({ message, userId })),
    });

    const response = await client.send(command);

    // response.response is a streaming blob — collect it
    const chunks: Uint8Array[] = [];
    if (response.response) {
      const stream = response.response as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
    }
    const body = Buffer.concat(chunks).toString('utf-8');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body,
    };
  } catch (err) {
    console.error('AgentCore invocation error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Agent invocation failed' }),
    };
  }
};
