import fs from 'fs/promises';
import { execSync } from 'child_process';

function fetchCategories(name) {
  const page = encodeURIComponent(name.replace(/ /g, '_'));
  const url = `https://r.jina.ai/https://wiki.hoodedhorse.com/He_is_Coming/${page}`;
  try {
    const output = execSync(`curl -L --silent '${url}'`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const cats = [...output.matchAll(/\[Category:([^\]]+)\]/g)].map(m => m[1]);
    return cats
      .filter(cat => !/^Rarity/i.test(cat))
      .map(cat => cat.replace(/_/g, ' '));
  } catch (err) {
    console.error('Failed to fetch', name, err.status || err.message);
    return [];
  }
}

async function main() {
  const detailsPath = 'details.json';
  const details = JSON.parse(await fs.readFile(detailsPath, 'utf8'));
  const limit = Number(process.env.LIMIT) || Infinity;
  let count = 0;
  for (const entry of Object.values(details)) {
    if (count >= limit) break;
    if (!['items', 'weapons'].includes(entry.bucket)) continue;
    const categories = fetchCategories(entry.name);
    if (categories.length) {
      entry.tags = Array.from(new Set(categories));
      console.log('Updated', entry.name, entry.tags);
    }
    count++;
  }
  await fs.writeFile(detailsPath, JSON.stringify(details, null, 2) + '\n');
}

main();
