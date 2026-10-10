#!/usr/bin/env python3
"""Writes ../renders/AgroFlow_v4_Voiceover_Script.pdf from assets/vo/cues.json and scenes.json (needs reportlab)."""
import json, os
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from xml.sax.saxutils import escape

V = "/home/user/AgroFlow/showcase/v4/"
cues = json.load(open(V + "assets/vo/cues.json"))
scenes = {s["scene"]: s for s in json.load(open(V + "assets/vo/scenes.json"))}
total = max(s["start"] + s["dur"] for s in scenes.values())
ordered = sorted(cues, key=lambda c: c["at"])
for i, c in enumerate(ordered):
    sc = scenes[c["scene"]]
    nxt = ordered[i + 1]["at"] if i + 1 < len(ordered) else total
    c["limit"] = min(nxt, sc["start"] + sc["dur"]) if c["scene"] != 14 else nxt
tc = lambda t: f"{int(t // 60)}:{t % 60:04.1f}"
words = lambda c: len(c["text"].split())

FOREST = colors.HexColor("#184d35"); MUTED = colors.HexColor("#637064"); LINE = colors.HexColor("#d9dfda"); SOFT = colors.HexColor("#eef4f0")
ss = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=20, textColor=FOREST, alignment=0, spaceAfter=4)
SUB = ParagraphStyle("sub", parent=ss["Normal"], fontSize=10, textColor=MUTED, leading=14)
H2 = ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=13, textColor=FOREST, spaceBefore=10, spaceAfter=3)
META = ParagraphStyle("meta", parent=ss["Normal"], fontSize=9, textColor=MUTED, leading=12)
LINEP = ParagraphStyle("line", parent=ss["Normal"], fontSize=12.5, leading=18, leftIndent=8, borderPadding=(6, 8, 6, 8), backColor=SOFT, spaceBefore=4, spaceAfter=4)
BODY = ParagraphStyle("body", parent=ss["Normal"], fontSize=10, leading=14)

out = "/home/user/AgroFlow/showcase/renders/AgroFlow_v4_Voiceover_Script.pdf"
doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=16*mm, bottomMargin=16*mm,
                        title="AgroFlow showcase v4 - voice-over script", author="INF3003W Team 2")
st = [Paragraph("AgroFlow showcase v4: voice-over script", H1),
      Paragraph(f"INF3003W Team 2 · video length {tc(total)} · 1920×1080, 25 fps · read at about 140 words a minute", SUB),
      Spacer(1, 6),
      Paragraph("Times are minutes:seconds from the start of the video. <b>In</b> is when your first word starts; "
                "<b>Out by</b> is when you must be finished (the next line starts, or the scene changes). "
                "Record one WAV per line, 48 kHz, quiet room, with 1 second of silence at the start, named as shown.", BODY),
      Spacer(1, 8)]
rows = [["Speaker", "Lines"],
        ["Leruo", "1 problem · 6 field kit · 9 execution · 10 weather change · 13 testing · close (b)"],
        ["Olwethu", "2 enquiry · 3 call-back · 11 reports · 12 admin view · close (d)"],
        ["Philisile", "4 onboarding · 5 Telegram and first sign-in · close (c)"],
        ["Lubaelihle", "7 zone setup in the app · 8 daily use · close (a)"]]
t = Table(rows, colWidths=[28*mm, 146*mm])
t.setStyle(TableStyle([("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9.5), ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
                       ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("BACKGROUND", (0, 0), (-1, 0), FOREST),
                       ("GRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                       ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
st += [t, Spacer(1, 6)]
for c in ordered:
    sub = f" ({c['id'][3]})" if c["scene"] == 14 else ""
    block = [Paragraph(f"{c['scene']}. {escape(c['title'])}{sub} · {c['speaker']}", H2),
             Paragraph(f"File: <b>{c['id']}.wav</b> &nbsp;·&nbsp; In: <b>{tc(c['at'])}</b> &nbsp;·&nbsp; Out by: <b>{tc(c['limit'])}</b> "
                       f"(slot {c['limit'] - c['at']:.1f} s) &nbsp;·&nbsp; {words(c)} words ≈ {words(c) / 140 * 60:.1f} s at 140 wpm", META),
             Paragraph(escape(c["text"]), LINEP)]
    st.append(KeepTogether(block))
def footer(canvas, d):
    canvas.saveState(); canvas.setFont("Helvetica", 8); canvas.setFillColor(MUTED)
    canvas.drawString(18*mm, 9*mm, "AgroFlow showcase v4 · voice-over script"); canvas.drawRightString(A4[0] - 18*mm, 9*mm, f"Page {d.page}")
    canvas.restoreState()
doc.build(st, onFirstPage=footer, onLaterPages=footer)
print(out)
