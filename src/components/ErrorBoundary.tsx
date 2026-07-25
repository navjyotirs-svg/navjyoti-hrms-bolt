import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onRetry?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, errorInfo)
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
    this.props.onRetry?.()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="error-boundary">
        <div className="error-boundary-content">
          <h2>Something went wrong while loading this page.</h2>
          <p className="error-boundary-help">
            An unexpected error occurred. You can try again or return to the dashboard.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <details className="error-boundary-details">
              <summary>Error details (development only)</summary>
              <pre>{this.state.error.message}</pre>
              {this.state.errorInfo && <pre>{this.state.errorInfo.componentStack}</pre>}
            </details>
          )}
          <div className="error-boundary-actions">
            <button className="btn-primary" onClick={this.handleRetry}>Retry</button>
            <a href="/" className="btn-secondary">Return to Dashboard</a>
          </div>
        </div>
      </div>
    )
  }
}
