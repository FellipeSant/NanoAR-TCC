# NanoAR

Realidade aumentada no navegador com estruturas de carbono: aponte a câmera do celular para os
QR codes do cartaz e veja grafite, nanotubo, fulereno, diamante e grafite natural em 3D.

Site: <https://fellipesant.github.io/NanoAR-TCC/>

## Como funciona

- **Uma página só** ([ar.html](ar.html)) reconhece todos os QR codes do cartaz.
- Os QR codes impressos apontam para os endereços antigos (`Pages/grafite.html` etc.). Esses arquivos
  agora só **redirecionam** para `ar.html` — **não apague nem renomeie** nada em `Pages/`.
- Cada QR code é ao mesmo tempo o link e o "alvo" da realidade aumentada ([MindAR](https://github.com/hiukim/mind-ar-js)).
  Como os QR codes são muito parecidos entre si, o MindAR informa *onde* está o QR code e a página
  **lê o próprio QR code** para saber *qual* é.
- As estruturas de carbono são **geradas por código** ([js/structures.js](js/structures.js)) com a geometria
  real (ligação C–C de 1,42 Å, 0,335 nm entre camadas…). Por isso não há modelos 3D pesados para baixar
  e dá para animar átomo por átomo:
  - **Grafite**: arraste a camada de cima para o lado (ou toque) para esfoliar camada por camada até o grafeno;
    o cartão muda a cada camada.
  - **Nanotubo**: uma folha de grafeno se enrola no tubo.
  - **Fulereno**: um floco plano se curva e fecha no C₆₀.
- Gestos: arrastar gira, pinça amplia/reduz, tocar anima.
- O QR code do **grafeno** está **reservado** (mostra "em breve").

## Onde mudar cada coisa

| Quero mudar… | Arquivo |
|---|---|
| Textos dos cartões, fatos, animações, tamanho/inclinação | [js/targets.js](js/targets.js) |
| Cores e espessuras dos átomos e ligações | página `admin.html` → [config/style.json](config/style.json) |
| Colocar uma molécula no QR code reservado (grafeno) | entrada `reservado` em [js/targets.js](js/targets.js): troque `placeholder: true` por `structure` ou `model: 'models/arquivo.glb'` |

### Cores (página de administração)

Abra `https://fellipesant.github.io/NanoAR-TCC/admin.html` (não há link para ela no site):

1. Escolha cores/tamanhos (para todas as estruturas ou só uma) — a prévia usa um fundo de QR code.
2. **Testar na câmera**: as cores valem **só neste aparelho** (aparece o selo "Cores de teste").
3. **Baixar style.json** e envie para a pasta `config/` do repositório (Add file → Upload files → Commit).
   Em alguns minutos, todo mundo passa a ver as novas cores.

## Estrutura

```
index.html            página inicial
ar.html               realidade aumentada (todas as estruturas)
admin.html            administração das cores (não listada)
Pages/*.html          endereços antigos dos QR codes → redirecionam para ar.html
js/targets.js         configuração dos alvos e textos
js/structures.js      geração das estruturas e animações
js/kit.js             renderização (three.js), gestos, animações
js/ar.js              página de RA (MindAR + leitura de QR code)
js/admin.js, style.js página de administração e cores
config/style.json     cores publicadas
assets/targets.mind   alvos dos 6 QR codes juntos (+ .gz, metade do tamanho, usado pelo site)
assets/targets/       alvos individuais (fonte para gerar o targets.mind)
models/               grafite-rocha.glb + versões otimizadas dos modelos antigos
models/original/      modelos 3D originais
tools/                scripts de manutenção
```

## Ferramentas

```bash
pip install msgpack numpy pygltflib fast-simplification DracoPy pillow

# junta assets/targets/*.mind (na ordem 0-, 1-, …) em assets/targets.mind; depois gere o .gz
python tools/merge_mind.py
gzip -9 -n -k -f assets/targets.mind

# deixa modelos .glb leves (models/original/X.glb → models/X.glb)
python tools/optimize_models.py
```

Para um QR code novo, compile a imagem dele no [compilador do MindAR](https://hiukim.github.io/mind-ar-js-doc/tools/compile),
salve em `assets/targets/6-nome.mind`, rode o `merge_mind.py` e acrescente a entrada correspondente no fim
de `TARGETS` em [js/targets.js](js/targets.js) (a ordem precisa ser a mesma).

## Testar no computador

```bash
python3 -m http.server 8000
```

Abra <http://localhost:8000/>. A câmera funciona em `localhost` e em `https://` (GitHub Pages).
`ar.html?debug` mostra no console qual QR code foi lido.

Bibliotecas (via CDN, versões fixas): [three.js](https://threejs.org) r160 e MindAR 1.2.5; jsQR 1.4.0 só em
navegadores sem leitor de QR code nativo (iPhone).
