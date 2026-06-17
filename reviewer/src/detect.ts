/**
 * Stack & shape detection. Pure functions over scanned files — no LLM. The goal
 * is precise, cheap signals (manifests, IaC, datastores, entrypoints) that make
 * the digest accurate before we ever spend a token.
 */

import type { RepoFile, ScanResult, StackInfo } from "./types.js";

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
  ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".go": "Go",
  ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".rb": "Ruby", ".php": "PHP",
  ".cs": "C#", ".cpp": "C++", ".cc": "C++", ".c": "C", ".swift": "Swift",
  ".scala": "Scala", ".ex": "Elixir", ".exs": "Elixir", ".dart": "Dart",
};

const MANIFEST_NAMES = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "setup.py", "Pipfile",
  "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts",
  "Gemfile", "composer.json", "mix.exs", "pubspec.yaml",
]);

/** Filename → framework, for files whose mere presence implies a framework. */
const FRAMEWORK_FILES: Record<string, string> = {
  "next.config.js": "Next.js", "next.config.mjs": "Next.js", "next.config.ts": "Next.js",
  "nuxt.config.ts": "Nuxt", "vite.config.ts": "Vite", "vite.config.js": "Vite",
  "angular.json": "Angular", "nest-cli.json": "NestJS", "remix.config.js": "Remix",
  "svelte.config.js": "Svelte", "gatsby-config.js": "Gatsby", "manage.py": "Django",
  "artisan": "Laravel",
};

/** Dependency name substrings → framework label (checked in package.json/etc). */
const DEP_FRAMEWORKS: [RegExp, string][] = [
  [/\bexpress\b/, "Express"], [/\bfastify\b/, "Fastify"], [/@nestjs\//, "NestJS"],
  [/\bnext\b/, "Next.js"], [/\breact\b/, "React"], [/\bvue\b/, "Vue"],
  [/@angular\//, "Angular"], [/\bsvelte\b/, "Svelte"], [/\bkoa\b/, "Koa"],
  [/\bhapi\b/, "hapi"], [/\bdjango\b/, "Django"], [/\bflask\b/, "Flask"],
  [/\bfastapi\b/, "FastAPI"], [/\bgin-gonic\b/, "Gin"], [/\bfiber\b/, "Fiber"],
  [/\bspring-boot\b|spring-boot/, "Spring Boot"], [/\brails\b/, "Rails"],
  [/\blaravel\b/, "Laravel"], [/\bgraphql\b/, "GraphQL"],
];

const DATASTORE_HINTS: [RegExp, string][] = [
  [/\b(pg|postgres|postgresql)\b/i, "PostgreSQL"], [/\bmysql\b/i, "MySQL"],
  [/\bmongo(db|ose)?\b/i, "MongoDB"], [/\bredis|ioredis\b/i, "Redis"],
  [/\bdynamodb|dynamoose\b/i, "DynamoDB"], [/\bsqlite\b/i, "SQLite"],
  [/\bcassandra\b/i, "Cassandra"], [/\belasticsearch|opensearch\b/i, "Elasticsearch"],
  [/\bkafka\b/i, "Kafka"], [/\brabbitmq|amqplib\b/i, "RabbitMQ"],
  [/\bprisma\b/i, "Prisma (ORM)"], [/\bsequelize\b/i, "Sequelize (ORM)"],
  [/\btypeorm\b/i, "TypeORM"], [/\bsqlalchemy\b/i, "SQLAlchemy"],
];

function detectIac(files: RepoFile[]): string[] {
  const iac = new Set<string>();
  for (const f of files) {
    const base = f.relPath.split("/").pop() || "";
    const lower = f.relPath.toLowerCase();
    if (f.ext === ".tf" || f.relPath.endsWith(".tf.json")) iac.add("Terraform");
    if (base === "cdk.json") iac.add("AWS CDK");
    if (base === "serverless.yml" || base === "serverless.yaml") iac.add("Serverless Framework");
    if (base === "template.yaml" || base === "template.yml" || base === "samconfig.toml") iac.add("AWS SAM");
    if (base === "docker-compose.yml" || base === "docker-compose.yaml" || base === "compose.yaml") iac.add("Docker Compose");
    if (base === "Dockerfile" || base.startsWith("Dockerfile.")) iac.add("Docker");
    if (base === "Chart.yaml") iac.add("Helm");
    if (/(^|\/)(k8s|kubernetes|manifests|deploy(ment)?s?)\//.test(lower) && (f.ext === ".yaml" || f.ext === ".yml")) {
      if (/\bkind:\s*(Deployment|Service|StatefulSet|DaemonSet|Ingress|ConfigMap|Pod|CronJob)\b/.test(f.content)) {
        iac.add("Kubernetes");
      }
    }
    if (/\bkind:\s*(Deployment|StatefulSet|DaemonSet)\b/.test(f.content) && (f.ext === ".yaml" || f.ext === ".yml")) {
      iac.add("Kubernetes");
    }
    if (base === "Pulumi.yaml") iac.add("Pulumi");
  }
  return [...iac].sort();
}

function detectEntrypoints(files: RepoFile[]): string[] {
  const eps: string[] = [];
  const PATTERNS = [
    /(^|\/)(main|index|app|server|cli)\.(ts|js|mjs|py|go|rs|java|rb)$/,
    /(^|\/)cmd\/[^/]+\/main\.go$/,
    /(^|\/)src\/(main|index|app)\.(ts|js|py)$/,
    /(^|\/)manage\.py$/,
    /(^|\/)wsgi\.py$/, /(^|\/)asgi\.py$/,
  ];
  for (const f of files) {
    if (PATTERNS.some((re) => re.test(f.relPath))) eps.push(f.relPath);
  }
  // Keep shallow ones first; cap so the digest stays focused.
  eps.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  return eps.slice(0, 12);
}

export function detectStack(scan: ScanResult): StackInfo {
  const { files } = scan;
  const langCount = new Map<string, number>();
  const frameworks = new Set<string>();
  const datastores = new Set<string>();
  const manifests: string[] = [];
  let hasDocker = false;
  let hasCi = false;

  // One pass over manifest contents for deps → frameworks/datastores.
  for (const f of files) {
    const base = f.relPath.split("/").pop() || "";
    if (LANG_BY_EXT[f.ext]) langCount.set(LANG_BY_EXT[f.ext], (langCount.get(LANG_BY_EXT[f.ext]) || 0) + 1);
    if (MANIFEST_NAMES.has(base)) manifests.push(f.relPath);
    if (FRAMEWORK_FILES[base]) frameworks.add(FRAMEWORK_FILES[base]);
    if (base === "Dockerfile" || base.startsWith("Dockerfile.")) hasDocker = true;
    if (/(^|\/)\.github\/workflows\//.test(f.relPath) || base === ".gitlab-ci.yml" || base === "Jenkinsfile") hasCi = true;

    if (MANIFEST_NAMES.has(base) && f.isText) {
      for (const [re, name] of DEP_FRAMEWORKS) if (re.test(f.content)) frameworks.add(name);
      for (const [re, name] of DATASTORE_HINTS) if (re.test(f.content)) datastores.add(name);
    }
  }

  const languages = [...langCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);

  return {
    languages,
    frameworks: [...frameworks].sort(),
    iac: detectIac(files),
    manifests: manifests.sort(),
    entrypoints: detectEntrypoints(files),
    datastores: [...datastores].sort(),
    hasDocker,
    hasCi,
  };
}
