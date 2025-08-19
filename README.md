# Catálogo + Parcelamento (React + Vite + Tailwind)

App para listar aparelhos (Android, iPhones novos e seminovos) e calcular parcelamento com **tabela de juros editável**, com persistência em **NocoDB** (modo linhas: `Parcelas`/`Juros`) ou `localStorage`.

## Como rodar localmente

1) Baixe o ZIP e extraia:
```bash
unzip catalogo-parcelamento.zip
cd catalogo-parcelamento
```

2) Instale as dependências:
```bash
npm install
```

3) Copie o arquivo de exemplo de ambiente e preencha o **token**:
```bash
cp .env.example .env.local
# edite .env.local e preencha VITE_NOCO_TOKEN com seu token do NocoDB
```

4) Rode em modo dev:
```bash
npm run dev
```

Abra o endereço que o Vite informar (geralmente http://localhost:5173).

## Variáveis de ambiente (Vite)

Veja `.env.example`:
- `VITE_NOCO_URL` — URL do seu NocoDB
- `VITE_NOCO_TOKEN` — token de acesso (NÃO commitar)
- `VITE_NOCO_TABLE_ANDROID` — id da tabela Android
- `VITE_NOCO_TABLE_IPHONES_NOVOS` — id da tabela iPhones novos
- `VITE_NOCO_TABLE_IPHONES_SEMIS` — id da tabela iPhones seminovos
- `VITE_NOCO_TABLE_JUROS` — id da tabela de juros (linhas)
- `VITE_JUROS_PARCELAS_COL` — nome da coluna de parcelas (padrão `Parcelas`)
- `VITE_JUROS_JUROS_COL` — nome da coluna de juros (padrão `Juros`)
- `VITE_JUROS_PERCENT_AS_FRACTION` — `false` se a coluna guarda `12.776` como percentual direto (padrão). `true` caso guarde como fração (`0.12776`).

## Observações

- O botão **Atualizar dados** recarrega **aparelhos** e **juros** (NocoDB).
- O editor salva juros no NocoDB (criando/atualizando uma linha por parcela).
- Sem URL/token ou tabela configurada, o app cai para `localStorage` automaticamente.
- **Não commite o `.env.local`**: seu token deve ficar só no seu computador.

## Build de produção
```bash
npm run build
npm run preview
```

