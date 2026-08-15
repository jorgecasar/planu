#!/usr/bin/env node
// Restaura las skills desde skills-lock.json y las deja donde Claude Code las lee.
//
// `npx skills experimental_install` escribe los cuerpos en .agents/skills/, pero
// NO crea los symlinks de .claude/skills/, así que un clon limpio vería cero
// skills. Este script hace las dos cosas.

import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentsSkills = join(root, ".agents", "skills");
const claudeSkills = join(root, ".claude", "skills");

const run = (cmd, args) =>
	execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

// 1. Restaurar los cuerpos de las skills a partir del lock.
console.log("→ Restaurando skills desde skills-lock.json…");
run("npx", ["-y", "skills", "experimental_install"]);

if (!existsSync(agentsSkills)) {
	console.error(
		`✗ No existe ${agentsSkills} tras el restore. Revisa skills-lock.json.`,
	);
	process.exit(1);
}

// 2. Enlazar .claude/skills/<skill> → ../../.agents/skills/<skill>.
//    Los symlinks son relativos para que sobrevivan a mover o clonar el repo.
mkdirSync(claudeSkills, { recursive: true });

let linked = 0;
for (const entry of readdirSync(agentsSkills, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;

	const link = join(claudeSkills, entry.name);
	// lstat y no existsSync: un symlink roto reporta como inexistente,
	// y symlinkSync fallaría después con EEXIST sobre él.
	try {
		lstatSync(link);
		rmSync(link, { recursive: true, force: true });
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}

	symlinkSync(join("..", "..", ".agents", "skills", entry.name), link, "dir");
	linked++;
}
console.log(`→ ${linked} skills enlazadas en .claude/skills/`);

// 3. Índice de qmd: sólo si este proyecto lo usa. Fallar aquí no debe romper
//    el setup — el índice se regenera con `qmd update && qmd embed`.
if (existsSync(join(root, ".qmd", "index.yml"))) {
	try {
		console.log("→ Reconstruyendo el índice de qmd…");
		run("qmd", ["update"]);
		run("qmd", ["embed"]);
	} catch {
		console.warn("⚠ qmd no disponible o falló el indexado. Instálalo con:");
		console.warn(
			"  npm install -g @tobilu/qmd   →   luego `qmd update && qmd embed`",
		);
	}
}

console.log("✓ Setup de skills completado.");
