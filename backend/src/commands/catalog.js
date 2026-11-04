import catalog from './catalog.json' with { type: 'json' };

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

function hasSingleTransposition(left, right) {
  if (left.length !== right.length) return false;
  const mismatches = [];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) mismatches.push(index);
    if (mismatches.length > 2) return false;
  }
  return mismatches.length === 2 &&
    mismatches[1] === mismatches[0] + 1 &&
    left[mismatches[0]] === right[mismatches[1]] &&
    left[mismatches[1]] === right[mismatches[0]];
}

export function findCommandSuggestion(name) {
  const input = String(name).trim().toLowerCase().replace(/^\./, '');
  if (!input || input.length > 40) return null;

  let best = null;
  for (const command of catalog) {
    if (!/^\.[a-z0-9]+$/.test(command.name)) continue;
    const candidate = command.name.slice(1).toLowerCase();
    const rawDistance = editDistance(input, candidate);
    const distance = hasSingleTransposition(input, candidate) ? 1 : rawDistance;
    const maximumDistance = input.length <= 4 ? 1 : input.length <= 8 ? 2 : 3;
    if (distance > maximumDistance || distance / Math.max(input.length, candidate.length) > 0.34) continue;
    if (!best || distance < best.distance) best = { command, distance };
  }
  return best?.command || null;
}

export function formatCommandUsage(command, prefix = '.') {
  const usage = String(command?.usage || '');
  const formattedUsage = usage.replace(/^\.([a-z0-9]+)/i, (_, name) => `${prefix}${name}`);
  return [
    `How to use: ${formattedUsage || `${prefix}${command?.name?.replace(/^\./, '') || 'command'}`}`,
    command?.description ? `What it does: ${command.description}` : '',
  ].filter(Boolean).join('\n');
}

export function formatUnknownCommand(name, prefix = '.') {
  const suggestion = findCommandSuggestion(name);
  if (!suggestion) return `I don't recognize ${prefix}${name}. Send ${prefix}menu to browse available commands.`;
  const suggestedName = `${prefix}${suggestion.name.slice(1)}`;
  if (suggestion.status !== 'implemented') {
    return `I don't recognize ${prefix}${name}. The closest command is ${suggestedName}, but it is not available yet. Send ${prefix}menu to browse active commands.`;
  }
  return `I don't recognize ${prefix}${name}. Did you mean ${suggestedName}?\n${formatCommandUsage(suggestion, prefix)}`;
}

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
    lines.push(`*├─〔 ${category} 〕*`, ...commands.map((command) => `│ • ${command}`));
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
