# LLMeter MCP Server

Serveur [MCP](https://modelcontextprotocol.io) (Model Context Protocol) pour [LLMeter](https://github.com/MetriLLM/metrillm) — benchmark de LLMs locaux directement depuis Claude Code, Cursor, Windsurf, Continue.dev ou tout client MCP compatible.

## Installation

```bash
cd mcp
npm install
npm run build
```

### Claude Code

```bash
claude mcp add llmeter -- node /chemin/vers/metrillm/mcp/dist/index.js
```

### Claude Desktop

Ajouter dans `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "llmeter": {
      "command": "node",
      "args": ["/chemin/vers/metrillm/mcp/dist/index.js"]
    }
  }
}
```

### Cursor / Windsurf / Continue.dev

Ajouter dans la configuration MCP de l'éditeur :

```json
{
  "mcpServers": {
    "llmeter": {
      "command": "node",
      "args": ["/chemin/vers/metrillm/mcp/dist/index.js"]
    }
  }
}
```

## Prérequis

- Node.js >= 20
- [Ollama](https://ollama.com) installé et en cours d'exécution (`ollama serve`)
- Au moins un modèle disponible (`ollama pull llama3.2:3b`)

## Tools disponibles

### `list_models`

Liste tous les modèles LLM disponibles localement.

**Paramètres :**
| Param | Type | Défaut | Description |
|---|---|---|---|
| `runtime` | `"ollama"` | `"ollama"` | Runtime d'inférence |

**Exemple de réponse :**
```json
{
  "models": [
    { "name": "llama3.2:3b", "size": 2019393189, "parameterSize": "3.2B", "quantization": "Q4_K_M", "family": "llama" }
  ],
  "count": 1
}
```

### `run_benchmark`

Lance un benchmark complet (performance + qualité) sur un modèle local.

**Paramètres :**
| Param | Type | Défaut | Description |
|---|---|---|---|
| `model` | `string` | *(requis)* | Nom du modèle (ex: `"llama3.2:3b"`) |
| `runtime` | `"ollama"` | `"ollama"` | Runtime d'inférence |
| `perfOnly` | `boolean` | `false` | Si `true`, mesure uniquement la performance (pas de qualité) |

**Exemple de réponse :**
```json
{
  "success": true,
  "model": "llama3.2:3b",
  "verdict": "GOOD",
  "globalScore": 65,
  "performance": {
    "tokensPerSecond": 42.5,
    "ttftMs": 120,
    "memoryUsedGB": 2.1,
    "memoryPercent": 13
  },
  "interpretation": "This model runs well on your hardware."
}
```

### `get_results`

Récupère les résultats de benchmarks précédents stockés localement.

**Paramètres :**
| Param | Type | Défaut | Description |
|---|---|---|---|
| `model` | `string` | *(optionnel)* | Filtre par nom de modèle (sous-chaîne) |
| `runtime` | `"ollama"` | `"ollama"` | Runtime d'inférence |

### `share_result`

Upload un résultat vers le leaderboard public LLMeter.

**Paramètres :**
| Param | Type | Description |
|---|---|---|
| `resultFile` | `string` | Chemin absolu vers le fichier JSON de résultat |

**Variables d'environnement requises :**
- `LLMETER_SUPABASE_URL`
- `LLMETER_SUPABASE_ANON_KEY`
- `LLMETER_PUBLIC_RESULT_BASE_URL`

## Architecture

Le serveur MCP est un wrapper mince autour de la logique existante du CLI LLMeter :

```
mcp/src/index.ts  → Point d'entrée MCP (stdio transport)
mcp/src/tools.ts  → Définitions des tools + appels vers le CLI
    ↓
../src/core/      → Logique CLI réutilisée directement
../src/commands/  → Commandes CLI (bench, list)
```

Aucune duplication de code — le MCP importe directement les modules du CLI.

## Runtimes supportés

| Runtime | Status |
|---|---|
| Ollama | Supporté |
| LM Studio | Prévu |
| MLX | Prévu |
| llama.cpp | Prévu |
| vLLM | Prévu |

Le paramètre `runtime` est présent sur chaque tool pour préparer le multi-runtime. Les runtimes non encore implémentés retournent une erreur claire.
