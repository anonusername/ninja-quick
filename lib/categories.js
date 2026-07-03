/** Category slugs per game, as listed on poe.ninja's economy page. Shared between main.js
 * (background fetch) and test-integration.js so the two never drift out of sync. */
function getCategories(gameKey) {
  if (gameKey === 'poe1') {
    return [
      'currency',
      'fragments',
      'essences',
      'divination-cards',
      'unique-weapons',
      'unique-armours',
      'unique-accessories',
      'unique-flasks',
      'unique-jewels',
    ];
  }
  // POE2 categories (from poe.ninja economy page)
  return [
    'currency',
    'fragments',
    'abyssal-bones',
    'uncut-gems',
    'lineage-support-gems',
    'essences',
    'soul-cores',
    'idols',
    'runes',
    'omens',
    'expedition',
    'liquid-emotions',
    'breach-catalyst',
    'verisium',
    'unique-weapons',
    'unique-armours',
    'unique-accessories',
    'unique-flasks',
    'unique-charms',
    'unique-jewels',
    'unique-relics',
    'unique-tablets',
    'precursor-tablets',
  ];
}

module.exports = { getCategories };
