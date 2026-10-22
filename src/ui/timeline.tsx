import { For, Show } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import type { FlameFlush, FlameSpan } from "../inspector";
import type { TabProps } from "./tree";

interface SpanProps extends TabProps {
  flush: FlameFlush;
  span: FlameSpan;
}

const LANE_HEIGHT = 16;

/** One bar of the flame graph: positioned by time inside its flush, one lane per nesting level. */
const Bar: Component<SpanProps> = (props) => (
  <div
    class={`bar ${props.span.kind}${props.span.changed ? "" : " unchanged"}`}
    data-span={props.span.seq}
    title={`${props.span.label}: ${props.span.duration.toFixed(2)} ms${props.span.changed ? "" : " (value unchanged)"}`}
    style={{
      left: `${props.flush.duration <= 0 ? 0 : ((props.span.start - props.flush.start) / props.flush.duration) * 100}%`,
      width: `${props.flush.duration <= 0 ? 100 : Math.max((props.span.duration / props.flush.duration) * 100, 1)}%`,
      top: `${props.span.depth * LANE_HEIGHT}px`,
    }}
    on:click={() => props.state.select(props.span.id)}
  >
    {props.span.label}
  </div>
);

/**
 * The Timeline tab. Props: `state` is the panel's {@link PanelState}. It shows the newest 12 flushes, each
 * with its run count and duration (flushes also show their queue sizes), and its runs laid out as flame lanes (a
 * memo pulled by an effect sits one lane below the effect). Clicking a bar selects its node. Below the
 * flushes it lists up to 10 components that re-ran most, with their update counts and total time.
 *
 * Internal to the panel: the package index does not export this component. Used in development builds
 * only.
 *
 * @internal
 */
export const TimelineTab: Component<TabProps> = (props) => (
  <section class="list" aria-label="Timeline">
    <Show
      when={props.state.flames().length > 0}
      fallback={<div class="empty">No flushes recorded yet.</div>}
    >
      <For each={props.state.flames().slice().reverse()} key={(flush) => flush.flush}>
        {(flush) => (
          <div class="flush" data-flush={flush().flush}>
            <div class="flush-head">
              <strong>{flush().flush === 0 ? "outside a flush" : `flush #${flush().flush}`}</strong>
              <span>{flush().spans.length} runs</span>
              <span>{flush().duration.toFixed(2)} ms</span>
              <Show when={flush().flush !== 0}>
                <span>
                  queue: {flush().render} render / {flush().user} user
                </span>
              </Show>
            </div>
            <div class="lanes" style={{ height: `${Math.max(flush().lanes, 1) * LANE_HEIGHT}px` }}>
              <For each={flush().spans} key={(span) => span.seq}>
                {(span) => <Bar state={props.state} flush={flush()} span={span()} />}
              </For>
            </div>
          </div>
        )}
      </For>
    </Show>
    <Show when={props.state.hot().length > 0}>
      <div class="flush">
        <div class="flush-head">
          <strong>Components that re-ran most</strong>
        </div>
        <table class="table" aria-label="Component update counts">
          <thead>
            <tr>
              <th>Component</th>
              <th class="num">Updates</th>
              <th class="num">Total ms</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.state.hot()} key={(stat) => stat.id}>
              {(stat) => (
                <tr data-component={stat().id}>
                  <td>
                    <button
                      type="button"
                      class="link"
                      on:click={() => props.state.select(stat().id)}
                    >
                      {stat().name}
                    </button>
                  </td>
                  <td class="num">{stat().updates}</td>
                  <td class="num">{stat().totalDuration.toFixed(2)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  </section>
);
