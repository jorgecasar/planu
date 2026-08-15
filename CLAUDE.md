@AGENTS.md

## Claude Code

Lo anterior aplica a cualquier agente. Esto es sólo de Claude Code.

### Comandos de proyecto

Viven en `.claude/commands/` y **sí** están versionados (la CLI de `skills` no
los instala; se copiaron a mano desde `addyosmani/agent-skills`).

| Comando | Para qué |
| --- | --- |
| `/spec` | Escribir la especificación antes de picar código |
| `/plan` | Partir el trabajo en tareas verificables → `tasks/plan.md` + `tasks/todo.md` |
| `/build` | Implementar de forma incremental: build, test, verificar, commit |
| `/test` | Flujo TDD; para bugs, patrón Prove-It |
| `/review` | Review en cinco ejes: corrección, legibilidad, arquitectura, seguridad, rendimiento |
| `/code-simplify` | Reducir complejidad sin cambiar comportamiento |
| `/ship` | Checklist de prelanzamiento y decisión go/no-go |
| `/webperf` | Auditoría de rendimiento web |

### Subagentes

En `.claude/agents/`, también versionados. **No son opcionales:** `/ship` lanza
`code-reviewer`, `security-auditor` y `test-engineer` en paralelo, y `/webperf`
usa `web-performance-auditor`. Sin ellos esos dos comandos quedan degradados.

### Tras clonar

`npm run setup` restaura las skills, pero **los servidores MCP no están en el
repo** (scope local, viven en `~/.claude.json`). Hay que registrarlos:

```bash
claude mcp add serena --scope local -- \
  serena start-mcp-server --context claude-code --project "$(pwd)"
claude mcp add chrome-devtools --scope local -- npx chrome-devtools-mcp@latest
```

Reinicia Claude Code después de tocar skills, comandos, subagentes o MCP: se
cargan al arrancar la sesión.
