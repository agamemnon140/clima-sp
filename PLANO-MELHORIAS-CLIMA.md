# Plano de melhorias do Clima

## Objetivo
Facilitar a consulta de chuva e temperatura, principalmente no iPhone, preservando a distinção entre histórico, previsão do tempo e projeção sazonal.

## 1. Leitura e navegação no iPhone
- Organizar o app em Previsão, Histórico, Tendências e Sobre, com navegação inferior no celular.
- Usar texto legível, controles com área de toque de pelo menos 44 px e espaço para a barra inferior do iPhone.
- Mostrar números e gráficos antes das explicações; recolher detalhes técnicos.
- Separar gráficos de chuva e temperatura, com altura adequada e poucos rótulos.
- Mostrar os valores selecionados fora do gráfico; oferecer lista no celular e tabela completa.
- Preservar filtros e evitar rolagem horizontal da página.

## 2. Histórico
- Consultar intervalo de datas e agrupar por dia, semana, mês ou ano.
- Mostrar chuva acumulada, temperatura média, máxima absoluta e mínima absoluta.
- Oferecer atalhos, navegação entre períodos, gráficos, tabela/lista e exportação CSV.
- Permitir abrir os meses de um ano e os dias de um mês.
- Indicar dias sem dados, períodos parciais, fonte e última data disponível.
- Usar os dados diários como base: somar chuva, calcular a média das temperaturas médias diárias e extrair os extremos das máximas/mínimas diárias.
- Consultar e armazenar em cache apenas os intervalos necessários, mantendo uma fonte histórica consistente.

## 3. Comparação e localização
- Comparar chuva e temperatura média com a referência 1991–2020 para o mesmo período do calendário.
- Buscar cidades com estado/país, salvar favoritos e lembrar a seleção.
- Oferecer localização do dispositivo mediante ação do usuário e respeitar o fuso local.
- Aplicar a cidade ao histórico e à previsão curta; manter o modelo sazonal identificado como específico de São Paulo.

## 4. Confiabilidade
- Carregar painéis de forma independente, com mensagens claras de carregamento e falha.
- Corrigir datas fixas e rótulos de fuso horário.
- Identificar corretamente a fonte dos dados históricos e a defasagem de publicação.
- Não apresentar reanálise como medição de uma estação, nem previsão como histórico consolidado.

## Validação e entrega
- Verificar agregações, extremos, datas, períodos incompletos e exportação.
- Verificar navegação, persistência de filtros, falhas parciais e busca de cidade.
- Conferir layouts estreitos de iPhone, texto ampliado, controles de toque e ausência de transbordamento horizontal.
- Revisar as alterações e documentar os testes executados e as limitações; publicar somente conforme a autorização disponível.

## Ordem de execução
1. Preparar o repositório e conferir as instruções existentes.
2. Implementar navegação responsiva e Histórico com as quatro métricas.
3. Acrescentar comparação, localização e melhorias de confiabilidade.
4. Validar, revisar e entregar o código com este plano.
