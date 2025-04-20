import { LettaClient } from '@letta-ai/letta-client'
// connect to a local server
const client = new LettaClient({
    baseUrl: "http://localhost:8283",
});

export default client;