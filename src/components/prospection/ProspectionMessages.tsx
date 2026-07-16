import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProspectMessages, useApproveMessage, useMarkMessageSent } from '@/hooks/useProspectMessages';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MessageSquare,
  Copy,
  Check,
  Send,
  Mail,
  Instagram,
  Music,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type FilterStatus = 'all' | 'draft' | 'approved' | 'sent';

const CHANNEL_CONFIG = {
  email: { icon: Mail, label: 'Email', badgeClass: 'bg-blue-500/20 text-blue-700 dark:text-blue-200' },
  instagram: { icon: Instagram, label: 'Instagram', badgeClass: 'bg-pink-500/20 text-pink-700 dark:text-pink-200' },
  tiktok: { icon: Music, label: 'TikTok', badgeClass: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-200' },
};

const STATUS_LABEL = {
  draft: 'Brouillon',
  approved: 'Approuvé',
  sent: 'Envoyé',
  replied: 'Répondu',
  bounced: 'Rejeté',
};

export function ProspectionMessages() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading } = useProspectMessages(
    filter === 'all' ? undefined : { status: filter }
  );
  const approveMutation = useApproveMessage();
  const markSentMutation = useMarkMessageSent();

  const companies = useMemo(() => {
    const set = new Set<string>();
    (messages || []).forEach(m => {
      if (m.prospect?.company_name) set.add(m.prospect.company_name);
    });
    return Array.from(set).sort();
  }, [messages]);

  const displayedMessages = useMemo(() => {
    if (!companyFilter) return messages || [];
    return (messages || []).filter(m => m.prospect?.company_name === companyFilter);
  }, [messages, companyFilter]);

  const draftCount = messages.filter((m) => m.status === 'draft').length;

  const handleApprove = async (messageId: string) => {
    try {
      await approveMutation.mutateAsync({ id: messageId });
      toast({ description: 'Message approuvé' });
    } catch (error) {
      toast({
        description: 'Erreur lors de l\'approbation',
        variant: 'destructive',
      });
    }
  };

  const handleMarkSent = async (messageId: string) => {
    setSendingId(messageId);
    try {
      await markSentMutation.mutateAsync({ id: messageId });
      toast({ description: 'Message marqué comme envoyé' });
      queryClient.invalidateQueries({ queryKey: ['prospect-messages'] });
    } catch (error) {
      toast({
        description: 'Erreur: ' + (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setSendingId(null);
    }
  };

  const handleCopy = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);
      toast({ description: 'Copié dans le presse-papiers' });
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      toast({
        description: 'Erreur de copie',
        variant: 'destructive',
      });
    }
  };

  const manualChannels = ['instagram', 'tiktok'];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground title-glow">Messages</h1>
          {draftCount > 0 && (
            <p className="text-sm text-muted-foreground">{draftCount} brouillon(s) en attente d'approbation</p>
          )}
        </div>
        <Button variant="default" size="sm" className="gap-2">
          <Sparkles className="w-4 h-4" />
          Générer des messages
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          {[
            { value: 'draft' as FilterStatus, label: 'Brouillons' },
            { value: 'approved' as FilterStatus, label: 'Approuvés' },
            { value: 'sent' as FilterStatus, label: 'Envoyés' },
            { value: 'all' as FilterStatus, label: 'Tous' },
          ].map((tab) => (
            <Button
              key={tab.value}
              variant={filter === tab.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Company Filter */}
        {companies.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setCompanyFilter(null)}
              className={`text-xs px-2 py-1 rounded ${!companyFilter ? 'bg-violet-500/15 text-violet-600' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Toutes
            </button>
            {companies.map(c => (
              <button
                key={c}
                onClick={() => setCompanyFilter(c)}
                className={`text-xs px-2 py-1 rounded truncate max-w-[150px] ${companyFilter === c ? 'bg-violet-500/15 text-violet-600' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Messages List */}
      <div className="grid gap-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : displayedMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <MessageSquare className="h-10 w-10 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">Aucun message</p>
          </div>
        ) : (
          displayedMessages.map((message) => {
            const channelConfig = CHANNEL_CONFIG[message.channel as keyof typeof CHANNEL_CONFIG];
            const ChannelIcon = channelConfig?.icon || MessageSquare;
            const isManualChannel = manualChannels.includes(message.channel);

            return (
              <div
                key={message.id}
                className="flex flex-col gap-3 rounded-lg glass p-4 transition-colors hover:shadow-md"
              >
                {/* Row 1: Prospect + Channel Badge + Status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h3 className="font-medium text-foreground">
                      {message.prospect?.first_name} {message.prospect?.last_name}
                    </h3>
                    <p className="text-sm text-muted-foreground">{message.prospect?.company_name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={channelConfig?.badgeClass}>
                      <ChannelIcon className="h-3 w-3 mr-1" />
                      {channelConfig?.label}
                    </Badge>
                    <Badge variant="secondary">{STATUS_LABEL[message.status as keyof typeof STATUS_LABEL]}</Badge>
                  </div>
                </div>

                {/* Row 2: Subject (if applicable) */}
                {message.subject && (
                  <div>
                    <p className="text-sm font-medium text-foreground line-clamp-1">{message.subject}</p>
                  </div>
                )}

                {/* Row 3: Body Preview */}
                <div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {message.body.substring(0, 150)}
                    {message.body.length > 150 ? '...' : ''}
                  </p>
                </div>

                {/* Row 4: Meta + Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    {message.sent_at
                      ? `Envoyé le ${new Date(message.sent_at).toLocaleDateString('fr-FR')}`
                      : `Créé le ${new Date(message.created_at).toLocaleDateString('fr-FR')}`}
                  </p>

                  <div className="flex gap-2">
                    {message.status === 'draft' && (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleApprove(message.id)}
                          disabled={approveMutation.isPending}
                        >
                          {approveMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          Approuver
                        </Button>
                        <Button size="sm" variant="outline">
                          Modifier
                        </Button>
                      </>
                    )}

                    {message.status === 'approved' && (
                      <>
                        {isManualChannel && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCopy(message.body, message.id)}
                            className={copiedId === message.id ? 'ring-2 ring-green-500' : ''}
                          >
                            {copiedId === message.id ? (
                              <Check className="h-3 w-3 mr-1" />
                            ) : (
                              <Copy className="h-3 w-3 mr-1" />
                            )}
                            {copiedId === message.id ? 'Copié' : 'Copier'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleMarkSent(message.id)}
                          disabled={sendingId === message.id || markSentMutation.isPending}
                        >
                          {sendingId === message.id || markSentMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Send className="h-3 w-3 mr-1" />
                          )}
                          Marquer envoyé
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
