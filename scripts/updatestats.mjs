// scripts/update-stats.mjs
//
// Hits the GitHub GraphQL API directly for this account's public stats
// and rewrites the block between the STATS markers in README.md.
// No third-party action, no library — just fetch() and fs.

import { readFile, writeFile } from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const login = process.env.REPO_OWNER;

if (!token || !login) {
  console.error("Missing GITHUB_TOKEN or REPO_OWNER");
  process.exit(1);
}

const query = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        nodes {
          stargazerCount
          languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name } }
          }
        }
      }
    }
  }
`;

async function main() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status}: ${await res.text()}`);
  }

  const { data, errors } = await res.json();
  if (errors) throw new Error(JSON.stringify(errors));

  const { contributionsCollection, repositories } = data.user;
  const days = contributionsCollection.contributionCalendar.weeks.flatMap(
    (w) => w.contributionDays
  );

  const stats = {
    stars: repositories.nodes.reduce((sum, r) => sum + r.stargazerCount, 0),
    lastYear: contributionsCollection.contributionCalendar.totalContributions,
    streak: currentStreak(days),
    topLangs: topLanguages(repositories.nodes, 3),
  };

  await writeReadme(stats);
}

function currentStreak(days) {
  let i = days.length - 1;
  if (days[i].contributionCount === 0) i--; // today may not be over yet
  let streak = 0;
  for (; i >= 0 && days[i].contributionCount > 0; i--) streak++;
  return streak;
}

function topLanguages(repos, count) {
  const bytesByLang = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      bytesByLang.set(node.name, (bytesByLang.get(node.name) ?? 0) + size);
    }
  }
  return [...bytesByLang.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name]) => name);
}

async function writeReadme(stats) {
  const readme = await readFile("README.md", "utf8");

  const block = [
    "```text",
    `stars      : ${stats.stars}`,
    `last year  : ${stats.lastYear} contributions`,
    `streak     : ${stats.streak} day${stats.streak === 1 ? "" : "s"}`,
    `top langs  : ${stats.topLangs.join(" · ")}`,
    "```",
  ].join("\n");

  const start = "<!-- STATS:START -->";
  const end = "<!-- STATS:END -->";
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);

  if (!pattern.test(readme)) {
    throw new Error(`README.md is missing the ${start} / ${end} markers`);
  }

  await writeFile("README.md", readme.replace(pattern, `${start}\n${block}\n${end}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});