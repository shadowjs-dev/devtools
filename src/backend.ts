import type { Agent, AgentRequest, AgentResponse } from "./agent";
import type { InspectorModel } from "./model";

/**
 * What a panel talks to: a model that stays up to date, and requests. The panel never knows
 * whether the agent is in the same page ({@link createLocalBackend}) or behind a transport
 * (`connectRemote`), so the same UI serves the floating overlay and a browser-extension panel.
 *
 * @since 1.0.0
 */
export interface Backend {
  /** The inspector model, kept current. Read it; do not apply events to it yourself. */
  readonly model: InspectorModel;
  /** Resolves once the first complete state is available. */
  readonly ready: Promise<void>;
  /**
   * Why the first complete state could not be loaded, or `undefined`. A remote backend sets it when the
   * agent refuses or cannot send its state (for example an answer over the bridge's size cap) and notifies
   * its subscribers; `ready` then stays pending. It clears when a state arrives. A local backend never fails.
   */
  readonly error?: () => string | undefined;
  /** Calls `listener` after the model changed (batched). Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Sends a command to the agent. Resolves with its answer; rejects only when the backend is disposed. */
  request(request: AgentRequest): Promise<AgentResponse>;
  /** Stops listening. */
  dispose(): void;
}

/**
 * Page-side behavior that a backend cannot do through the agent alone.
 *
 * @since 1.0.0
 */
export interface PageHooks {
  /**
   * Highlights a component on the page. `null` clears the highlight. Without this hook a highlight
   * request is acknowledged and nothing is drawn.
   */
  highlight?(id: number | null): void;
}

/**
 * A backend for an agent in the same page: the model is the agent's own model, and the requests go to
 * the agent. A development tool: the page-side panel (`mountDevtools`) uses it in development builds.
 *
 * @param agent The agent.
 * @param page Page-side behavior such as the highlight overlay.
 * @returns The backend.
 * @example
 * import { createAgent, createLocalBackend } from "@shadow-js/devtools";
 *
 * const agent = createAgent();
 * const backend = createLocalBackend(agent, {
 *   highlight: (id) => console.info("highlight", id),
 * });
 * @since 1.0.0
 */
export function createLocalBackend(agent: Agent, page: PageHooks = {}): Backend {
  const unsubscribers = new Set<() => void>();
  let disposed = false;
  return {
    model: agent.model,
    ready: Promise.resolve(),
    subscribe(listener): () => void {
      const off = agent.subscribe(() => listener());
      unsubscribers.add(off);
      return () => {
        unsubscribers.delete(off);
        off();
      };
    },
    request(request): Promise<AgentResponse> {
      if (disposed) return Promise.reject(new Error("The devtools backend was disposed."));
      if (request.type === "highlight") {
        page.highlight?.(request.id);
        return Promise.resolve({ ok: true, result: null });
      }
      return Promise.resolve(agent.handle(request));
    },
    dispose(): void {
      disposed = true;
      for (const off of unsubscribers) off();
      unsubscribers.clear();
    },
  };
}
