// api/gerar.js
const LIMITE_MENSAL = 30;
const usos = {};

function getChave(req) {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'x';
  const ua = req.headers['user-agent'] || '';
  return Buffer.from(ip + ua).toString('base64').slice(0, 32);
}

function getMes() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function verificar(chave) {
  const key = `${chave}:${getMes()}`;
  if (!usos[key]) usos[key] = 0;
  return { realizados: usos[key], limite: LIMITE_MENSAL, bloqueado: usos[key] >= LIMITE_MENSAL };
}

function registrar(chave) {
  const key = `${chave}:${getMes()}`;
  if (!usos[key]) usos[key] = 0;
  usos[key]++;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  try {
    const chave = getChave(req);
    const lim = verificar(chave);

    if (lim.bloqueado) {
      return res.status(429).json({
        erro: 'limite_atingido',
        mensagem: `Você atingiu o limite de ${LIMITE_MENSAL} processos este mês. Renova no próximo mês.`,
        realizados: lim.realizados,
        limite: lim.limite
      });
    }

    const { prompt, tipo } = req.body;
    if (!prompt) return res.status(400).json({ erro: 'Prompt não informado' });

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: tipo === 'preco' ? 1500 : 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      throw new Error(e?.error?.message || `Erro ${resp.status}`);
    }

    const dados = await resp.json();
    const texto = (dados.content || []).map(b => b.text || '').join('').trim();

    registrar(chave);
    const limAtual = verificar(chave);

    return res.status(200).json({
      resultado: texto,
      uso: { realizados: limAtual.realizados, limite: limAtual.limite, restantes: limAtual.limite - limAtual.realizados }
    });

  } catch (err) {
    return res.status(500).json({ erro: 'Erro interno', mensagem: err.message });
  }
};
