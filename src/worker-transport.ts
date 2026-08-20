/**
 * A request-scoped MCP transport for the Workers runtime.
 *
 * The SDK ships a Streamable HTTP transport built on node's http req/res pair,
 * which Workers does not have. The protocol itself still comes from the SDK —
 * this class only carries bytes: hand it the client's JSON-RPC message, get the
 * server's reply back, and turn that into a Response.
 *
 * One instance serves exactly one HTTP request, so there is no session state to
 * keep and nothing to clean up between calls.
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

type MessageId = string | number;

/** How long to wait for the server to answer before giving up on a request. */
const REPLY_TIMEOUT_MS = 25_000;

export class WorkerTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly waiting = new Map<MessageId, (message: JSONRPCMessage) => void>();

  async start(): Promise<void> {
    // Nothing to open — the HTTP request is already the connection.
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const id = idOf(message);
    // A server-initiated notification has no id and no request waiting on it.
    // With a single request/response exchange there is nowhere to put it, so
    // it is dropped rather than held onto.
    if (id === undefined) return;

    const resolve = this.waiting.get(id);
    if (resolve) {
      this.waiting.delete(id);
      resolve(message);
    }
  }

  async close(): Promise<void> {
    this.waiting.clear();
    this.onclose?.();
  }

  /**
   * Feed one client message to the server and wait for its reply.
   *
   * Returns null for notifications, which get no reply by definition, and for
   * a request that times out.
   */
  async exchange(message: JSONRPCMessage): Promise<JSONRPCMessage | null> {
    const id = idOf(message);
    const isRequest = id !== undefined && 'method' in message;

    if (!isRequest) {
      this.onmessage?.(message);
      return null;
    }

    return new Promise<JSONRPCMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve(null);
      }, REPLY_TIMEOUT_MS);

      this.waiting.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });

      this.onmessage?.(message);
    });
  }
}

function idOf(message: JSONRPCMessage): MessageId | undefined {
  const id = (message as { id?: MessageId }).id;
  return id ?? undefined;
}
