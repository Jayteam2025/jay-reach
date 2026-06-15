import { useState, useMemo } from 'react';
import { useLinkedInContacts, useUpdateLinkedInStatus, type LinkedInContact, type LinkedInContactStatus } from '@/hooks/useLinkedInContacts';
import { useCrossDetection, normalizeName } from '@/hooks/useCrossDetection';
import { useEnqueueLinkedInInvitations, useLinkedInQueueMap, type LinkedInQueueItem } from '@/hooks/useLinkedInInvitation';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Linkedin, Loader2, ExternalLink, Mail, Phone, Copy, Check,
  X, Building2, Send, Download, Clock, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const STATUS_CONFIG: Record<LinkedInContactStatus, { label: string; dot: string }> = {
  nouveau: { label: 'Nouveau', dot: 'bg-violet-500' },
  ajoute: { label: 'Ajoute', dot: 'bg-amber-500' },
  message_envoye: { label: 'Message envoye', dot: 'bg-emerald-500' },
  ignore: { label: 'Ignore', dot: 'bg-muted-foreground/30' },
};

const STATUS_ORDER: LinkedInContactStatus[] = ['nouveau', 'ajoute', 'message_envoye', 'ignore'];

export function ProspectionContactsLinkedIn() {
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<LinkedInContactStatus | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: contacts = [], isLoading } = useLinkedInContacts();
  const { data: enrichedMap = new Map() } = useCrossDetection();
  const { data: queueMaps } = useLinkedInQueueMap();
  const queueMap = queueMaps?.bySignal ?? new Map<string, LinkedInQueueItem>();
  const enqueueMutation = useEnqueueLinkedInInvitations();
  const { toast } = useToast();

  const selectedContact = selectedContactId
    ? contacts.find(c => c.id === selectedContactId) ?? null
    : null;

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return contacts;
    return contacts.filter(c => c.contact_status === statusFilter);
  }, [contacts, statusFilter]);

  const counts = useMemo(() => {
    const out: Record<LinkedInContactStatus | 'all', number> = {
      all: contacts.length,
      nouveau: 0,
      ajoute: 0,
      message_envoye: 0,
      ignore: 0,
    };
    for (const c of contacts) out[c.contact_status]++;
    return out;
  }, [contacts]);

  // Filter selected ids to only those visible (drop ones from previous filters)
  const visibleSelectedIds = useMemo(() => {
    const visible = new Set(filtered.map(c => c.id));
    return new Set([...selectedIds].filter(id => visible.has(id)));
  }, [selectedIds, filtered]);

  // For bulk actions, eligible = has linkedin_url AND not already in active queue
  const eligibleForInvite = useMemo(() => {
    return [...visibleSelectedIds].filter(id => {
      const c = contacts.find(x => x.id === id);
      if (!c) return false;
      const ed = (c.extracted_data) || {};
      const url = (ed.linkedin_url as string) || '';
      if (!url) return false;
      const q = queueMap.get(id);
      if (q && (q.status === 'pending' || q.status === 'processing' || q.status === 'sent')) return false;
      return true;
    });
  }, [visibleSelectedIds, contacts, queueMap]);

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) {
        for (const c of filtered) next.add(c.id);
      } else {
        for (const c of filtered) next.delete(c.id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkInvite = async () => {
    if (eligibleForInvite.length === 0) return;
    try {
      const result = await enqueueMutation.mutateAsync({
        signal_ids: eligibleForInvite,
        method: 'extension_auto',
      });
      const parts = [`${result.enqueued} ajoute${result.enqueued > 1 ? 's' : ''} a la file`];
      if (result.skipped.already_in_queue) parts.push(`${result.skipped.already_in_queue} deja en file`);
      if (result.skipped.no_linkedin_url) parts.push(`${result.skipped.no_linkedin_url} sans URL`);
      toast({ description: parts.join(' · ') });
      clearSelection();
    } catch (err) {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'Erreur ajout file',
      });
    }
  };

  const handleExportCsv = async () => {
    if (visibleSelectedIds.size === 0) return;
    const rows = [...visibleSelectedIds]
      .map(id => contacts.find(c => c.id === id))
      .filter((c): c is LinkedInContact => !!c);

    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin-cowork-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    // Marque les contacts comme cowork_csv pour eviter doublon avec auto
    try {
      await enqueueMutation.mutateAsync({
        signal_ids: rows.map(r => r.id),
        method: 'cowork_csv',
      });
      toast({ description: `${rows.length} contact${rows.length > 1 ? 's' : ''} export${rows.length > 1 ? 'es' : 'e'} pour cowork` });
    } catch {
      toast({ description: `CSV genere (${rows.length} contacts) — non marques en file (verifier console)` });
    }
    clearSelection();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Linkedin className="h-6 w-6" />
            Contacts LinkedIn
          </h1>
          <Badge variant="secondary" className="text-base px-3 py-1">
            {contacts.length}
          </Badge>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        <FilterTab
          label="Tout"
          count={counts.all}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        {STATUS_ORDER.map(status => (
          <FilterTab
            key={status}
            label={STATUS_CONFIG[status].label}
            count={counts[status]}
            active={statusFilter === status}
            onClick={() => setStatusFilter(status)}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Linkedin className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-lg text-muted-foreground">
            {contacts.length === 0 ? 'Aucun contact LinkedIn scrape' : 'Aucun contact dans ce statut'}
          </p>
        </div>
      ) : (
        <ContactsTable
          contacts={filtered}
          enrichedMap={enrichedMap}
          queueMap={queueMap}
          selectedIds={visibleSelectedIds}
          onSelect={c => setSelectedContactId(c.id)}
          onToggleOne={toggleOne}
          onToggleAll={toggleAllVisible}
          selectedId={selectedContactId}
        />
      )}

      {selectedContact && (
        <ContactSidePanel
          contact={selectedContact}
          enrichedMap={enrichedMap}
          onClose={() => setSelectedContactId(null)}
        />
      )}

      {visibleSelectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={visibleSelectedIds.size}
          eligibleCount={eligibleForInvite.length}
          isPending={enqueueMutation.isPending}
          onInvite={handleBulkInvite}
          onExport={handleExportCsv}
          onClear={clearSelection}
        />
      )}
    </div>
  );
}

function FilterTab({
  label, count, active, onClick,
}: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-2 text-[13px] transition-colors border-b -mb-px flex items-center gap-2',
        active
          ? 'text-foreground border-foreground font-medium'
          : 'text-muted-foreground border-transparent hover:text-foreground'
      )}
    >
      {label}
      <span className="text-[11px] font-mono tabular-nums opacity-60">{count}</span>
    </button>
  );
}

function QueueIndicator({ item }: { item: LinkedInQueueItem | undefined }) {
  if (!item) return null;
  if (item.status === 'pending' || item.status === 'processing') {
    return (
      <span title={`En file (${item.method})`} className="inline-flex items-center text-amber-500">
        <Clock className="w-3 h-3" />
      </span>
    );
  }
  if (item.status === 'failed') {
    return (
      <span title={item.error_message || 'Echec invitation'} className="inline-flex items-center text-red-500">
        <AlertCircle className="w-3 h-3" />
      </span>
    );
  }
  return null;
}

function ContactsTable({
  contacts,
  enrichedMap,
  queueMap,
  selectedIds,
  onSelect,
  onToggleOne,
  onToggleAll,
  selectedId,
}: {
  contacts: LinkedInContact[];
  enrichedMap: Map<string, string>;
  queueMap: Map<string, LinkedInQueueItem>;
  selectedIds: Set<string>;
  onSelect: (c: LinkedInContact) => void;
  onToggleOne: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  selectedId: string | null;
}) {
  const allChecked = contacts.length > 0 && contacts.every(c => selectedIds.has(c.id));
  const someChecked = !allChecked && contacts.some(c => selectedIds.has(c.id));
  const headerState: boolean | 'indeterminate' = allChecked ? true : someChecked ? 'indeterminate' : false;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="p-3 w-10">
              <Checkbox
                checked={headerState}
                onCheckedChange={(v) => onToggleAll(v === true)}
                aria-label="Tout selectionner"
              />
            </th>
            <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Nom</th>
            <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Poste</th>
            <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Entreprise</th>
            <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Lieu</th>
            <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Statut</th>
            <th className="p-3 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {contacts.map(contact => {
            const ed = (contact.extracted_data) || {};
            const name = (ed.contact_name as string) || '—';
            const title = (ed.job_title as string) || '—';
            const company = (ed.company_name as string) || contact.company_name || '—';
            const location = (ed.location as string) || '—';
            const linkedinUrl = (ed.linkedin_url as string) || '';
            const isEnriched = enrichedMap.has(normalizeName(company));
            const status = STATUS_CONFIG[contact.contact_status];
            const queueItem = queueMap.get(contact.id);
            const isChecked = selectedIds.has(contact.id);

            return (
              <tr
                key={contact.id}
                className={cn(
                  'border-b border-border/50 cursor-pointer transition-colors',
                  selectedId === contact.id ? 'bg-muted/60' : isChecked ? 'bg-violet-500/5 hover:bg-violet-500/10' : 'hover:bg-muted/30'
                )}
                onClick={() => onSelect(contact)}
              >
                <td className="p-3" onClick={e => e.stopPropagation()}>
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={(v) => onToggleOne(contact.id, v === true)}
                    aria-label={`Selectionner ${name}`}
                  />
                </td>
                <td className="p-3 font-medium text-foreground">{name}</td>
                <td className="p-3 text-[13px] text-muted-foreground max-w-[200px] truncate">{title}</td>
                <td className="p-3 text-[13px] text-foreground">
                  <div className="flex items-center gap-1.5">
                    <span>{company}</span>
                    {isEnriched && (
                      <span title="Entreprise dans le flux Entreprises">
                        <Building2 className="w-3 h-3 text-violet-500 shrink-0" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-3 text-[13px] text-muted-foreground">{location}</td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span className={cn('w-1.5 h-1.5 rounded-full', status.dot)} />
                    {status.label}
                    <QueueIndicator item={queueItem} />
                  </span>
                </td>
                <td className="p-3">
                  {linkedinUrl && (
                    <a
                      href={linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BulkActionBar({
  selectedCount,
  eligibleCount,
  isPending,
  onInvite,
  onExport,
  onClear,
}: {
  selectedCount: number;
  eligibleCount: number;
  isPending: boolean;
  onInvite: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const skipped = selectedCount - eligibleCount;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
      <div className="flex items-center gap-3 rounded-full border border-border bg-card/95 backdrop-blur shadow-lg pl-5 pr-2 py-2">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-medium text-foreground">{selectedCount} selectionne{selectedCount > 1 ? 's' : ''}</span>
          {skipped > 0 && (
            <span className="text-[11px] text-muted-foreground">
              ({skipped} non eligible{skipped > 1 ? 's' : ''})
            </span>
          )}
        </div>
        <div className="h-5 w-px bg-border" />
        <Button
          size="sm"
          variant="default"
          className="gap-1.5 h-8"
          disabled={eligibleCount === 0 || isPending}
          onClick={onInvite}
        >
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Inviter {eligibleCount}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8"
          disabled={selectedCount === 0 || isPending}
          onClick={onExport}
        >
          <Download className="w-3.5 h-3.5" />
          CSV cowork
        </Button>
        <button
          onClick={onClear}
          className="p-1.5 rounded-full hover:bg-muted/50 text-muted-foreground hover:text-foreground"
          aria-label="Annuler la selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function buildCsv(rows: LinkedInContact[]): string {
  const headers = ['nom', 'poste', 'entreprise', 'lieu', 'linkedin_url', 'message'];
  const escape = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    const ed = (r.extracted_data) || {};
    lines.push([
      (ed.contact_name as string) || '',
      (ed.job_title as string) || '',
      (ed.company_name as string) || r.company_name || '',
      (ed.location as string) || '',
      (ed.linkedin_url as string) || '',
      (ed.linkedin_message as string) || '',
    ].map(v => escape(String(v))).join(','));
  }
  return lines.join('\n');
}

function ContactSidePanel({
  contact,
  enrichedMap,
  onClose,
}: {
  contact: LinkedInContact;
  enrichedMap: Map<string, string>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [, setSearchParams] = useSearchParams();
  const updateStatus = useUpdateLinkedInStatus();
  const enqueueMutation = useEnqueueLinkedInInvitations();
  const { data: queueMaps } = useLinkedInQueueMap();
  const queueMap = queueMaps?.bySignal ?? new Map<string, LinkedInQueueItem>();
  const { toast } = useToast();

  const ed = (contact.extracted_data) || {};
  const name = (ed.contact_name as string) || '—';
  const title = (ed.job_title as string) || '—';
  const company = (ed.company_name as string) || contact.company_name || '—';
  const location = (ed.location as string) || '';
  const email = (ed.contact_email as string) || null;
  const phone = (ed.contact_phone as string) || null;
  const linkedinUrl = (ed.linkedin_url as string) || '';

  const enrichedGroupId = enrichedMap.get(normalizeName(company));
  const queueItem = queueMap.get(contact.id);
  const canInvite = !!linkedinUrl && (!queueItem || queueItem.status === 'failed' || queueItem.status === 'cancelled');

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleStatusChange = async (status: LinkedInContactStatus) => {
    await updateStatus.mutateAsync({ signalId: contact.id, status });
    toast({ description: `Statut mis a jour : ${STATUS_CONFIG[status].label}` });
  };

  const handleOpenEntreprises = () => {
    setSearchParams({ tab: 'entreprises' });
  };

  const handleSingleInvite = async () => {
    try {
      const result = await enqueueMutation.mutateAsync({
        signal_ids: [contact.id],
        method: 'extension_auto',
      });
      if (result.enqueued > 0) {
        toast({ description: 'Ajoute a la file d\'invitation' });
      } else {
        toast({ variant: 'destructive', description: 'Non ajoute (deja en file ou pas eligible)' });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  const linkedinMessage = (ed.linkedin_message as string) || null;

  return (
    <div className="fixed inset-y-0 right-0 w-[440px] bg-background border-l border-border overflow-y-auto z-50">
      <div className="sticky top-0 bg-background/95 backdrop-blur border-b border-border px-6 py-3 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">
          Contact LinkedIn
        </span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 py-6">
        {enrichedGroupId && (
          <button
            onClick={handleOpenEntreprises}
            className="w-full mb-6 flex items-center justify-between gap-3 text-left group"
          >
            <span className="text-[12px] text-violet-500 group-hover:underline underline-offset-2">
              {company} est dans Entreprises · voir la fiche
            </span>
            <ExternalLink className="w-3 h-3 text-violet-500 shrink-0" />
          </button>
        )}

        <div>
          <h3 className="text-[20px] font-semibold text-foreground leading-tight tracking-tight">{name}</h3>
          <p className="text-[13px] text-muted-foreground mt-1">{title}</p>
          <p className="text-[13px] text-foreground mt-0.5">{company}</p>
          {location && (
            <p className="text-[12px] text-muted-foreground/70 mt-0.5">{location}</p>
          )}
        </div>

        {(email || phone || linkedinUrl) && (
          <div className="mt-5 flex flex-col gap-2">
            {email && (
              <button
                onClick={() => handleCopy(email, 'email')}
                className="group flex items-center gap-2 text-[13px] font-mono tabular-nums text-foreground hover:text-violet-500 transition-colors text-left"
              >
                <Mail className="w-3 h-3 shrink-0 text-muted-foreground/60" />
                <span className="truncate">{email}</span>
                {copied === 'email' ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            )}
            {phone && (
              <button
                onClick={() => handleCopy(phone, 'phone')}
                className="group flex items-center gap-2 text-[13px] font-mono tabular-nums text-foreground hover:text-violet-500 transition-colors text-left"
              >
                <Phone className="w-3 h-3 shrink-0 text-muted-foreground/60" />
                <span>{phone}</span>
                {copied === 'phone' ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            )}
            {linkedinUrl && (
              <a
                href={linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2 text-[13px] text-foreground hover:text-violet-500 transition-colors"
              >
                <Linkedin className="w-3 h-3 shrink-0 text-muted-foreground/60" />
                <span>Profil LinkedIn</span>
                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            )}
          </div>
        )}

        {linkedinUrl && (
          <div className="mt-6 pt-6 border-t border-border/60">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest block mb-3">
              Invitation auto
            </span>
            {queueItem ? (
              <QueueStatusBlock item={queueItem} />
            ) : null}
            <Button
              variant={canInvite ? 'default' : 'outline'}
              size="sm"
              className="gap-2 h-8 mt-2"
              onClick={handleSingleInvite}
              disabled={!canInvite || enqueueMutation.isPending}
            >
              {enqueueMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {queueItem?.status === 'failed' ? 'Reessayer l\'invitation' : 'Ajouter a la file'}
            </Button>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-border/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">
              Message LinkedIn
            </span>
            {linkedinMessage && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] gap-1 -mr-2"
                onClick={() => handleCopy(linkedinMessage, 'message')}
              >
                {copied === 'message' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-500" /> Copie
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Copier
                  </>
                )}
              </Button>
            )}
          </div>
          {linkedinMessage ? (
            <p className="text-[13px] text-muted-foreground whitespace-pre-line leading-relaxed">
              {linkedinMessage}
            </p>
          ) : (
            <div className="py-2">
              <p className="text-[12px] text-muted-foreground/70">
                Aucun message.
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-6 border-t border-border/60">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest block mb-3">
            Statut
          </span>
          <div className="flex flex-wrap gap-1">
            {STATUS_ORDER.map(status => {
              const config = STATUS_CONFIG[status];
              const isActive = contact.contact_status === status;
              return (
                <button
                  key={status}
                  onClick={() => handleStatusChange(status)}
                  disabled={updateStatus.isPending}
                  className={cn(
                    'px-3 py-1.5 text-[12px] rounded border transition-colors',
                    isActive
                      ? 'bg-foreground text-background border-foreground font-medium'
                      : 'bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
                  )}
                >
                  {config.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function QueueStatusBlock({ item }: { item: LinkedInQueueItem }) {
  const labels: Record<LinkedInQueueItem['status'], { label: string; dot: string }> = {
    pending: { label: 'En attente d\'envoi', dot: 'bg-amber-500' },
    processing: { label: 'Envoi en cours', dot: 'bg-amber-500 animate-pulse' },
    sent: { label: 'Invitation envoyee', dot: 'bg-emerald-500' },
    failed: { label: 'Echec', dot: 'bg-red-500' },
    cancelled: { label: 'Annulee', dot: 'bg-muted-foreground/30' },
  };
  const cfg = labels[item.status];
  return (
    <div className="text-[12px] text-muted-foreground space-y-1">
      <div className="inline-flex items-center gap-1.5">
        <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
        {cfg.label}
        {item.method === 'cowork_csv' && <span className="text-[11px] opacity-70">(cowork)</span>}
      </div>
      {item.sent_at && (
        <div className="text-[11px] text-muted-foreground/70">
          Envoye le {new Date(item.sent_at).toLocaleDateString('fr-FR')} a {new Date(item.sent_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
      {item.error_message && item.status === 'failed' && (
        <div className="text-[11px] text-red-500/80">{item.error_message}</div>
      )}
    </div>
  );
}
