import catalog from './catalog.json' with { type: 'json' };

export function listCommands({ search = '', category = '', status = '' } = {}) {
  const needle = String(search).trim().toLowerCase();
  const cat = String(category).trim().toLowerCase();
  return catalog.filter((item) => {
    const matchesSearch = !needle || [item.name, item.description, item.category, item.usage].some((value) => value.toLowerCase().includes(needle));
    const matchesCategory = !cat || item.category.toLowerCase() === cat;
    const matchesStatus = !status || item.status === status;
    return matchesSearch && matchesCategory && matchesStatus;
  });
}

export function getCatalogSummary() {
  const implemented = catalog.filter((item) => item.status === 'implemented').length;
  const notImplemented = catalog.length - implemented;
  return { total: catalog.length, implemented, notImplemented };
}

export function isCommandConfigured(item) {
  switch (item.apiRequirement) {
    case 'provider key': return Boolean(process.env.OPENAI_API_KEY);
    case 'TMDB_API_KEY': return Boolean(process.env.TMDB_API_KEY);
    case 'WEATHER_API_KEY': return Boolean(process.env.WEATHER_API_KEY);
    case 'shortener API': return true;
    default: return true;
  }
}

export function getLiveCatalogSummary() {
  const ready = catalog.filter((item) => item.status === 'implemented' && isCommandConfigured(item)).length;
  const needsSetup = catalog.filter((item) => item.status === 'implemented' && !isCommandConfigured(item)).length;
  return { ...getCatalogSummary(), ready, needsSetup };
}

export function getCategories() {
  return [...new Set(catalog.map((item) => item.category))];
}
