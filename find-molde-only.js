/*
 * find-molde-only.js
 * -------------------
 * Henter bedrifter registrert i Molde kommune (kommunenummer 1506) fra
 * Brønnøysundregisterets åpne Enhetsregister-API, og plukker ut de som er
 * aktuelle salgs-leads: aktive, næringsdrivende bedrifter som ikke er del
 * av et konsern (uavhengige, lokale aktører).
 *
 * Skriver molde-bedrifter.csv (hovedlista) og en JSON med rådata som
 * xlsx-bygget bruker videre.
 *
 * Kilde:  https://data.brreg.no/enhetsregisteret/api/enheter
 * Ingen API-nøkkel kreves. Kun HTTPS GET.
 */

const fs = require("fs");
const path = require("path");

const BASE = "https://data.brreg.no/enhetsregisteret/api";
const MOLDE_KOMMUNENR = "1506";

// Org-former vi regner som "bedrifter" å selge produkter til.
// (Utelater foreninger/lag, boligsameier, borettslag, konkursbo,
//  stiftelser, offentlige org.former m.m.)
const BEDRIFT_FORMER = new Set([
  "AS",  // Aksjeselskap
  "ASA", // Allmennaksjeselskap
  "ENK", // Enkeltpersonforetak
  "ANS", // Ansvarlig selskap
  "DA",  // Selskap med delt ansvar
  "SA",  // Samvirkeforetak
  "NUF", // Norskregistrert utenlandsk foretak
  "BA",  // Selskap med begrenset ansvar
  "KS",  // Kommandittselskap
]);

const OUT_DIR = __dirname;
const CSV_PATH = path.join(OUT_DIR, "molde-bedrifter.csv");
const JSON_PATH = path.join(OUT_DIR, "molde-bedrifter.data.json");

// -- henting med retry/backoff mot nettverksfeil og rate-limiting ----------
async function getJSON(url, attempt = 1) {
  const MAX = 5;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "molde-leads/1.0" },
    });
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.json();
  } catch (err) {
    if (attempt >= MAX) throw err;
    const waitMs = Math.min(1000 * 2 ** (attempt - 1), 16000);
    console.warn(`  ! ${err.message} – prøver igjen om ${waitMs} ms (forsøk ${attempt}/${MAX})`);
    await new Promise((r) => setTimeout(r, waitMs));
    return getJSON(url, attempt + 1);
  }
}

// -- hent alle hovedenheter i Molde (paginert) ----------------------------
async function hentAlleEnheter() {
  const size = 1000;
  let page = 0;
  const alle = [];
  while (true) {
    const url = `${BASE}/enheter?kommunenummer=${MOLDE_KOMMUNENR}&size=${size}&page=${page}`;
    const data = await getJSON(url);
    const batch = data?._embedded?.enheter ?? [];
    alle.push(...batch);
    const totalPages = data?.page?.totalPages ?? 1;
    process.stdout.write(`\r  Hentet side ${page + 1}/${totalPages} (${alle.length} enheter)   `);
    page++;
    if (page >= totalPages || batch.length === 0) break;
  }
  process.stdout.write("\n");
  return alle;
}

// -- hjelpere -------------------------------------------------------------
function aarFraDato(dato) {
  if (!dato || typeof dato !== "string") return "";
  return dato.slice(0, 4);
}

function radFraEnhet(e) {
  const adr = e.forretningsadresse ?? {};
  return {
    organisasjonsnummer: e.organisasjonsnummer ?? "",
    navn: e.navn ?? "",
    organisasjonsform: e.organisasjonsform?.kode ?? "",
    antallAnsatte: Number.isFinite(e.antallAnsatte) ? e.antallAnsatte : 0,
    naering: e.naeringskode1?.beskrivelse ?? "",
    naeringskode: e.naeringskode1?.kode ?? "",
    adresse: Array.isArray(adr.adresse) ? adr.adresse.join(", ") : (adr.adresse ?? ""),
    postnummer: adr.postnummer ?? "",
    poststed: adr.poststed ?? "",
    kommunenummer: adr.kommunenummer ?? "",
    stiftelsesaar: aarFraDato(e.stiftelsesdato),
    iForetaksregisteret: e.registrertIForetaksregisteret ? "Ja" : "Nei",
    iKonsern: e.erIKonsern ? "Ja" : "Nei",
    lenke: `https://virksomhet.brreg.no/nb/oppslag/enheter/${e.organisasjonsnummer ?? ""}`,
  };
}

function erAktiv(e) {
  return (
    e.konkurs !== true &&
    e.underAvvikling !== true &&
    e.underTvangsavviklingEllerTvangsopplosning !== true
  );
}

// -- CSV ------------------------------------------------------------------
const COLS = [
  ["organisasjonsnummer", "Organisasjonsnummer"],
  ["navn", "Navn"],
  ["organisasjonsform", "Org.form"],
  ["antallAnsatte", "Antall ansatte"],
  ["naering", "Næring"],
  ["naeringskode", "Næringskode"],
  ["adresse", "Adresse"],
  ["postnummer", "Postnr"],
  ["poststed", "Poststed"],
  ["stiftelsesaar", "Stiftet"],
  ["iForetaksregisteret", "I Foretaksreg."],
  ["iKonsern", "I konsern"],
  ["lenke", "Brreg-lenke"],
];

function csvCelle(v) {
  const s = String(v ?? "");
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function skrivCSV(rader) {
  const linjer = [];
  linjer.push(COLS.map(([, h]) => csvCelle(h)).join(","));
  for (const r of rader) {
    linjer.push(COLS.map(([k]) => csvCelle(r[k])).join(","));
  }
  fs.writeFileSync(CSV_PATH, "﻿" + linjer.join("\n"), "utf8");
}

// -- hovedflyt ------------------------------------------------------------
(async () => {
  console.log("Henter bedrifter i Molde kommune (1506) fra Brønnøysundregisteret …");
  const alle = await hentAlleEnheter();
  console.log(`Totalt registrert i Molde: ${alle.length} enheter`);

  const aktive = alle.filter(erAktiv);
  const bedrifter = aktive.filter((e) => BEDRIFT_FORMER.has(e.organisasjonsform?.kode));

  const leads = bedrifter.filter((e) => e.erIKonsern !== true).map(radFraEnhet);
  const konsern = bedrifter.filter((e) => e.erIKonsern === true).map(radFraEnhet);

  // sorter: flest ansatte først, deretter navn
  const bySize = (a, b) => b.antallAnsatte - a.antallAnsatte || a.navn.localeCompare(b.navn, "nb");
  leads.sort(bySize);
  konsern.sort(bySize);

  skrivCSV(leads);

  const stats = {
    totalIMolde: alle.length,
    aktive: aktive.length,
    inaktive: alle.length - aktive.length,
    bedriftsformer: bedrifter.length,
    ikkeBedriftsform: aktive.length - bedrifter.length,
    leads: leads.length,
    konsern: konsern.length,
    utenAnsattinfo: leads.filter((r) => r.antallAnsatte === 0).length,
    generert: new Date().toISOString(),
  };

  fs.writeFileSync(JSON_PATH, JSON.stringify({ stats, leads, konsern }, null, 2), "utf8");

  console.log("\nOppsummering");
  console.log("------------");
  console.log(`  Aktive enheter:            ${stats.aktive}`);
  console.log(`  Herav næringsdrivende:     ${stats.bedriftsformer}`);
  console.log(`  Leads (ikke i konsern):    ${stats.leads}   -> ${path.basename(CSV_PATH)}`);
  console.log(`  Konsern (eget ark):        ${stats.konsern}`);
  console.log(`  Leads uten ansatt-tall:    ${stats.utenAnsattinfo}`);
  console.log(`\nSkrev ${path.basename(CSV_PATH)} og ${path.basename(JSON_PATH)}`);
})().catch((err) => {
  console.error("\nFEIL:", err);
  process.exit(1);
});
