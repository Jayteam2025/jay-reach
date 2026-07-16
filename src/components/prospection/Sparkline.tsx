interface SparklineProps {
  values: number[];
  color: string;
  className?: string;
}

/**
 * Mini-courbe SVG (aire + ligne), sans dépendance ni axes. Sert à donner une
 * tendance visuelle compacte à côté d'un chiffre. Couleur unique (pas de dégradé
 * multi-teinte) — l'aire est juste la même couleur en faible opacité.
 */
export function Sparkline({ values, color, className }: SparklineProps) {
  if (!values || values.length < 2) return null;
  const w = 100;
  const h = 32;
  const pad = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return [x, y] as const;
  });

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
