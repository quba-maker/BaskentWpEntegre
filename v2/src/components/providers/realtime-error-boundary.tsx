"use client";

import React, { Component, ErrorInfo } from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary for Realtime Components
 * 
 * Prevents a single Ably/WebSocket failure from crashing the entire inbox.
 * Renders a graceful degradation message and allows retry.
 */
export class RealtimeErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Production-safe: log to console.error (picked up by Vercel log drain)
    console.error("[RealtimeErrorBoundary] Caught error in realtime layer:", {
      message: error.message,
      stack: error.stack?.substring(0, 500),
      componentStack: errorInfo.componentStack?.substring(0, 300),
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          gap: "0.75rem",
          color: "#94a3b8",
          fontSize: "0.875rem",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "1.5rem" }}>⚡</div>
          <p>Anlık bağlantı kesintisi. Mesajlarınız güvende.</p>
          <button
            onClick={this.handleRetry}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid #334155",
              background: "transparent",
              color: "#e2e8f0",
              cursor: "pointer",
              fontSize: "0.813rem",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Yeniden Dene
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
