# NanoAR

Realidade aumentada no navegador com estruturas de carbono: aponte a câmera do celular para os
QR codes do cartaz e veja grafite, nanotubo, fulereno, diamante e grafite natural em 3D.

Site: <https://fellipesant.github.io/NanoAR-TCC/>

Um projeto do [Nanoscale Physics Group · UFOP](https://nano.ufop.br/).

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
  - **Grafite**: deslize o dedo na diagonal, para cima, para jogar a camada de cima longe (ou toque) e
    esfoliar camada por camada até o grafeno; a camada vai na direção do gesto e o cartão muda a cada camada.
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

Abra `https://fellipesant.github.io/NanoAR-TCC/admin.html` (não há link para ela no site) e digite a senha.

- **A senha não está no repositório** (que é público): o código guarda só uma "impressão digital" dela
  (hash PBKDF2 com sal, em [js/admin-auth.js](js/admin-auth.js)). A senha fica anotada só no computador do
  administrador, em `SENHA-ADMIN.local.txt`, que o `.gitignore` impede de ir para o GitHub.
  Para trocar: `python3 tools/admin_password.py`.
- **Publicar para todos**: grava `config/style.json` no GitHub; em 1–2 minutos todos os celulares veem as
  novas cores. Na primeira vez em cada aparelho, informe um **token do GitHub** (fine-grained, só este
  repositório, permissão *Contents: Read and write*). Ele fica guardado só naquele aparelho, criptografado
  com a senha — **nunca** coloque o token em arquivos do projeto.
- **Testar só neste aparelho**: aplica as cores apenas no seu celular (aparece o selo "Cores de teste").
- **Baixar style.json**: alternativa manual (enviar o arquivo para a pasta `config/` pelo GitHub).

Como o site é estático, a senha só "tranca a porta" da página; o que impede mudanças indevidas é o token,
que só existe nos aparelhos dos administradores.

### Acessibilidade

Botão **Acessibilidade** na página inicial e na câmera ([js/a11y.js](js/a11y.js)), com as escolhas salvas no aparelho:
tamanho do texto (também com A−/A+ e pinça no cartão), alto contraste, reduzir movimentos, leitura dos cartões
em voz alta (e botão "ouvir" em cada cartão), botões para girar e ampliar sem gestos e tradução para Libras
(VLibras, carregado só quando pedido). Leitores de tela recebem avisos ("Grafite. 5 camadas."), os botões têm
rótulos e o foco do teclado é visível.

### Telas

O layout se adapta sozinho: celulares estreitos, celulares, tablets e notebooks ajustam o tamanho de tudo;
com a tela deitada (tablet, notebook ou celular deitado) o cartão vai para a lateral e a câmera fica livre.

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
js/admin.js           página de administração (cores, publicar)
js/admin-auth.js      senha (só o hash) e publicação no GitHub
js/a11y.js            recursos de acessibilidade
js/style.js           cores (publicadas / teste local)
config/style.json     cores publicadas
assets/targets.mind   alvos dos 6 QR codes juntos (+ .gz, metade do tamanho, usado pelo site)
assets/targets/       alvos individuais (fonte para gerar o targets.mind)
models/               grafite-rocha.glb + versões otimizadas dos modelos antigos
models/original/      modelos 3D originais
tools/                scripts de manutenção (alvos, modelos, senha do admin)
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
