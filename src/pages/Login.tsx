import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/lib/supabase";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-jay-dark px-4">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-jay-card p-8">
        <h1 className="mb-6 text-center font-display text-2xl text-white">Jay Reach</h1>
        <Auth
          supabaseClient={supabase}
          providers={[]}
          view="sign_in"
          magicLink
          appearance={{ theme: ThemeSupa }}
          localization={{
            variables: {
              sign_in: { email_label: "Email", password_label: "Mot de passe", button_label: "Se connecter" },
              sign_up: { email_label: "Email", password_label: "Mot de passe", button_label: "Créer le compte" },
            },
          }}
        />
      </div>
    </div>
  );
}
