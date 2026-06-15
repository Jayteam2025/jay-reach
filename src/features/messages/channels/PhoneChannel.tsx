import { Phone } from 'lucide-react';
import { ChannelShell, ChannelHeader } from './ChannelShell';

export function PhoneChannel({ phone }: { phone: string }) {
  return (
    <ChannelShell accent="slate">
      <ChannelHeader Icon={Phone} label="Téléphone" accent="slate" />
      <p className="text-[13px] font-mono text-foreground">{phone}</p>
    </ChannelShell>
  );
}
