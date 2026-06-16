import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Mode = "signin" | "signup";

/** Traduit les messages d'erreur Supabase les plus courants en français. */
function traduireErreur(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email ou mot de passe incorrect.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "Un compte existe déjà avec cet email.";
  if (m.includes("password should be at least"))
    return "Le mot de passe doit faire au moins 6 caractères.";
  if (m.includes("email not confirmed"))
    return "Email non confirmé. Vérifie ta boîte mail, ou active l'auto-confirmation côté serveur.";
  if (m.includes("unable to validate email") || m.includes("invalid email"))
    return "Adresse email invalide.";
  if (m.includes("rate limit")) return "Trop de tentatives. Réessaie dans quelques instants.";
  return message;
}

export default function Login() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // La session est captée par AuthGate, qui affiche l'app automatiquement.
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setNotice(
            "Compte créé. Si la confirmation par email est activée, confirme via ta boîte mail puis connecte-toi."
          );
          setMode("signin");
        }
      }
    } catch (err) {
      setError(traduireErreur((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-jay-dark px-4 text-white">
      {/* Atmosphère : halos sobres aux couleurs de la marque */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[30rem] w-[30rem] rounded-full bg-jay-purple/20 blur-[130px]" />
        <div className="absolute -bottom-32 -right-32 h-[30rem] w-[30rem] rounded-full bg-jay-blue/15 blur-[130px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        {/* Marque */}
        <div className="mb-8 text-center">
          <img
            src="/jay-head.png"
            alt="Jay Reach"
            className="mx-auto mb-4 h-16 w-16 rounded-full shadow-lg shadow-jay-purple/30"
          />
          <h1 className="font-display text-3xl font-semibold tracking-tight">Jay Reach</h1>
          <p className="mt-1 text-sm text-white/50">Moteur de prospection self-host</p>
        </div>

        {/* Carte */}
        <div className="rounded-2xl border border-white/10 bg-jay-card p-8 shadow-2xl shadow-black/50">
          {/* Sélecteur connexion / inscription */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1 text-sm font-medium">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`rounded-lg py-2 transition-colors ${
                  mode === m ? "bg-white/10 text-white" : "text-white/45 hover:text-white/70"
                }`}
              >
                {m === "signin" ? "Connexion" : "Créer un compte"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm text-white/70">
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="toi@exemple.com"
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-white outline-none transition placeholder:text-white/30 focus:border-jay-purple/60 focus:ring-2 focus:ring-jay-purple/30"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm text-white/70">
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-white outline-none transition placeholder:text-white/30 focus:border-jay-purple/60 focus:ring-2 focus:ring-jay-purple/30"
                />
              </div>
              {mode === "signup" && (
                <p className="mt-1.5 text-xs text-white/40">6 caractères minimum.</p>
              )}
            </div>

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            {notice && (
              <p className="rounded-lg border border-jay-blue/30 bg-jay-blue/10 px-3 py-2 text-sm text-jay-blue">
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-jay-purple py-2.5 font-medium text-white transition hover:bg-jay-purple/90 focus:outline-none focus:ring-2 focus:ring-jay-purple/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "signin" ? "Se connecter" : "Créer le compte"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-white/30">
          Accès réservé aux opérateurs autorisés.
        </p>
      </motion.div>
    </div>
  );
}
