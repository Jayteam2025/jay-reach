import { motion } from 'framer-motion';
import { Map, CircleDot, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROADMAP, type RoadmapStage } from '@/lib/roadmap';
import { fadeUp, staggerContainer, staggerProps } from '@/lib/motion';

/**
 * Roadmap produit en trois horizons (Now / Next / Later), SANS dates.
 * Contenu statique defini dans src/lib/roadmap.ts.
 */

// Accent visuel par horizon : icone de tete de colonne + teinte du liseré.
const STAGE_STYLE: Record<
  RoadmapStage,
  { icon: typeof CircleDot; dot: string; accent: string }
> = {
  now: { icon: CircleDot, dot: 'bg-emerald-500', accent: 'text-emerald-500' },
  next: { icon: ArrowRight, dot: 'bg-violet-500', accent: 'text-violet-500' },
  later: { icon: Sparkles, dot: 'bg-sky-500', accent: 'text-sky-500' },
};

export function ProspectionRoadmap() {
  return (
    <div className="max-w-6xl space-y-8">
      <header className="flex items-center gap-3">
        <Map className="w-5 h-5 text-violet-500" />
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Roadmap</h2>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {ROADMAP.map((column) => {
          const style = STAGE_STYLE[column.stage];
          const Icon = style.icon;
          return (
            <motion.section
              key={column.stage}
              {...staggerProps}
              className="flex flex-col gap-4"
            >
              {/* Tete de colonne */}
              <div className="flex items-baseline gap-2.5 px-1">
                <span className={cn('flex h-2 w-2 shrink-0 translate-y-0.5 rounded-full', style.dot)} aria-hidden />
                <Icon className={cn('w-4 h-4 shrink-0 self-center', style.accent)} />
                <h3 className="text-[15px] font-semibold leading-none tracking-tight text-foreground">
                  {column.label}
                </h3>
              </div>

              {/* Cartes de l'horizon */}
              <motion.div variants={staggerContainer} className="flex flex-col gap-3">
                {column.items.length === 0 ? (
                  <motion.div
                    variants={fadeUp}
                    className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-[13px] text-muted-foreground"
                  >
                    Rien pour le moment
                  </motion.div>
                ) : (
                  column.items.map((item) => (
                    <motion.article
                      key={item.id}
                      variants={fadeUp}
                      className="glass rounded-lg p-4 transition-transform duration-200 hover:-translate-y-0.5"
                    >
                      <h4 className="text-sm font-semibold leading-snug tracking-tight text-foreground">
                        {item.title}
                      </h4>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/70">
                        {item.description}
                      </p>
                    </motion.article>
                  ))
                )}
              </motion.div>
            </motion.section>
          );
        })}
      </div>
    </div>
  );
}
