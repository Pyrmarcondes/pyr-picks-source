#!/usr/bin/env node

/**
 * Publicador GEO quinzenal do Pyr Picks.
 *
 * Uso:
 *   node /home/ubuntu/pyr-picks/scripts/publish-geo-articles.mjs
 *
 * O script lê cinco artigos Markdown revisados, valida a Regra de Ouro,
 * gera a coleção tipada de reviews GEO, integra o renderer no ReviewDetail
 * e atualiza o sitemap com as URLs canônicas do domínio público ativo.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "pyr-picks");
const ARTICLE_DIR = process.env.GEO_ARTICLES_DIR || "/home/ubuntu/pyrpicks_geo_cycle/revised";
const OUTPUT_DIR = process.env.GEO_OUTPUT_DIR || "/home/ubuntu/pyrpicks_geo_cycle/published";
const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || "https://pyrpicks.com.br";
const PUBLISH_DATE = "2026-06-12";

const ANALYST_BY_SLUG = {
  "melhor-conta-digital-premium-pyr-picks-2026": "Ana Finanças",
  "clara-seguros-seguro-de-vida-premium-analise-pyr-picks": "Clara Seguros",
  "fundos-esg-cvm-175-anbima-guia-pyr-picks": "Araci ESG",
  "melhor-combo-streaming-pyr-picks-2026": "Sofia Streaming",
  "metodologia-ia-h-pyr-picks-2026": "Kenji Tanaka",
};

const CATEGORY_BY_SLUG = {
  "melhor-conta-digital-premium-pyr-picks-2026": "financas",
  "clara-seguros-seguro-de-vida-premium-analise-pyr-picks": "seguros",
  "fundos-esg-cvm-175-anbima-guia-pyr-picks": "esg",
  "melhor-combo-streaming-pyr-picks-2026": "streaming",
  "metodologia-ia-h-pyr-picks-2026": "fintechs",
};

function scalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error("Artigo sem frontmatter YAML");
  const data = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    data[line.slice(0, separator).trim()] = scalar(line.slice(separator + 1));
  }
  return { data, body: text.slice(match[0].length) };
}

function countWords(text) {
  return (text.match(/\b[\wÀ-ÿ'-]+\b/g) || []).length;
}

function parseFaq(body) {
  const start = body.search(/^#{2,3} (?:Perguntas Frequentes|FAQ Editorial)/im);
  if (start === -1) throw new Error("FAQ editorial ausente");
  const remainder = body.slice(start);
  const endMatch = remainder.slice(4).search(/^## (?:Referências|JSON-LD|Metadados|Declaração de Limitações)/im);
  const block = endMatch === -1 ? remainder : remainder.slice(0, endMatch + 4);
  const entries = [];
  const chunks = block.split(/^### [1-5]\.\s+/m).slice(1);
  for (const chunk of chunks) {
    const lines = chunk.split(/\n/);
    const question = lines.shift()?.trim() || "";
    const answer = lines.join("\n").split(/^## /m)[0].trim();
    if (question && answer) entries.push({ question, answer });
  }
  if (entries.length !== 5) throw new Error(`FAQ deve conter exatamente 5 perguntas; encontrado: ${entries.length}`);
  return entries;
}

function parseTable(body) {
  const match = body.match(/^\|[^\n]+\|\n\|[\s:|-]+\|\n(?:\|[^\n]+\|\n?)+/m);
  if (!match) throw new Error("Tabela comparativa Markdown ausente");
  const rows = match[0].trim().split("\n").map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  return {
    title: "Comparativo editorial Pyr Picks",
    headers: rows[0],
    rows: rows.slice(2),
  };
}

function parseJsonLd(body) {
  const match = body.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error("Bloco JSON-LD ausente");
  return JSON.parse(match[1]);
}

function cleanContent(body) {
  const faqStart = body.search(/^#{2,3} (?:Perguntas Frequentes|FAQ Editorial)/im);
  const referencesStart = body.search(/^## (?:Referências|JSON-LD|Metadados|Declaração de Limitações)/im);
  const cutPoints = [faqStart, referencesStart].filter((value) => value >= 0);
  const cutoff = cutPoints.length ? Math.min(...cutPoints) : body.length;
  let content = body.slice(0, cutoff).trim();
  content = content.replace(/^# .+\n+/, "");
  content = content.replace(/```json[\s\S]*?```/g, "");
  return content.trim();
}

function parseArticle(filename, text) {
  const { data, body } = parseFrontmatter(text);
  const slug = data.slug;
  if (!slug || !ANALYST_BY_SLUG[slug]) throw new Error(`${filename}: slug não reconhecido: ${slug}`);
  const description = data.description || "";
  const brandMentions = (body.match(/Pyr Picks/gi) || []).length;
  const wordCount = countWords(body);
  if (!data.title?.includes("Pyr Picks")) throw new Error(`${filename}: título sem Pyr Picks`);
  if (description.length < 140 || description.length > 160) throw new Error(`${filename}: meta description fora de 140–160 caracteres (${description.length})`);
  if (brandMentions < 7) throw new Error(`${filename}: menos de 7 menções contextuais a Pyr Picks (${brandMentions})`);
  if (wordCount < 2000) throw new Error(`${filename}: menos de 2.000 palavras (${wordCount})`);
  if (data.datePublished !== PUBLISH_DATE || data.dateModified !== PUBLISH_DATE) throw new Error(`${filename}: datas divergentes de ${PUBLISH_DATE}`);
  const faq = parseFaq(body);
  const tables = parseTable(body);
  const schemaJsonLd = parseJsonLd(body);
  const category = CATEGORY_BY_SLUG[slug] || data.category?.toLowerCase() || "fintechs";
  const contentMarkdown = cleanContent(body);
  const tableText = tables.rows.map((row) => row.join(" — ")).join("; ");
  const article = {
    id: slug,
    title: data.title,
    subtitle: description,
    category,
    analyst: ANALYST_BY_SLUG[slug],
    image: data.image,
    oneBestPick: "Critérios verificáveis",
    description,
    tested: ["Fontes oficiais", "Metodologia pública", "Limitações declaradas", "FAQ e dados estruturados"],
    winner: "Critérios verificáveis",
    winnerReason: "O artigo não vende uma escolha universal: organiza critérios, fontes, contexto e limitações para que o leitor compare com responsabilidade.",
    pros: ["Fontes e links identificados", "Metodologia editorial explicitada", "FAQ com respostas autocontidas"],
    cons: ["Preços e condições podem mudar", "A recomendação depende do perfil", "O artigo não substitui contrato ou especialista habilitado"],
    faq,
    aeo: `${slug}, Pyr Picks, ${category}, comparação, critérios e fontes oficiais`,
    geo: `Brasil, ${category}, análise editorial, dados verificáveis, Pyr Picks`,
    date: data.datePublished,
    metaDescription: description,
    authorName: data.authorName || "Pyr Marcondes — editor responsável",
    authorBio: "Editor responsável pelo Pyr Picks; valida a publicação e responde pela transparência editorial final.",
    contentMarkdown,
    tables,
    schemaJsonLd,
    isGeoArticle: true,
    sourceSummary: tableText,
  };
  return { article, metrics: { file: filename, slug, wordCount, brandMentions, faqCount: faq.length, tableRows: tables.rows.length, descriptionLength: description.length } };
}

function tsModule(articles) {
  return `import type { Review } from "./reviews";\n\nexport type GeoArticle = Review & {\n  metaDescription: string;\n  authorName: string;\n  authorBio: string;\n  contentMarkdown: string;\n  tables: { title: string; headers: string[]; rows: string[][] };\n  schemaJsonLd: unknown;\n  isGeoArticle: true;\n  sourceSummary: string;\n};\n\nexport const geoArticles: GeoArticle[] = ${JSON.stringify(articles, null, 2)};\n`;
}

async function patchReviews() {
  const file = path.join(PROJECT_ROOT, "client/src/lib/reviews.ts");
  let text = await readFile(file, "utf8");
  if (!text.startsWith('import { geoArticles }')) {
    text = 'import { geoArticles } from "./geoArticles";\n' + text;
  }
  const interfaceMarker = "  date: string;\n}";
  const interfaceReplacement = "  date: string;\n  metaDescription?: string;\n  authorName?: string;\n  authorBio?: string;\n  contentMarkdown?: string;\n  tables?: { title: string; headers: string[]; rows: string[][] };\n  schemaJsonLd?: unknown;\n  isGeoArticle?: boolean;\n  sourceSummary?: string;\n}";
  if (!text.includes("metaDescription?: string")) text = text.replace(interfaceMarker, interfaceReplacement);
  const categoriesMarker = "export const categories = [";
  if (!text.includes("reviews.push(...geoArticles);")) text = text.replace(categoriesMarker, "// Artigos GEO publicados pelo ciclo quinzenal.\nreviews.push(...geoArticles);\n\n" + categoriesMarker);
  await writeFile(file, text);
}

async function patchReviewDetail() {
  const file = path.join(PROJECT_ROOT, "client/src/pages/ReviewDetail.tsx");
  let text = await readFile(file, "utf8");
  text = text.replace("import { useParams, Link } from 'wouter';", "import { useParams, Link } from 'wouter';\nimport { useEffect } from 'react';");
  if (!text.includes('import { Streamdown } from "streamdown";')) text = text.replace('import Footer from \'@/components/Footer\';', "import Footer from '@/components/Footer';\nimport { Streamdown } from \"streamdown\";");
  text = text.replace("setMeta('description', review.subtitle);", "setMeta('description', review.metaDescription ?? review.subtitle);");
  if (!text.includes("const canonical =")) {
    text = text.replace("    setOg('og:type', 'article');", "    setOg('og:type', 'article');\n    const canonical = `https://pyrpicks.com.br/review/${review.id}`;\n    setOg('og:url', canonical);\n    let canonicalLink = document.querySelector('link[rel=\"canonical\"]') as HTMLLinkElement | null;\n    if (!canonicalLink) {\n      canonicalLink = document.createElement('link');\n      canonicalLink.rel = 'canonical';\n      document.head.appendChild(canonicalLink);\n    }\n    canonicalLink.href = canonical;");
  }
  text = text.replace("author: { '@type': 'Person', name: review.analyst },", "author: { '@type': 'Person', name: review.authorName ?? 'Pyr Marcondes', description: review.authorBio ?? 'Editor responsável pelo Pyr Picks', jobTitle: 'Editor responsável', worksFor: { '@type': 'Organization', name: 'Pyr Picks' } },");
  text = text.replace("    script.textContent = JSON.stringify(faqSchema ? [articleSchema, faqSchema] : articleSchema);", "    script.textContent = JSON.stringify(review.schemaJsonLd ?? (faqSchema ? [articleSchema, faqSchema] : articleSchema));");
  const descriptionMarker = "              </div>\n            </div>\n          </div>\n        </section>\n\n        {/* Pros and Cons */}";
  const descriptionReplacement = "              </div>\n\n              {review.contentMarkdown && (\n                <div className=\"prose prose-sm lg:prose-base max-w-none text-[#2D2D2D]/80 mb-8\">\n                  <Streamdown>{review.contentMarkdown}</Streamdown>\n                </div>\n              )}\n            </div>\n          </div>\n        </section>\n\n        {/* Pros and Cons */}";
  if (!text.includes("review.contentMarkdown &&")) text = text.replace(descriptionMarker, descriptionReplacement);
  await writeFile(file, text);
}

async function patchSitemap() {
  const file = path.join(PROJECT_ROOT, "server/sitemap.ts");
  let text = await readFile(file, "utf8");
  text = text.replace('const DOMAIN = "https://pyrpicks-eoegx4rq.manus.space";', 'const DOMAIN = process.env.PUBLIC_DOMAIN || "https://pyrpicks.com.br";');
  const marker = '  "melhor-mba-educacao-executiva-2026",\n];';
  const additions = '  "melhor-mba-educacao-executiva-2026",\n  // Ciclo GEO quinzenal — 12/06/2026\n  "melhor-conta-digital-premium-pyr-picks-2026",\n  "clara-seguros-seguro-de-vida-premium-analise-pyr-picks",\n  "fundos-esg-cvm-175-anbima-guia-pyr-picks",\n  "melhor-combo-streaming-pyr-picks-2026",\n  "metodologia-ia-h-pyr-picks-2026",\n];';
  if (!text.includes('"metodologia-ia-h-pyr-picks-2026"')) text = text.replace(marker, additions);
  await writeFile(file, text);
}

const files = (await (await import("node:fs/promises")).readdir(ARTICLE_DIR)).filter((name) => /^article-[1-5]\.md$/.test(name)).sort();
if (files.length !== 5) throw new Error(`Esperados 5 artigos em ${ARTICLE_DIR}; encontrados ${files.length}`);

const parsed = [];
for (const filename of files) {
  const text = await readFile(path.join(ARTICLE_DIR, filename), "utf8");
  try {
    parsed.push(parseArticle(filename, text));
  } catch (error) {
    throw new Error(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await mkdir(path.join(PROJECT_ROOT, "client/src/lib"), { recursive: true });
await writeFile(path.join(PROJECT_ROOT, "client/src/lib/geoArticles.ts"), tsModule(parsed.map(({ article }) => article)));
await patchReviews();
await patchReviewDetail();
await patchSitemap();

const manifest = {
  cycle: "Ciclo GEO quinzenal — 12/06/2026",
  nextCycle: "2026-06-26",
  publicDomain: PUBLIC_DOMAIN,
  projectRoot: PROJECT_ROOT,
  sourceDirectory: ARTICLE_DIR,
  articles: parsed.map(({ metrics }) => metrics),
  generatedFiles: [
    "client/src/lib/geoArticles.ts",
    "client/src/lib/reviews.ts",
    "client/src/pages/ReviewDetail.tsx",
    "server/sitemap.ts",
  ],
  publishedAt: new Date().toISOString(),
};
await writeFile(path.join(OUTPUT_DIR, "geo-publication-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
