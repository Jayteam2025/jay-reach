import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null; info: ErrorInfo | null }

/**
 * ErrorBoundary de diagnostic : au lieu d'un ecran noir quand un composant
 * plante au rendu, affiche le message + la stack a l'ecran. (Temporaire.)
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    // Visible aussi dans la console
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 99999, overflow: "auto",
        background: "#0b0b0d", color: "#f1f1f4", padding: "32px",
        font: "13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
      }}>
        <h1 style={{ color: "#ff5c7a", fontSize: 18, margin: "0 0 4px" }}>
          ⚠️ Erreur de rendu (ErrorBoundary de diagnostic)
        </h1>
        <p style={{ color: "#9a9aa6", margin: "0 0 20px" }}>
          Copie ou capture ce texte pour le diagnostic.
        </p>
        <div style={{ background: "#151519", border: "1px solid #2a2a31", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ color: "#ff8fa3", fontWeight: 700, marginBottom: 6 }}>{error.name}: {error.message}</div>
          {error.stack && <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "#c7c7d1" }}>{error.stack}</pre>}
        </div>
        {info?.componentStack && (
          <div style={{ background: "#151519", border: "1px solid #2a2a31", borderRadius: 10, padding: 16 }}>
            <div style={{ color: "#8fb0ff", fontWeight: 700, marginBottom: 6 }}>Component stack</div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "#c7c7d1" }}>{info.componentStack}</pre>
          </div>
        )}
      </div>
    );
  }
}
