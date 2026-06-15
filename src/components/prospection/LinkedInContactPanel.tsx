import { X, Mail, Phone, Linkedin, TrendingUp, TrendingDown, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { ProspectSignal } from '@/hooks/useProspectSignals';

interface Props {
  signal: ProspectSignal;
  onClose: () => void;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} className="p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Field({ label, value, href, copyable }: { label: string; value: string | null | undefined; href?: string; copyable?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-2 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0 w-28">{label}</span>
      <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-violet-500 hover:text-violet-400 truncate transition-colors">
            {value}
          </a>
        ) : (
          <span className="text-sm text-foreground truncate text-right">{value}</span>
        )}
        {copyable && <CopyButton value={value} />}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-3">
      <h4 className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">{title}</h4>
      <div className="divide-y divide-border/30">{children}</div>
    </div>
  );
}

function formatCurrency(value: string | null | undefined): string | null {
  if (!value) return null;
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M\u00a0€`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(0)}k\u00a0€`;
  return `${num}\u00a0€`;
}

export function LinkedInContactPanel({ signal, onClose }: Props) {
  const ed = signal.extracted_data;

  const contactName = (ed.contact_name as string) || '—';
  const jobTitle = (ed.job_title as string) || (ed.linkedin_headline as string) || '';
  const email = (ed.contact_email as string) || null;
  const emailQual = (ed.email_qualification as string) || null;
  const phone = (ed.contact_phone as string) || null;
  const location = (ed.location as string) || null;
  const civility = (ed.civility as string) || null;
  const linkedinUrl = (ed.linkedin_url as string) || signal.source_url || null;

  const companyName = (ed.company_name as string) || signal.company_name || '—';
  const companyWebsite = (ed.company_website as string) || null;
  const companyLinkedin = (ed.company_linkedin as string) || null;
  const companyAddress = [ed.company_address, ed.company_zip, ed.company_city].filter(Boolean).join(', ') || null;
  const companyCountry = (ed.company_country as string) || null;
  const nbEmployees = (ed.nb_employees as string) || null;

  const siren = (ed.siren as string) || null;
  const siret = (ed.siret as string) || null;
  const nafCode = (ed.naf_code as string) || null;
  const nafLabel = (ed.naf_label as string) || null;
  const vatNumber = (ed.vat_number as string) || null;
  const turnover = formatCurrency(ed.company_turnover as string);
  const results = formatCurrency(ed.company_results as string);
  const isEnriched = ed.enriched === true;
  const enrichedBy = (ed.enriched_by as string) || null;

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-background border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-border">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {civility && <span className="text-xs text-muted-foreground">{civility}</span>}
            <h3 className="text-lg font-semibold text-foreground truncate">{contactName}</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-snug line-clamp-2">{jobTitle}</p>
          <p className="text-sm text-foreground font-medium mt-1">{companyName}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground shrink-0 ml-3">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 divide-y divide-border/50">
        {/* Contact */}
        <Section title="Contact">
          {email && (
            <div className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <a href={`mailto:${email}`} className="text-sm text-emerald-600 dark:text-emerald-400 hover:underline truncate">{email}</a>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {emailQual && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    emailQual.includes('nominatif') ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  }`}>
                    {emailQual.includes('nominatif') ? 'Verifie' : 'Catch-all'}
                  </span>
                )}
                <CopyButton value={email} />
              </div>
            </div>
          )}
          {!email && isEnriched && (
            <div className="py-1.5 flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Email non trouve</span>
            </div>
          )}
          {phone && (
            <div className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-blue-500" />
                <a href={`tel:${phone}`} className="text-sm text-foreground hover:underline">{phone}</a>
              </div>
              <CopyButton value={phone} />
            </div>
          )}
          {linkedinUrl && (
            <div className="flex items-center gap-2 py-1.5">
              <Linkedin className="h-3.5 w-3.5 text-sky-500" />
              <a href={linkedinUrl.startsWith('http') ? linkedinUrl : `https://${linkedinUrl}`} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-600 dark:text-sky-400 hover:underline truncate">
                Profil LinkedIn
              </a>
            </div>
          )}
          <Field label="Localisation" value={location} />
        </Section>

        {/* Entreprise */}
        <Section title="Entreprise">
          <Field label="Nom" value={companyName} />
          {companyWebsite && (
            <Field label="Site web" value={companyWebsite} href={companyWebsite.startsWith('http') ? companyWebsite : `https://${companyWebsite}`} />
          )}
          {companyLinkedin && (
            <Field label="LinkedIn" value="Page entreprise" href={companyLinkedin.startsWith('http') ? companyLinkedin : `https://${companyLinkedin}`} />
          )}
          <Field label="Effectifs" value={nbEmployees} />
          <Field label="Adresse" value={companyAddress} />
          <Field label="Pays" value={companyCountry} />
        </Section>

        {/* Financier */}
        {(turnover || results || siren) && (
          <Section title="Donnees financieres">
            {turnover && (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-muted-foreground w-28">Chiffre d'affaires</span>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-sm font-medium text-foreground">{turnover}</span>
                </div>
              </div>
            )}
            {results && (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-muted-foreground w-28">Resultat net</span>
                <div className="flex items-center gap-1.5">
                  {parseFloat(ed.company_results as string || '0') >= 0
                    ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                    : <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                  }
                  <span className="text-sm font-medium text-foreground">{results}</span>
                </div>
              </div>
            )}
            <Field label="SIREN" value={siren} copyable />
            <Field label="SIRET" value={siret} copyable />
            <Field label="NAF" value={nafCode && nafLabel ? `${nafCode} — ${nafLabel}` : nafCode} />
            <Field label="TVA" value={vatNumber} copyable />
          </Section>
        )}

        {/* Meta */}
        <Section title="Enrichissement">
          <Field label="Source" value={enrichedBy || (isEnriched ? 'fullenrich' : 'non enrichi')} />
          <Field label="Detecte le" value={new Date(signal.detected_at).toLocaleDateString('fr-FR')} />
        </Section>
      </div>
    </div>
  );
}
