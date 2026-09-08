import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const wikiRoot = resolve(process.cwd(), "wiki");

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? markdownFiles(path)
        : Promise.resolve(entry.name.endsWith(".md") ? [path] : []);
    }),
  );
  return nested.flat();
}

function noteName(path) {
  return path.slice(0, -3).split(sep).join("/");
}

const files = await markdownFiles(wikiRoot);
const notesByPath = new Map();
const notesByBasename = new Map();

for (const file of files) {
  const relativeName = noteName(relative(wikiRoot, file));
  notesByPath.set(relativeName, file);
  const shortName = basename(relativeName);
  const matches = notesByBasename.get(shortName) ?? [];
  matches.push(file);
  notesByBasename.set(shortName, matches);
}

const failures = [];
const wikiLink = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

for (const source of files) {
  const content = await readFile(source, "utf8");
  for (const match of content.matchAll(wikiLink)) {
    const rawTarget = match[1].trim().replace(/\.md$/i, "");
    const sourceRelative = relative(wikiRoot, source);
    const sourceDirectory = noteName(dirname(sourceRelative));
    const relativeTarget =
      sourceDirectory === "." ? rawTarget : `${sourceDirectory}/${rawTarget}`;

    if (notesByPath.has(rawTarget) || notesByPath.has(relativeTarget)) continue;

    const basenameMatches = notesByBasename.get(basename(rawTarget)) ?? [];
    if (basenameMatches.length === 1) continue;

    failures.push(
      basenameMatches.length === 0
        ? `${sourceRelative}: missing [[${rawTarget}]]`
        : `${sourceRelative}: ambiguous [[${rawTarget}]] (${basenameMatches
            .map((file) => relative(wikiRoot, file))
            .join(", ")})`,
    );
  }
}

if (failures.length > 0) {
  console.error(`Wiki link verification failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `Wiki verified: ${files.length} notes with resolvable wikilinks.`,
  );
}
