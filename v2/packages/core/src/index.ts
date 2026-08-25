export * from './types.js';
export * from './contracts.js';
export * from './roles.js';
export * from './queues.js';
export * from './company-resolution.js';
export * from './signal-filters.js';
export * from './signal-jobboard.js';
export * from './persona-matching.js';
export * from './scoring.js';
export * from './enrichment-chain.js';
export * from './contact-locale.js';
export * from './contact-identification.js';
export * from './sequencer/index.js';
export * from './import/index.js';
export * from './linkedin/index.js';
export * from './inbox/index.js';

/** Version du paquet cœur — sert de sonde de santé au worker/web. */
export const CORE_VERSION = '0.0.0';
