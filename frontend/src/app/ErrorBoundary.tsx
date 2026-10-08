/**
 * Last-resort error boundary.
 *
 * A render-time crash must never show a stack trace or a blank page. The user
 * gets a plain apology, a
 * reload affordance and a route back into the app.
 */

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept in the console for developers; never surfaced in the UI.
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="state-page">
        <h1>Something went wrong on this screen</h1>
        <p className="muted">
          Your data has not been changed. Reload the page to continue — if it keeps happening,
          quote the time it occurred when you report it.
        </p>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    );
  }
}
