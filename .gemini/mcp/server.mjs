#!/usr/bin/env node
// Serveur MCP local pour Gemini / Antigravity qui expose la cartographie du
// dépôt Angul.io — évite de refouiller tout le repo à chaque session.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

function getStructurePath() {
  const geminiPath = join(REPO_ROOT, '.gemini', 'project-structure.json');
  if (existsSync(geminiPath)) return geminiPath;
  return join(REPO_ROOT, '.claude', 'project-structure.json');
}

function loadStructure() {
  const raw = readFileSync(getStructurePath(), 'utf-8');
  return JSON.parse(raw);
}

function readRepoFile(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
}

/** Score simple par correspondance de tokens sur path/description/tags */
function scoreEntry(entry, queryTokens) {
  const haystackPath = entry.path.toLowerCase();
  const haystackDesc = (entry.description || '').toLowerCase();
  const haystackTags = (entry.tags || []).map((t) => t.toLowerCase());

  let score = 0;
  for (const token of queryTokens) {
    if (haystackPath.includes(token)) score += 3;
    if (haystackTags.some((tag) => tag.includes(token))) score += 4;
    if (haystackDesc.includes(token)) score += 1;
  }
  return score;
}

const server = new McpServer({
  name: 'angulio-project-map',
  version: '1.0.0',
});

server.registerTool(
  'find_file',
  {
    title: 'Trouver un fichier par mot-clé',
    description:
      "Cherche dans la cartographie du dépôt Angul.io les fichiers/dossiers pertinents pour un sujet donné (ex: 'dash', 'skin avatar', 'collision bots'). Retourne les chemins, workspace, tags et description — à utiliser AVANT de grep/explorer le repo à l'aveugle pour une question d'architecture.",
    inputSchema: {
      query: z.string().describe("Mots-clés libres (français ou anglais), ex: 'dash impulsion' ou 'avatar skin bot'"),
      limit: z.number().int().min(1).max(50).optional().describe('Nombre maximal de résultats (défaut 10)'),
    },
  },
  async ({ query, limit }) => {
    const structure = loadStructure();
    const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = structure.entries
      .map((entry) => ({ entry, score: scoreEntry(entry, queryTokens) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit ?? 10);

    if (scored.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `Aucune correspondance pour "${query}". Essaie list_topics pour voir les grandes catégories, ou get_full_map pour la cartographie complète.`,
          },
        ],
      };
    }

    const text = scored
      .map(
        ({ entry }) =>
          `${entry.path} [${entry.workspace}]\n  tags: ${(entry.tags || []).join(', ')}\n  ${entry.description}`,
      )
      .join('\n\n');
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'list_workspaces',
  {
    title: 'Lister les workspaces npm',
    description:
      'Liste les 4 workspaces npm du monorepo Angul.io (shared/server/client/admin) avec leurs dépendances et leur rôle.',
    inputSchema: {},
  },
  async () => {
    const structure = loadStructure();
    const text = structure.workspaces
      .map(
        (w) =>
          `${w.name} (${w.path}) — dépend de: ${w.dependsOn.length ? w.dependsOn.join(', ') : 'aucun'}\n  ${w.description}`,
      )
      .join('\n\n');
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'list_topics',
  {
    title: 'Lister les sujets connus',
    description:
      "Liste les catégories thématiques pré-indexées (ex: 'bots', 'dash', 'avatars/skins', 'collision/tunneling') — chacune pointe vers les fichiers les plus pertinents.",
    inputSchema: {},
  },
  async () => {
    const structure = loadStructure();
    const text = Object.keys(structure.topics).sort().join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'get_topic_files',
  {
    title: "Fichiers d'un sujet",
    description:
      "Retourne la liste des fichiers pertinents pour un sujet pré-indexé (voir list_topics), ex: 'bots', 'gameplay/physique', 'reseau/protocole'.",
    inputSchema: {
      topic: z.string().describe("Clé de sujet, ex: 'bots' ou 'avatars/skins' (voir list_topics)"),
    },
  },
  async ({ topic }) => {
    const structure = loadStructure();
    const topics = structure.topics;
    let key = Object.keys(topics).find((k) => k.toLowerCase() === topic.toLowerCase());
    if (!key) {
      const needle = topic.toLowerCase();
      key = Object.keys(topics).find((k) => k.toLowerCase().includes(needle) || needle.includes(k.toLowerCase()));
    }
    if (!key) {
      return {
        content: [
          {
            type: 'text',
            text: `Sujet "${topic}" introuvable. Sujets connus:\n${Object.keys(topics).sort().join('\n')}`,
          },
        ],
      };
    }
    const paths = topics[key];
    const entryByPath = new Map(structure.entries.map((e) => [e.path, e]));
    const text = paths
      .map((p) => {
        const entry = entryByPath.get(p);
        return entry ? `${entry.path}\n  ${entry.description}` : p;
      })
      .join('\n\n');
    return { content: [{ type: 'text', text: `Sujet: ${key}\n\n${text}` }] };
  },
);

server.registerTool(
  'get_full_map',
  {
    title: 'Cartographie complète (JSON brut)',
    description:
      "Retourne le contenu intégral de la cartographie (workspaces + toutes les entrées + tous les sujets).",
    inputSchema: {},
  },
  async () => {
    const structure = loadStructure();
    return { content: [{ type: 'text', text: JSON.stringify(structure, null, 2) }] };
  },
);

server.registerResource(
  'project-structure',
  'angulio://project-structure.json',
  {
    title: 'Cartographie structurée du dépôt (JSON)',
    description: 'Contenu brut de project-structure.json',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: readFileSync(getStructurePath(), 'utf-8') }],
  }),
);

server.registerResource(
  'readme',
  'angulio://README.md',
  {
    title: "README.md — architecture et guide de modding",
    description: "Document de référence technique (architecture moteur, GameMod, schéma JSON, réseau, rendu client)",
    mimeType: 'text/markdown',
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readRepoFile('README.md') }],
  }),
);

server.registerResource(
  'structure-md',
  'angulio://structure.md',
  {
    title: 'structure.md — cartographie lisible par un humain',
    description: 'Cartographie fichier-par-fichier du dépôt (équivalent MD de project-structure.json)',
    mimeType: 'text/markdown',
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readRepoFile('structure.md') }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
