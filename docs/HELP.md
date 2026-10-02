# DEVflow Help

DEVflow organiza o trabalho diario de desenvolvimento sem exigir navegacao constante no GitHub.

## Abas

- **MY WORK**: PRs onde voce e autor ou assignee. Use para acompanhar CI, conflitos, mudancas pedidas e deploy.
- **REVIEWS**: PRs que dependem da sua revisao, incluindo solicitacoes criadas por CODEOWNERS quando o GitHub as expoe como review request.
- **WORKTREES**: alteracoes locais criadas pelo DEVflow que podem ser retomadas.
- **HELP**: este guia.

Use `Tab` para alternar entre abas.

## Navegacao

| Atalho | Acao |
| --- | --- |
| Setas | Move a selecao ou rola um documento |
| `Enter` | Abre ou fecha detalhes da PR selecionada |
| `1` a `4` | Filtra por prioridade na aba atual |
| `0` | Remove o filtro de prioridade |
| `r` | Atualiza os dados do GitHub |
| `q` | Fecha o DEVflow |

## Acoes da PR

| Atalho | Acao |
| --- | --- |
| `a` | Analisa reviews com OpenCode em modo somente leitura |
| `c` | Nos detalhes, seleciona um check falho de GitHub Actions para diagnostico |
| `d` | Mostra a previa de deploy de staging |
| `o` | Abre a PR no navegador |

O deploy sempre usa a branch `staging`. Antes da confirmacao, o DEVflow mostra workflow, SHA, commit e ultima execucao. Confirme apenas com `y` quando o contexto estiver correto.

## Review AI

Pressione `a` para coletar diff, reviews e comentarios. O OpenCode devolve uma triagem em pt-BR com mudancas obrigatorias, perguntas, sugestoes e proxima acao.

- `i`: cria um worktree isolado e pede ao OpenCode para implementar mudancas obrigatorias.
- `g`: mostra status, resumo de diff e validacao de whitespace no worktree.
- `s`: retorna ao resumo da implementacao.
- `x`: cancela uma analise ou implementacao em andamento.

O worktree nao e uma sandbox de seguranca. A implementacao usa permissoes automaticas do OpenCode; revise o diff antes de fazer commit, push ou deploy.

## Diagnostico de CI

Nos detalhes de uma PR com checks falhos, pressione `c` para selecionar um check de GitHub Actions que tenha IDs seguros de workflow e check run. Use `o` para abrir o workflow run no navegador ou `Enter` para enviar um trecho limitado do log falho ao OpenCode para diagnostico em pt-BR.

O diagnostico e somente leitura: ele nao altera codigo, nao cria worktree, nao faz commit, push, deploy nem reexecuta workflows. Logs sao tratados como dados nao confiaveis e podem estar truncados.

## Comandos Rapidos

```bash
devflow                 # abre a TUI
devflow inbox           # itens que exigem sua atencao
devflow resume          # worktrees locais para retomar
devflow doctor          # diagnostico do ambiente local
devflow config show     # configuracao local e comandos de validacao
devflow list --reviewer # apenas revisoes solicitadas
devflow list --json     # saida para scripts
```

## Prioridades

- **READY**: PR aprovada e sem checks pendentes ou falhos.
- **ACTION**: sua revisao foi solicitada ou existem mudancas pedidas na sua PR.
- **WAITING**: aguardando CI, autor, revisor ou calculo de merge.
- **BLOCKED**: conflito de merge ou check falho.

O motivo exibido em cada linha explica quem precisa agir.

## Configuracao local

Use `devflow config path`, `devflow config show` e `devflow config init` para a configuracao local em `$XDG_CONFIG_HOME/devflow/config.json` (ou `~/.config/devflow/config.json`). Os comandos de validacao por repositorio sao listas de argumentos, como `["npm", "test"]`; comandos de shell em texto nao sao aceitos.
