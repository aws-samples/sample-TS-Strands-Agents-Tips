# TypeScript Agents in Production — Sample Code

Companion code for the blog post and video: **TypeScript Agents in Production**.

## Structure

- `agent/` — Express-based agent server using Strands Agents TypeScript SDK
- `ts-app-nuxt/` — Nuxt frontend that consumes the agent via SSE

## Getting Started

```bash
# Agent server
cd agent
npm install
npm run dev

# Frontend
cd ts-app-nuxt
npm install
npm run dev
```

## Related

- [Strands Agents TypeScript SDK](https://github.com/strands-agents/sdk-typescript)
- [Strands TypeScript Quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript/)
- [Amazon Bedrock AgentCore](https://aws.amazon.com/bedrock/agentcore/)

---

> **⚠️ Disclaimer:** This is sample code intended for educational and demonstration purposes only. It is not intended for production use without additional testing, security review, and hardening. Use at your own risk.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
