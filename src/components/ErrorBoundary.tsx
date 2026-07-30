import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "@/lib/logger";

interface Props { children: ReactNode }
interface State { error: Error | null; info: ErrorInfo | null }

/**
 * ErrorBoundary : au lieu d'un ecran noir quand un composant plante au rendu,
 * affiche un fallback. En DEV, la stack complete + component stack sont affichees
 * pour le diagnostic ; en prod, un message sobre (la stack n'est jamais exposee a
 * l'utilisateur final). L'erreur est toujours loggee via logger.error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    // Visible aussi dans la console (via logger — no-console interdit console.* direct)
    logger.error("[ErrorBoundary] render crash", error, { componentStack: info.componentStack });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    // Prod : message sobre, aucune stack exposee a l'utilisateur.
    if (!import.meta.env.DEV) {
      return (
        <div style={{
          position: "fixed", inset: 0, zIndex: 99999, display: "flex",
          alignItems: "center", justifyContent: "center", padding: "32px",
          background: "#0b0b0d", color: "#f1f1f4", textAlign: "center",
          font: "15px/1.6 system-ui, -apple-system, sans-serif",
        }}>
          <div style={{ maxWidth: 420 }}>
            <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Une erreur est survenue</h1>
            <p style={{ color: "#9a9aa6", margin: "0 0 20px" }}>
              Rechargez la page. Si le probleme persiste, contactez le support.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                cursor: "pointer", border: "none", borderRadius: 10, padding: "10px 20px",
                fontSize: 14, fontWeight: 600, color: "#fff",
                background: "linear-gradient(90deg,#8B5CF6,#60A5FA)",
              }}
            >
              Recharger la page
            </button>
          </div>
        </div>
      );
    }

    // DEV : diagnostic complet (stack + component stack).
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 99999, overflow: "auto",
        background: "#0b0b0d", color: "#f1f1f4", padding: "32px",
        font: "13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
      }}>
        <h1 style={{ color: "#ff5c7a", fontSize: 18, margin: "0 0 4px" }}>
          ⚠️ Erreur de rendu (ErrorBoundary — DEV)
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
