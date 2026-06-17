import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  Loader2,
  Palette,
  Mail,
  X,
  Sparkles,
  PenLine,
  Bell,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  useWorkspaceBrand,
  useUpdateWorkspaceBrand,
} from '@/hooks/useWorkspaceBrand';
import { useCurrentWorkspaceId } from '@/hooks/useCurrentWorkspaceId';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RecipientsInputProps {
  values: string[];
  onChange: (next: string[]) => void;
}

function RecipientsInput({ values, onChange }: RecipientsInputProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const trimmed = draft.trim().toLowerCase();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
      setError('Email invalide');
      return;
    }
    if (values.includes(trimmed)) {
      setError('Deja dans la liste');
      return;
    }
    onChange([...values, trimmed]);
    setDraft('');
    setError(null);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
        {values.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 text-violet-300 px-2.5 py-0.5 text-xs"
          >
            {email}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== email))}
              className="hover:text-white transition-colors"
              aria-label={`Retirer ${email}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="email"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKey}
          onBlur={commit}
          placeholder={values.length === 0 ? 'contact@example.com' : ''}
          className="flex-1 min-w-[180px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={error ? 'text-red-500' : 'text-muted-foreground'}>
          {error ?? "Entrée ou virgule pour ajouter. Liste vide = pas d'envoi."}
        </span>
        <span className="text-muted-foreground">{values.length} destinataire{values.length > 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

interface SectionHeaderProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}

function SectionHeader({ icon: Icon, title, hint }: SectionHeaderProps) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-violet-500 mt-1 shrink-0" />
      <div className="space-y-1">
        <h3 className="font-medium text-foreground leading-none">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>}
      </div>
    </div>
  );
}

export function ProspectionBranding() {
  const { data: brand, isLoading } = useWorkspaceBrand();
  const { data: workspaceId } = useCurrentWorkspaceId();
  const mutation = useUpdateWorkspaceBrand();

  const [brandName, setBrandName] = useState('');
  const [founderName, setFounderName] = useState('');
  const [productPitch, setProductPitch] = useState('');
  const [signature, setSignature] = useState('');
  const [heroImageUrl, setHeroImageUrl] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);

  useEffect(() => {
    if (!brand) return;
    setBrandName(brand.brand_name ?? '');
    setFounderName(brand.founder_name ?? '');
    setProductPitch(brand.product_pitch ?? '');
    setSignature(brand.signature ?? '');
    setHeroImageUrl(brand.hero_image_url ?? '');
    setAppUrl(brand.app_url ?? '');
    setRecipients(brand.notification_recipients ?? []);
  }, [brand]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center space-y-3 max-w-md">
        <Palette className="size-8 text-muted-foreground mx-auto" />
        <div className="space-y-1">
          <p className="text-foreground font-medium">Aucune identité de marque</p>
          <p className="text-sm text-muted-foreground">
            Configure le nom de ta marque, ta signature et tes infos d'expéditeur pour
            personnaliser les messages générés.
          </p>
        </div>
        <Button
          onClick={async () => {
            if (!workspaceId) {
              toast.error('Workspace introuvable');
              return;
            }
            try {
              await mutation.mutateAsync({
                workspace_id: workspaceId,
                notification_recipients: [],
                attachments: [],
              });
              toast.success('Branding initialisé');
            } catch (err) {
              toast.error('Échec', {
                description: err instanceof Error ? err.message : 'Erreur inconnue',
              });
            }
          }}
          disabled={mutation.isPending || !workspaceId}
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
          Créer mon branding
        </Button>
      </div>
    );
  }

  const baseRecipients = brand.notification_recipients ?? [];
  const recipientsEqual =
    recipients.length === baseRecipients.length &&
    recipients.every((r, i) => r === baseRecipients[i]);

  const isDirty =
    brandName !== (brand.brand_name ?? '') ||
    founderName !== (brand.founder_name ?? '') ||
    productPitch !== (brand.product_pitch ?? '') ||
    signature !== (brand.signature ?? '') ||
    heroImageUrl !== (brand.hero_image_url ?? '') ||
    appUrl !== (brand.app_url ?? '') ||
    !recipientsEqual;

  async function handleSave() {
    if (!brand) return;
    if (appUrl.trim() && !/^https?:\/\//i.test(appUrl.trim())) {
      toast.error('App URL doit commencer par http(s)://');
      return;
    }
    try {
      await mutation.mutateAsync({
        workspace_id: brand.workspace_id,
        brand_name: brandName.trim() || null,
        founder_name: founderName.trim() || null,
        product_pitch: productPitch.trim() || null,
        signature: signature.trim() || null,
        hero_image_url: heroImageUrl.trim() || null,
        app_url: appUrl.trim() || null,
        notification_recipients: recipients,
      });
      toast.success('Branding enregistré');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      toast.error('Échec', { description: message });
    }
  }


  return (
    <div className="max-w-2xl space-y-10">
      <header className="flex items-center gap-3">
        <Palette className="w-5 h-5 text-violet-500" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">Branding & notifications</h2>
          <p className="text-sm text-muted-foreground">
            Ces variables alimentent vos emails de prospection, les récapitulatifs et les signatures. Chaque org configure les siennes.
          </p>
        </div>
      </header>

      <section className="space-y-4">
        <SectionHeader icon={Sparkles} title="Identite" hint="Substitue {{brand_name}} et {{founder_name}} dans les prompts." />
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="brand_name">Marque</Label>
            <Input
              id="brand_name"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Jay"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="founder_name">Auteur des messages</Label>
            <Input
              id="founder_name"
              value={founderName}
              onChange={(e) => setFounderName(e.target.value)}
              placeholder="Jean Dupont"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={PenLine}
          title="Pitch produit"
          hint="Court résumé injecté dans le system prompt LLM. Écrit en 1-2 phrases factuelles, sans superlatifs."
        />
        <Textarea
          id="product_pitch"
          value={productPitch}
          onChange={(e) => setProductPitch(e.target.value)}
          placeholder="assistant IA vocal pour commerciaux terrain (roadbook, prepa RDV, debrief vocal, sync CRM)"
          rows={3}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{productPitch.length} caractères</span>
          {productPitch.trim() && productPitch.trim().length < 40 && (
            <span className="text-amber-500">Un peu court pour bien briefer le LLM</span>
          )}
          {productPitch.length > 400 && (
            <span className="text-amber-500">Vise plutôt 1-2 phrases denses</span>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={Mail}
          title="Signature email"
          hint="Apparait dans les emails de prospection via la variable de signature des templates."
        />
        <Textarea
          id="signature"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder={'Jean Dupont\nFondateur'}
          rows={4}
        />
        <div className="space-y-2">
          <Label htmlFor="hero_image_url" className="text-xs text-muted-foreground">Hero image (URL, optionnel)</Label>
          <Input
            id="hero_image_url"
            value={heroImageUrl}
            onChange={(e) => setHeroImageUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          icon={Bell}
          title="Notifications hebdomadaires"
          hint="Email récap envoyé lundi matin. Liste vide = pas d'envoi automatique."
        />
        <div className="space-y-2">
          <Label htmlFor="app_url">Lien dans l email (CTA)</Label>
          <Input
            id="app_url"
            type="url"
            value={appUrl}
            onChange={(e) => setAppUrl(e.target.value)}
            placeholder="https://example.com/prospection?tab=enterprises"
          />
        </div>
        <div className="space-y-2">
          <Label>Destinataires</Label>
          <RecipientsInput values={recipients} onChange={setRecipients} />
        </div>
      </section>

      <div className="flex justify-end pt-2 border-t border-border/40">
        <Button onClick={handleSave} disabled={!isDirty || mutation.isPending}>
          {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
