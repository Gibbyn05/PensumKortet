#!/usr/bin/env python3
"""Bygger molde-bedrifter.xlsx fra molde-bedrifter.data.json."""
import json, os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, "molde-bedrifter.data.json"), encoding="utf-8"))
stats, leads, konsern = data["stats"], data["leads"], data["konsern"]

COLS = [
    ("navn", "Navn", 42),
    ("organisasjonsnummer", "Org.nr", 12),
    ("organisasjonsform", "Org.form", 9),
    ("antallAnsatte", "Ansatte", 9),
    ("naering", "Næring", 46),
    ("naeringskode", "Næringskode", 12),
    ("adresse", "Adresse", 30),
    ("postnummer", "Postnr", 8),
    ("poststed", "Poststed", 20),
    ("stiftelsesaar", "Stiftet", 8),
    ("iForetaksregisteret", "I Foretaksreg.", 13),
    ("iKonsern", "I konsern", 10),
    ("lenke", "Brreg-lenke", 48),
]

FONT = "Arial"
HEAD_FILL = PatternFill("solid", fgColor="1F4E78")
HEAD_FONT = Font(name=FONT, bold=True, color="FFFFFF", size=11)
CELL_FONT = Font(name=FONT, size=10)
LINK_FONT = Font(name=FONT, size=10, color="0563C1", underline="single")
thin = Side(style="thin", color="D9D9D9")
BORDER = Border(bottom=thin)


def write_sheet(ws, rows):
    for c, (_, header, width) in enumerate(COLS, start=1):
        cell = ws.cell(row=1, column=c, value=header)
        cell.font = HEAD_FONT
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(vertical="center",
                                   horizontal="right" if header == "Ansatte" else "left")
        ws.column_dimensions[get_column_letter(c)].width = width
    for r, row in enumerate(rows, start=2):
        for c, (key, header, _) in enumerate(COLS, start=1):
            val = row.get(key, "")
            cell = ws.cell(row=r, column=c, value=val)
            cell.border = BORDER
            if key == "antallAnsatte":
                cell.font = CELL_FONT
                cell.alignment = Alignment(horizontal="right")
                cell.number_format = "#,##0"
            elif key == "lenke":
                cell.font = LINK_FONT
                cell.hyperlink = val
                cell.alignment = Alignment(horizontal="left")
            else:
                cell.font = CELL_FONT
                cell.alignment = Alignment(horizontal="left")
    ws.row_dimensions[1].height = 22
    ws.freeze_panes = "A2"                       # frossen topprad
    last_col = get_column_letter(len(COLS))
    ws.auto_filter.ref = f"A1:{last_col}{max(1, len(rows) + 1)}"


wb = Workbook()

ws1 = wb.active
ws1.title = "Leads"
write_sheet(ws1, leads)

ws2 = wb.create_sheet("Konsern - til vurdering")
write_sheet(ws2, konsern)

# --- Ark 3: Om datasettet ---
ws3 = wb.create_sheet("Om datasettet")
ws3.column_dimensions["A"].width = 42
ws3.column_dimensions["B"].width = 62
ws3.cell(row=1, column=1, value="Molde-bedrifter – om datasettet").font = Font(name=FONT, bold=True, size=14)

# (label, verdi, bold_label)
info = [
    ("", "", False),
    ("Kilde", "Brønnøysundregisteret, Enhetsregisteret (åpne data, data.brreg.no)", False),
    ("Generert", stats["generert"][:19].replace("T", " "), False),
    ("Geografi", "Forretningsadresse i Molde kommune (kommunenummer 1506)", False),
    ("", "", False),
    ("Utvalgskriterier for arket «Leads»", "", True),
    ("  1. Næringsdrivende org.former", "AS, ASA, ENK, ANS, DA, SA, NUF, BA, KS", False),
    ("     (utelatt)", "foreninger/lag, boligsameier, borettslag, konkursbo, stiftelser m.m.", False),
    ("  2. Aktiv", "ikke konkurs, ikke under avvikling/tvangsavvikling", False),
    ("  3. Ikke i konsern", "erIKonsern = false (uavhengige, lokale aktører)", False),
    ("", "", False),
    ("Nøkkeltall", "", True),
    ("Enheter registrert i Molde", stats["totalIMolde"], False),
    ("  – herav aktive", stats["aktive"], False),
    ("  – herav næringsdrivende (aktive)", stats["bedriftsformer"], False),
    ("Leads (ikke i konsern)", stats["leads"], False),
    ("Konsern (eget ark)", stats["konsern"], False),
    ("Leads uten registrert ansatt-tall", stats["utenAnsattinfo"], False),
    ("", "", False),
    ("Merknader", "", True),
    ("Ansatte", "Ansatt-tall oppgis kun der bedriften har registrert det. 0 betyr «ikke "
                "registrert», ikke nødvendigvis null ansatte.", False),
    ("«Konsern»-arket", "Selskaper med erIKonsern=true. Noen kan være små, rent lokale konsern "
                        "(din «kun i Molde og omegn»-del) – vurder disse manuelt.", False),
]
for i, (a, b, bold) in enumerate(info, start=2):
    ca = ws3.cell(row=i, column=1, value=a)
    cb = ws3.cell(row=i, column=2, value=b)
    ca.font = Font(name=FONT, size=11 if bold else 10, bold=bold)
    cb.font = Font(name=FONT, size=10)
    cb.alignment = Alignment(wrap_text=True, vertical="top")

out = os.path.join(HERE, "molde-bedrifter.xlsx")
wb.save(out)
print("Skrev", out)
print("Ark:", [s.title for s in wb.worksheets])
print("Leads:", len(leads), "| Konsern:", len(konsern))
