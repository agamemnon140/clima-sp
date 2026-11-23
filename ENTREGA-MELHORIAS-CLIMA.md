# Entrega — Histórico e uso no iPhone

Implementação local concluída em 23/09/2026. O site publicado no GitHub Pages ainda não foi atualizado.

## Funcionalidades
- Quatro abas, navegação inferior no celular e controles com área de toque mínima de 44 px.
- Histórico por dia, semana, mês e ano, com chuva acumulada, temperatura média e extremos absolutos.
- Gráficos separados, valores ao toque, lista para celular, tabela e exportação de todo o intervalo em CSV.
- Comparação opcional com 1991–2020, calculada para os mesmos dias com dados.
- Busca de cidades, favoritos, geolocalização e persistência de filtros.
- Fuso da localização, períodos incompletos e cobertura por variável explícitos.
- Carregamento independente dos painéis, recuperação de erros, datas de atualização corrigidas.

## Validação
- Oito testes de cálculos aprovados.
- Dezesseis testes de interface aprovados: oito cenários em Chromium e WebKit com emulação de iPhone.
- Largura de 320 px e texto ampliado a 200%, sem transbordamento horizontal da página.
- Fluxos verificados: agregação, detalhamento, comparação, CSV, paginação, favoritos, falhas parciais, navegação por teclado, preservação da rolagem e geolocalização em outro fuso com a previsão indisponível.
- Sintaxe JavaScript, compilação do arquivo Python alterado e verificação de whitespace aprovadas.
- Consultas reais de busca de cidades, histórico e previsão de 16 dias responderam com os campos esperados.

## Revisão
### Padrões
Nenhuma violação documentada. A revisão encontrou um problema de acessibilidade no atalho para o conteúdo; corrigido e coberto por teste. Conferência final sem pendências.

### Atendimento ao plano
A revisão encontrou dependência indevida da previsão para identificar o fuso da geolocalização e o mesmo problema de navegação. Ambos foram corrigidos e verificados. Conferência final sem pendências.

## Limitações e decisões
- Emulação WebKit não substitui uma conferência em iPhone físico.
- O app depende da API pública do Open-Meteo; a primeira consulta de intervalos longos ou da referência histórica pode demorar e está sujeita aos limites do serviço.
- O Histórico fixa ERA5. O modelo sazonal legado usa a seleção automática do Open-Meteo e continua específico de São Paulo. A fonte foi identificada corretamente; o modelo não foi reconstruído nesta entrega.
- Para testar localmente, sirva `docs` por HTTP. Comandos de teste e detalhes dos cálculos estão no README.

## Atualização — Histórico em matriz (23/09/2026)
A aba Histórico foi refeita como tabela dinâmica: quatro leituras (Ano × Mês, Ano × Semana, Mês × Dia, Semana × Dia) e cinco variáveis (chuva, média, mínima, máxima, horas de sol), com gradiente de cor sobre os valores visíveis, contorno nos extremos e detalhamento por toque até os dias.

- Removidos: cards de resumo, gráficos, lista, tabela linear, paginação, comparação com 1991–2020 e exportação CSV.
- Período: padrão de 20 anos civis em Ano × Mês, mais recentes em cima; seletor com 1, 5, 10, 20 anos, Todos (desde 1940) e Personalizado (datas livres). Os atalhos anteriores (30 dias, este mês, este ano, ano passado) saíram.
- Novo: horas de sol (`sunshine_duration` do ERA5, média diária). O cache passou a `clima-history-v2`; o antigo é apagado no primeiro acesso.
- Validação: 16 testes de cálculos (matriz, semanas ISO, períodos, escala de cor, horas de sol) e 22 testes de interface (onze cenários em Chromium e WebKit com emulação de iPhone), incluindo 320 px com texto a 200 %, cabeçalhos fixos e controles de 44 px.
- Limitações: Ano × Semana tem 53 colunas e exige rolagem horizontal; “Todos” em Mês × Dia renderiza dezenas de milhares de células. A primeira abertura baixa 20 anos (duas consultas) e “Todos” baixa 87 anos (nove consultas); depois fica em cache. Ranking de extremos considera só o que está visível.

## Atualização — Valinhos e contagem de dias (22/11/2026)
Valinhos passa a ter tudo o que São Paulo tem, e o Histórico conta dias acima ou abaixo de um limite.

- Local: atalhos São Paulo e Valinhos na barra de local, que agora aparece nas quatro abas. A escolha vale para todas.
- Tendências e os painéis do modelo em Sobre seguem a cidade: modelo próprio para São Paulo e Valinhos; nas demais cidades, o ponto modelado mais próximo, com aviso e distância. Antes eram fixos na RMSP.
- Pipeline por local (`LOCAIS` em `src/config.py`): série mensal desde 1940, dataset, hindcast e previsão de Valinhos em `valinhos/`, dentro das pastas de dados; São Paulo segue na raiz, com saída idêntica à anterior (conferida arquivo a arquivo). Índices climáticos comuns.
- Download da série de um local novo: blocos de dez anos com pausa, gravados um a um e retomáveis. A falha de um local não derruba os outros e o workflow commita o que foi gerado.
- Histórico, "Contar dias": número de dias com chuva, temperatura média, mínima, máxima ou horas de sol igual ou acima (≥) ou igual ou abaixo (≤) de um limite ajustável; total do período, coluna Total por linha e destaque dos dias nas leituras por dia. Cada variável guarda o próprio limite; mudar o limite não refaz a consulta.
- Validação: 24 testes de cálculos (contagem, limites inclusivos, pontos modelados, lista de locais igual à do pipeline), 6 testes do download retomável (sem rede) e 15 cenários de interface, incluindo troca de cidade nas quatro abas, falta dos dados de um ponto e contagem em 320 px com texto a 200 %.
- Limitações: nesta entrega os cenários de interface rodaram no Chrome (desktop e emulação de iPhone); o WebKit do Playwright não pôde ser instalado no ambiente de desenvolvimento e ficou sem conferência. A série de Valinhos usa a seleção automática de modelos do Open-Meteo, a mesma de São Paulo, e não o ERA5 explícito do Histórico.
