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
- Novo: horas de sol (`sunshine_duration` do ERA5, média diária). O cache passou a `clima-history-v2`; o antigo é apagado no primeiro acesso.
- Validação: 15 testes de cálculos (matriz, semanas ISO, escala de cor, horas de sol) e 18 testes de interface (nove cenários em Chromium e WebKit com emulação de iPhone), incluindo 320 px com texto a 200 %, cabeçalhos fixos e controles de 44 px.
- Limitações: Ano × Semana tem 53 colunas e exige rolagem horizontal; intervalos muito longos em Mês × Dia renderizam milhares de células. Ranking de extremos considera só o que está visível.
