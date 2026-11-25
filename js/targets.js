// Configuração dos alvos (QR codes do cartaz) e do que aparece em cada um.
//
// A ORDEM desta lista precisa ser a mesma ordem dos alvos em assets/targets.mind
// (gerado por tools/merge_mind.py a partir de assets/targets/0-*.mind, 1-*.mind, ...).
//
// Campos:
//   id          nome curto, usado em admin.html#<id> e nas cores por estrutura (config/style.json)
//   page        página antiga para onde o QR code impresso aponta (Pages/<page>.html) — NÃO renomear
//   name, tag, description, note   textos do cartão informativo (note = observação em itálico, opcional)
//   facts       fatos curtos em "pílulas": [{ label: 'Ano', value: '2004' }, ...] (opcional)
//   placeholder true = QR code reservado: mostra só o cartão "em breve", sem estrutura 3D
//   structure   estrutura gerada por código (js/structures.js): graphene, graphite, nanotube, fullerene, diamond
//   model       OU um arquivo .glb (ex.: 'models/grafite-rocha.glb'). Versões otimizadas dos modelos
//               antigos estão em models/*.glb — para voltar a usá-las, troque `structure` por `model`.
//   size        tamanho na tela, em larguras do QR code (1 = mesma largura do QR)
//   tilt        inclinação (graus) em direção a quem olha, para ver a estrutura "de cima"
//   lift        quanto o modelo flutua à frente do cartaz (em larguras do QR)
//   animation   (opcional) animação ao tocar na estrutura
//                 mode 'steps' : passo a passo (grafite: uma camada por toque); `stages` = cartão de cada passo
//                 mode 'toggle': vai e volta; `after` = textos do estado final
//                 mode 'story' : mostra a formação a partir do grafeno e termina na estrutura

const GRAPHENE = {
  name: 'Grafeno',
  tag: 'Carbono sp² · uma camada atômica',
  description:
    'Uma única camada de átomos de carbono em rede hexagonal, com apenas um átomo de espessura. É extremamente resistente, flexível e ótimo condutor de eletricidade e calor.',
};

export const TARGETS = [
  {
    id: 'diamante',
    page: 'diamanteMolecula',
    name: 'Diamante',
    tag: 'Carbono sp³ · rede tridimensional',
    description:
      'Cada átomo de carbono se liga a outros quatro, formando uma rede tetraédrica que se repete nas três dimensões. Essas ligações fortes tornam o diamante o material natural mais duro que existe.',
    facts: [
      { label: 'Dureza (Mohs)', value: '10, a máxima' },
      { label: 'Ligação', value: '1,54 Å' },
    ],
    structure: 'diamond',
    size: 0.85,
    tilt: 20,
  },
  {
    id: 'fulereno',
    page: 'fulereno',
    name: 'Fulereno (C₆₀)',
    tag: 'Carbono sp² · molécula esférica',
    description:
      'Sessenta átomos de carbono arranjados em 12 pentágonos e 20 hexágonos, como uma bola de futebol. Sua descoberta, em 1985, rendeu o Prêmio Nobel de Química de 1996.',
    facts: [
      { label: 'Descoberta', value: '1985' },
      { label: 'Nobel de Química', value: '1996' },
    ],
    structure: 'fullerene',
    size: 0.75,
    tilt: 0,
    animation: {
      mode: 'story',
      action: 'Ver como se forma',
      steps: [
        'Um floco plano de carbono…',
        'Pentágonos fazem a folha se curvar…',
        'Fulereno C₆₀!',
      ],
    },
    note: 'Em 2010, pesquisadores filmaram em um microscópio eletrônico flocos de grafeno se curvando e fechando em fulerenos.',
  },
  {
    // QR code do grafeno: RESERVADO para uma nova molécula. Para usá-lo, troque `placeholder: true`
    // por `structure: '...'` ou `model: 'models/....glb'` e escreva os textos (o `page` não muda).
    id: 'reservado',
    page: 'grafeno',
    placeholder: true,
    name: 'Em breve: uma nova molécula',
    tag: 'QR code reservado',
    description:
      'Este QR code vai ganhar uma nova estrutura em breve. Enquanto isso, aponte para o QR code do grafite e toque nele: as camadas se separam até sobrar uma só — o grafeno!',
  },
  {
    id: 'grafite',
    page: 'grafite',
    name: 'Grafite',
    tag: 'Carbono sp² · camadas empilhadas',
    description:
      'Camadas de grafeno empilhadas, separadas por apenas 0,335 nanômetro e unidas por forças fracas. Como elas deslizam facilmente umas sobre as outras, o grafite deixa marca no papel — é o “grafite” do lápis.',
    facts: [
      { label: 'Entre camadas', value: '0,335 nm' },
      { label: 'Em 1 mm', value: '≈ 3 milhões de camadas' },
    ],
    structure: 'graphite',
    params: { layers: 5 },
    size: 0.95,
    tilt: 30,
    // Esfoliação camada por camada: cada toque descola uma camada e o cartão muda.
    // `stages`: o que mostrar quando sobrarem N camadas (5 camadas = textos acima).
    animation: {
      mode: 'steps',
      action: 'Remover uma camada',
      undo: 'Juntar as camadas de novo',
      stages: [
        {
          layers: 4,
          name: 'Grafite: um pouco de história',
          tag: 'Esfoliação · 4 camadas',
          description:
            'O nome vem do grego graphein, “escrever”, e foi dado pelo mineralogista Abraham Werner em 1789. Bem antes disso, no século XVI, uma grande jazida de grafite encontrada na Inglaterra deu origem aos primeiros lápis.',
          facts: [{ label: 'Nome', value: '1789' }],
        },
        {
          layers: 3,
          name: 'Esfoliação com fita adesiva',
          tag: 'Esfoliação · 3 camadas',
          description:
            'Em 2004, Andre Geim e Konstantin Novoselov, da Universidade de Manchester, colaram fita adesiva no grafite e descolaram camadas repetidas vezes — exatamente o que você está fazendo — até chegar a flocos com um único átomo de espessura.',
          facts: [
            { label: 'Ano', value: '2004' },
            { label: 'Onde', value: 'Manchester (Reino Unido)' },
          ],
        },
        {
          layers: 2,
          name: 'Grafeno bicamada',
          tag: 'Esfoliação · 2 camadas',
          description:
            'Com só duas camadas, surgem propriedades surpreendentes. Em 2018, pesquisadores do MIT mostraram que, girando uma camada sobre a outra em um “ângulo mágico” de cerca de 1,1°, o material se torna supercondutor.',
          facts: [
            { label: 'Ângulo mágico', value: '≈ 1,1°' },
            { label: 'Ano', value: '2018' },
          ],
        },
        {
          layers: 1,
          ...GRAPHENE,
          facts: [
            { label: 'Nobel de Física', value: '2010' },
            { label: 'Espessura', value: '1 átomo' },
          ],
          note: 'Geim e Novoselov receberam o Nobel de Física de 2010 pelo grafeno. Aplicações em estudo: telas flexíveis, baterias, sensores, filtros de água e materiais mais leves e resistentes.',
        },
      ],
    },
  },
  {
    id: 'grafite-rocha',
    page: 'grafiteRocha',
    name: 'Grafite natural',
    tag: 'Mineral · rocha',
    description:
      'O grafite também é encontrado na natureza como mineral. O Brasil está entre os maiores produtores do mundo, com importantes jazidas em Minas Gerais. É dele que se obtém, por esfoliação, o grafeno.',
    model: 'models/grafite-rocha.glb',
    size: 0.8,
    tilt: 0,
  },
  {
    id: 'nanotubo',
    page: 'nanotubo',
    name: 'Nanotubo de carbono',
    tag: 'Carbono sp² · cilindro nanométrico',
    description:
      'Uma folha de grafeno enrolada em forma de cilindro, com diâmetro de poucos nanômetros. Combina altíssima resistência mecânica com propriedades elétricas que dependem da forma como a folha é enrolada.',
    facts: [
      { label: 'Popularizado em', value: '1991 (Sumio Iijima)' },
      { label: 'Diâmetro', value: '≈ 1 nm' },
    ],
    structure: 'nanotube',
    size: 1.0,
    tilt: 10,
    animation: {
      mode: 'story',
      action: 'Ver como se forma',
      steps: ['Uma folha de grafeno…', 'A folha se enrola…', 'Nanotubo de carbono!'],
    },
  },
];

// Quantos QR codes são acompanhados ao mesmo tempo. 1 = mais leve: mostra o que está em foco.
export const MAX_TRACK = 1;

// Aparência padrão dos átomos e ligações. As cores publicadas ficam em config/style.json
// e podem ser mudadas pela página admin.html (ver js/style.js).
export const STYLE = {
  atomColor: '#1fae9f',
  bondColor: '#8ea3ae',
  atomRadius: 0.36, // Å
  bondRadius: 0.12, // Å
};

export function findTarget(key) {
  if (!key) return null;
  const k = decodeURIComponent(key).toLowerCase();
  return TARGETS.find((t) => t.id === k || t.page.toLowerCase() === k) || null;
}
