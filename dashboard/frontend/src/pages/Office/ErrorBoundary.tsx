/* ErrorBoundary around the OfficeCanvasLite + orchestrator. Keeps the rest of
   the dashboard alive when the canvas crashes (sprite load, WebGL issue, etc.). */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class OfficeErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[pixel-office] canvas crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-slate-300">
          <h2 className="text-lg font-semibold text-red-400">Office canvas crashed</h2>
          <p className="mt-2 text-sm">Reload the page to try again. Details below (for a bug report):</p>
          <pre className="mt-4 p-3 bg-black/40 border border-slate-800 rounded text-xs overflow-x-auto">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
