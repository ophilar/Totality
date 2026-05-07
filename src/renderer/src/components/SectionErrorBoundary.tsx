import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  title?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class SectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    window.electronAPI.log.error('[SectionErrorBoundary]', `Error in ${this.props.title || 'Section'}:`, error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-card/30 rounded-xl border border-border/50 m-4">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold mb-2">Unable to load {this.props.title || 'this section'}</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">
            An unexpected error occurred while rendering this view. 
            {this.state.error && <span className="block mt-2 font-mono text-[10px] opacity-70 italic">{this.state.error.message}</span>}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
