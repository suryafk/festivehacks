import { Component, type ReactNode } from "react";
import { store } from "./api";

/** Never show a blank page: if a view crashes, offer a clean restart instead. */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[Marg Bandhu] view crashed:", error);
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <div className="text-5xl" aria-hidden>🧭</div>
        <h1 className="mt-4 font-display text-3xl font-bold">Something went wrong on this page</h1>
        <p className="mt-2 text-ink/70">This can happen if your browser still holds a trip from an older version of Marg Bandhu. Start a fresh trip and you're good to go.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => { store.del("mb.conv"); location.hash = "#/plan"; location.reload(); }}
            className="rounded-full bg-brand px-6 py-3 font-semibold text-white"
          >
            Start a fresh trip
          </button>
          <a href="#/" onClick={() => this.setState({ error: null })} className="rounded-full border border-ink/15 px-6 py-3 font-semibold">Go home</a>
        </div>
      </div>
    );
  }
}
