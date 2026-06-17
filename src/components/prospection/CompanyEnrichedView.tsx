import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  X, Mail, Phone, Linkedin, Instagram, Music, FileText,
  Copy, Check, Building2, Users, User, MapPin, Loader2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';

interface Prospect {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  target_category: 'director' | 'field_sales' | 'hr';
  /** Persona resolu via join icp_personas (Jay Reach 1.2.2+). */
  persona: { id: string; slug: string; label: string; channels_priority: string[] } | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  company_city: string | null;
  deleted_at: string | null;
}

function getProspectLabel(p: Prospect, fallback: string): string {
  return p.persona?.label ?? fallback;
}

interface ProspectMessage {
  id: string;
  prospect_id: string;
  channel: string;
  subject: string | null;
  body: string;
  icebreaker: string | null;
  status: string;
  sent_at: string | null;
}

interface Props {
  companyGroupId: string;
  companyName: string;
  onClose: () => void;
}

const CATEGORY_LABELS = {
  hr: { label: 'RH', icon: Users },
  director: { label: 'Directeur Commercial', icon: Building2 },
  field_sales: { label: 'Commercial terrain', icon: User },
};

const CHANNEL_ICONS = {
  email: Mail,
  instagram: Instagram,
  tiktok: Music,
  letter: FileText,
};

function CopyButton({ value, id }: { value: string; id: string }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
    >
      {copiedId === id ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function ProfileCard({
  prospect,
  messages,
}: {
  prospect: Prospect;
  messages: ProspectMessage[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleMarkSent = async (messageId: string) => {
    try {
      const { error } = await supabase
        .from('prospect_messages')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['enriched-company', prospect.id] });
      toast({ description: 'Message marqué comme envoyé' });
    } catch (err) {
      logger.error('Error marking message as sent', err);
      toast({
        variant: 'destructive',
        description: 'Erreur lors de la mise à jour du message',
      });
    }
  };

  const fullName = `${prospect.first_name} ${prospect.last_name}`;
  const hasEmail = !!prospect.email;
  const hasLinkedIn = !!prospect.linkedin_url;

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden bg-muted/20">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="pt-0.5 shrink-0">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <h4 className="text-sm font-semibold text-foreground truncate">{fullName}</h4>
            <p className="text-xs text-muted-foreground truncate">{prospect.job_title || '—'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {hasEmail && (
            <Badge variant="secondary" className="text-[10px] px-1.5">
              <Mail className="h-2.5 w-2.5 mr-1" />
              Email
            </Badge>
          )}
          {hasLinkedIn && (
            <Badge variant="secondary" className="text-[10px] px-1.5">
              <Linkedin className="h-2.5 w-2.5 mr-1" />
              LinkedIn
            </Badge>
          )}
          {messages.length > 0 && (
            <Badge className="text-[10px] px-1.5 bg-violet-600 text-white">
              {messages.length}
            </Badge>
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-border/30 bg-background/40 p-3 space-y-3">
          {/* Contact Info */}
          <div className="space-y-2 text-xs">
            {prospect.email && (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <a
                    href={`mailto:${prospect.email}`}
                    className="text-emerald-600 dark:text-emerald-400 hover:underline truncate"
                  >
                    {prospect.email}
                  </a>
                </div>
                <CopyButton value={prospect.email} id={`email-${prospect.id}`} />
              </div>
            )}

            {prospect.phone && (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <a href={`tel:${prospect.phone}`} className="hover:underline text-foreground">
                    {prospect.phone}
                  </a>
                </div>
                <CopyButton value={prospect.phone} id={`phone-${prospect.id}`} />
              </div>
            )}

            {prospect.linkedin_url && (
              <div className="flex items-center gap-2">
                <Linkedin className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                <a
                  href={prospect.linkedin_url.startsWith('http') ? prospect.linkedin_url : `https://${prospect.linkedin_url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-600 dark:text-sky-400 hover:underline truncate"
                >
                  Profil LinkedIn
                </a>
              </div>
            )}

            {prospect.company_city && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {prospect.company_city}
              </div>
            )}
          </div>

          {/* Messages */}
          {messages.length > 0 && (
            <div className="space-y-2 border-t border-border/30 pt-2">
              <h5 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Messages ({messages.length})
              </h5>
              <div className="space-y-2">
                {messages.map(msg => {
                  const ChannelIcon = CHANNEL_ICONS[msg.channel as keyof typeof CHANNEL_ICONS] || Mail;
                  const isSent = msg.status === 'sent';

                  return (
                    <div
                      key={msg.id}
                      className="bg-background border border-border/30 rounded p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <ChannelIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-[10px] font-medium text-muted-foreground uppercase truncate">
                            {msg.channel}
                          </span>
                          {isSent && (
                            <Badge className="text-[10px] px-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              Envoyé
                            </Badge>
                          )}
                          {!isSent && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1"
                            >
                              Brouillon
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <CopyButton value={msg.body} id={`msg-${msg.id}`} />
                          {!isSent && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => handleMarkSent(msg.id)}
                            >
                              Envoyer
                            </Button>
                          )}
                        </div>
                      </div>

                      {msg.subject && (
                        <p className="text-[10px] font-medium text-foreground">
                          {msg.subject}
                        </p>
                      )}

                      <p className="text-[10px] text-muted-foreground line-clamp-4">
                        {msg.body}
                      </p>

                      {msg.icebreaker && (
                        <p className="text-[10px] text-violet-600 dark:text-violet-400 italic line-clamp-2">
                          Icebreaker: {msg.icebreaker}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategorySection({
  category,
  profiles,
  messagesMap,
}: {
  category: 'hr' | 'director' | 'field_sales';
  profiles: Prospect[];
  messagesMap: Record<string, ProspectMessage[]>;
}) {
  if (profiles.length === 0) return null;

  const config = CATEGORY_LABELS[category];
  const Icon = config.icon;
  // Label dynamique = persona.label du 1er profile (fallback config.label legacy).
  const heading = profiles[0] ? getProspectLabel(profiles[0], config.label) : config.label;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Icon className="h-4 w-4 text-violet-500" />
        <h3 className="text-sm font-semibold text-foreground">
          {heading}
        </h3>
        <Badge variant="secondary" className="text-[10px]">
          {profiles.length}
        </Badge>
      </div>

      <div className="space-y-2">
        {profiles.map(prospect => (
          <ProfileCard
            key={prospect.id}
            prospect={prospect}
            messages={messagesMap[prospect.id] || []}
          />
        ))}
      </div>
    </div>
  );
}

export function CompanyEnrichedView({
  companyGroupId,
  companyName,
  onClose,
}: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['enriched-company', companyGroupId],
    queryFn: async () => {
      // Fetch profiles avec join icp_personas pour resoudre persona
      const { data: rawProfiles, error: profileError } = await supabase
        .from('prospect_profiles')
        .select('*, icp_personas:persona_id(id, slug, label, channels_priority)')
        .eq('company_group_id', companyGroupId)
        .is('deleted_at', null)
        .order('target_category');

      if (profileError) throw profileError;

      if (!rawProfiles || rawProfiles.length === 0) {
        return { profiles: [], messages: [] };
      }

      // Denormalise icp_personas join -> persona
      const profiles: Prospect[] = (
        rawProfiles as Array<Omit<Prospect, 'persona'> & { icp_personas: Prospect['persona'] }>
      ).map(({ icp_personas, ...rest }) => ({ ...rest, persona: icp_personas ?? null }));

      const profileIds = profiles.map((p) => p.id);

      // Fetch messages
      const { data: messages, error: messageError } = await supabase
        .from('prospect_messages')
        .select('id, prospect_id, channel, subject, body, icebreaker, status, sent_at')
        .in('prospect_id', profileIds)
        .order('channel');

      if (messageError) throw messageError;

      return { profiles, messages: messages };
    },
  });

  const profiles = data?.profiles || [];
  const allMessages = data?.messages || [];

  // Group messages by prospect
  const messagesMap = allMessages.reduce(
    (acc, msg) => {
      if (!acc[msg.prospect_id]) {
        acc[msg.prospect_id] = [];
      }
      const group = acc[msg.prospect_id];
      if (group) {
        group.push(msg);
      }
      return acc;
    },
    {} as Record<string, ProspectMessage[]>,
  );

  // Group profiles by category
  const categorized = {
    hr: profiles.filter(p => p.target_category === 'hr'),
    director: profiles.filter(p => p.target_category === 'director'),
    field_sales: profiles.filter(p => p.target_category === 'field_sales'),
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[600px] max-w-[100%] bg-background border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-border shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-foreground truncate">
            {companyName}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {profiles.length} contact{profiles.length !== 1 ? 's' : ''} enrichis
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground shrink-0 ml-3"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
          </div>
        )}

        {error && (
          <div className="py-8 px-4 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-600 dark:text-red-400">
            Erreur lors du chargement des données
          </div>
        )}

        {!isLoading && profiles.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-muted-foreground text-sm">
              Aucun contact enrichi pour cette entreprise
            </p>
          </div>
        )}

        {!isLoading && profiles.length > 0 && (
          <div className="space-y-6">
            <CategorySection
              category="hr"
              profiles={categorized.hr}
              messagesMap={messagesMap}
            />
            <CategorySection
              category="director"
              profiles={categorized.director}
              messagesMap={messagesMap}
            />
            <CategorySection
              category="field_sales"
              profiles={categorized.field_sales}
              messagesMap={messagesMap}
            />
          </div>
        )}
      </div>
    </div>
  );
}
