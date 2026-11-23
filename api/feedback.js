const requestWindow = 60_000;
const requestLimit = 12;
const ipRequests = new Map();
const maxLengths = { topic: 300, question: 1200, explanation: 4000, modelAnswer: 6000, studentAnswer: 6000 };

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Bruk POST for å be om tilbakemelding.' });
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host && new URL(origin).host !== host) {
    return res.status(403).json({ error: 'Forespørselen kom fra et annet nettsted.' });
  }

  const apiKey = process.env.OPEN_AI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'OpenAI-nøkkelen mangler i Vercel-miljøet.' });
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (ipRequests.get(ip) || []).filter((timestamp) => now - timestamp < requestWindow);
  if (recent.length >= requestLimit) {
    return res.status(429).json({ error: 'Du har sendt mange forespørsler. Vent litt og prøv igjen.' });
  }
  recent.push(now);
  ipRequests.set(ip, recent);

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  for (const [field, maxLength] of Object.entries(maxLengths)) {
    if (typeof body[field] !== 'string' || body[field].length > maxLength) {
      return res.status(400).json({ error: 'Et av tekstfeltene mangler eller er for langt.' });
    }
  }
  if (!body.studentAnswer.trim() || !body.question.trim()) {
    return res.status(400).json({ error: 'Oppgaven og svaret må fylles ut.' });
  }

  const input = `Du er en tålmodig norsk faglærer som hjelper en nybegynner å lære organisasjon og ledelse. Vurder studentens svar på oppgaven under. Vær ærlig, konkret og støttende. Start med hva som er riktig, si deretter hva som mangler eller er uklart, og avslutt med ett konkret forslag til forbedring. Ikke gi karakter. Skriv enkelt og kort på norsk.\n\nTema: ${body.topic}\nOppgave: ${body.question}\nFaglig forklaring: ${body.explanation}\nEksempel på godt svar: ${body.modelAnswer}\nStudentens svar: ${body.studentAnswer}`;

  try {
    const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-6.2-sol', max_output_tokens: 350, input }),
    });
    const data = await openAiResponse.json();
    if (!openAiResponse.ok) {
      const message = data?.error?.message || 'OpenAI kunne ikke behandle svaret.';
      return res.status(openAiResponse.status >= 500 ? 502 : openAiResponse.status).json({ error: message });
    }

    const feedback = data.output
      ?.flatMap((item) => item.content || [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text)
      .join(' ') || data.output_text;

    if (!feedback) return res.status(502).json({ error: 'OpenAI returnerte ikke noe svar. Prøv igjen.' });
    return res.status(200).json({ feedback });
  } catch {
    return res.status(502).json({ error: 'Fikk ikke kontakt med OpenAI. Prøv igjen om litt.' });
  }
};
