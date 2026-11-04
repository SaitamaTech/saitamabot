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

export function formatActiveCommandMenu({ botName = 'SAITAMA BOT', prefix = '.', uptime = 'unknown' } = {}) {
  const activeCommands = catalog.filter((item) => item.status === 'implemented');
  const categories = new Map();
  for (const command of activeCommands) {
    if (!categories.has(command.category)) categories.set(command.category, []);
    categories.get(command.category).push(command.name.replace(/^\./, () => prefix));
  }

  const lines = [
    '*╭─〔 INFO BOT 〕*',
    `│ Name: ${botName}`,
    `│ Prefix: ${prefix}`,
    `│ Active commands: ${activeCommands.length}`,
    `│ Uptime: ${uptime}`,
    '*╰──────────────*',
    '',
    '*╭─〔 MAIN MENU 〕*',
  ];

  for (const [category, commands] of categories) {
    lines.push(`*├─〔 ${category} 〕*`, ...commands.map((command) => `│ ${command}`));
  }

  lines.push('*╰──────────────*', '', "See the dashboard's Command library for the full catalogue and setup status.");
  return lines.join('\n');
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
