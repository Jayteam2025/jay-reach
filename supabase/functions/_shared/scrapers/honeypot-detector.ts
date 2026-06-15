const HONEYPOT_PREFIXES = [
  'noreply', 'no-reply', 'test', 'admin', 'info', 'support',
  'contact', 'hello', 'sales', 'marketing', 'webmaster',
  'postmaster', 'abuse', 'root', 'mailer-daemon',
];

const DISPOSABLE_DOMAINS = [
  'tempmail.com', 'guerrillamail.com', 'mailinator.com',
  'throwaway.email', 'yopmail.com', 'temp-mail.org',
  'dispostable.com', 'fakeinbox.com', 'sharklasers.com',
];

export function isHoneypotEmail(email: string): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  const [localPart, domain] = lower.split('@');
  if (!localPart || !domain) return true;

  if (HONEYPOT_PREFIXES.some(p => localPart === p || localPart.startsWith(p + '.'))) {
    return true;
  }

  if (DISPOSABLE_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
    return true;
  }

  return false;
}

export function isGenericEmail(email: string): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  const [localPart] = lower.split('@');
  const generic = ['info', 'contact', 'hello', 'sales', 'support', 'admin', 'office', 'rh', 'hr', 'recrutement'];
  return generic.includes(localPart);
}
