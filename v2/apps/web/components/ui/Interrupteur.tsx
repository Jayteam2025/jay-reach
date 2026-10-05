'use client';

export type InterrupteurProps = {
  actif: boolean;
  onChange?: (actif: boolean) => void;
  libelle: string;
  disabled?: boolean;
};

export function Interrupteur({ actif, onChange, libelle, disabled }: InterrupteurProps) {
  const classe = ['jr-interrupteur', !actif ? 'eteint' : undefined].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      disabled={disabled}
      className={classe}
      onClick={() => onChange?.(!actif)}
    />
  );
}
