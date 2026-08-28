import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Bump this (e.g. the active tab) to auto-clear the error on navigation. */
  resetKey?: unknown;
  label?: string;
}
interface State {
  error: Error | null;
}

/**
 * Catches a render/lifecycle crash inside a screen and shows a retry card
 * instead of taking the whole app to a black screen. Logs the exact error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto mt-8 max-w-sm rounded-3xl border-2 border-b-4 border-neon-pink border-b-black/50 bg-farm-card/80 p-5 text-center backdrop-blur-md">
        <div className="text-4xl">💥</div>
        <div className="mt-2 font-display text-lg text-stroke">Щось зламалось</div>
        <p className="mt-1 break-words text-[11px] text-white/45">{error.message}</p>
        <button
          onClick={this.retry}
          className="mt-4 rounded-xl border-2 border-black border-b-4 border-b-black/40 bg-neon-lime px-4 py-2 text-sm font-extrabold uppercase text-black active:translate-y-0.5 active:border-b-2"
        >
          Спробувати знову
        </button>
      </div>
    );
  }
}
