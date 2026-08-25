// Le v2 n'utilise pas Tailwind (CSS maison, classes rs-*). Cette config vide
// empêche Next de remonter l'arborescence et d'attraper le postcss.config du v1
// (qui exige `tailwindcss`) quand v2/ est imbriqué sous le dépôt legacy.
export default { plugins: {} };
