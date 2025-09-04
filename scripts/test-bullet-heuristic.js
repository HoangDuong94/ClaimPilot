#!/usr/bin/env node
// Quick demo of the bullet newline heuristic used in the UI streaming client.

function normalizeBulletsStreaming(prev, chunk) {
  if (!chunk) return chunk;
  let s = String(chunk);
  try {
    if (prev && !/\n$/.test(prev) && /^(\s*)(?:[-*]\s+|\d+\.\s+)/.test(s)) {
      s = "\n" + s;
    }
    // Only hyphen bullets; avoid '*' to not break bold '**'
    s = s.replace(/([^\n])(?=-\s+)/g, '$1\n');
    s = s.replace(/([^\n])(?=\d+\.\s+)/g, '$1\n');
  } catch (e) { /* ignore */ }
  return s;
}

const input = (process.argv[2] || '').trim() || `Natürlich! Hier sind Stichpunkte über Animes:
- **Definition:** Japanische Zeichentrickfilme, oft für Kinder, Jugendliche und Erwachsene.- **Stil:** Charakteristisch durch große Augen, bunte Haare, ausdrucksstarke Mimik.- **Genres:** Vielfältig, z.B. Action, Abenteuer, Romantik, Horror, Fantasy, Slice of Life, Mecha.- **Herkunft:** Ursprünglich aus Japan, international sehr beliebt.- **Formate:** Serien, Filme, OVAs (Original Video Animation), Specials.- **Manga:** Viele Animes basieren auf Mangas (japanische Comics).- **Bekannte Studios:** Studio Ghibli, Toei Animation, Madhouse, Kyoto Animation.- **Berühmte Werke:** „Naruto“, „One Piece“, „Dragon Ball“, „Attack on Titan“, „My Hero Academia“.- **Fankultur:** Große Fangemeinde weltweit, Cosplay, Conventions, Fanarts.- **Synchronisation:** Oft mit japanischer Originalsprache und Untertiteln, aber auch synchronisiert.- **Musik:** Soundtracks und Openings/Endings sind oft sehr beliebt.- **Themen:** Häufig tiefe Themen wie Freundschaft, Mut, Verlust, Erwachsenwerden.- **Merchandise:** Figuren, Poster, Kleidung, Spiele, u.v.m.- **Zensur:** In manchen Ländern werden Animes zensiert oder angepasst.`;

// Simulate stream chunks by splitting on ' - ' sequences
const parts = input.split(/\s-\s/);
let acc = parts.shift() || '';
let out = acc;
for (const part of parts) {
  const chunk = `- ${part}`;
  const norm = normalizeBulletsStreaming(acc, chunk);
  acc += norm;
  out = acc;
}

console.log("--- Normalized ---\n");
console.log(out);
