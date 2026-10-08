#!/usr/bin/env python3
"""Works out the illustrative demo numbers with the same formulas the AgroFlow
engine uses, so every figure on screen is internally consistent.

Formulas (backend/AgroFlow.Domain/Agronomy/SoilWaterBalance.cs, Fao56EngineReference.cs):
  TAW = 1000 (thetaFC - thetaWP) Zr            loam 0.25/0.12, tomato Zr 0.7 m
  p   = p_tab * soilFactor + 0.04 (5 - ETc)     tomato p 0.40, loam factor 1.00
  RAW = p * TAW
  Kc  development stage: linear 0.60 -> 1.15 over days 30..70 (Table 11/12 tomato 30/40/45/30)
  Rain counts only if >= 0.2 * ETo (EffectiveRainfallMm)
  Dr_i = clamp(Dr_{i-1} - rain - irrigation + ETc, 0, TAW)
  Water when Dr >= RAW; litres = Dr * area; minutes = ceil(litres / flow)
  Skip for rain when today's rain >= today's ETc
"""
import json, math, sys

TAW = 1000 * (0.25 - 0.12) * 0.7          # 91.0 mm
AREA, FLOW = 50.0, 25.0                    # m2, L/min (the zone's setup)

def kc(day):
    if day <= 30: return 0.60
    if day <= 70: return 0.60 + (day - 30) / 40 * (1.15 - 0.60)
    if day <= 115: return 1.15
    return 1.15 + (day - 115) / 30 * (0.80 - 1.15)

def p_adj(etc):
    return min(0.8, max(0.1, 0.40 * 1.00 + 0.04 * (5 - etc)))

def eff_rain(rain, eto):
    return 0.0 if rain <= 0 or rain < 0.2 * eto else rain

def project(dr0, day0, days):
    """days: list of (label, eto, rain). Returns rows with Dr at end of each day."""
    rows, dr, first = [], dr0, None
    for i, (lab, eto, rain) in enumerate(days):
        k = kc(day0 + i + 1)
        etc = eto * k
        dr = min(TAW, max(0.0, dr - eff_rain(rain, eto) + etc))
        raw = p_adj(etc) * TAW
        due = dr >= raw
        if due and first is None: first = lab
        rows.append(dict(day=lab, eto=eto, rain=rain, kc=round(k, 3), etc=round(etc, 2), dr=round(dr, 1), raw=round(raw, 1), due=due))
    return rows, first

out = {}
# ---- today (Thursday, day 66 of the season) -----------------------------------
day0 = 66
eto0, rain0 = 5.8, 2.0
k0 = kc(day0); etc0 = eto0 * k0; p0 = p_adj(etc0); raw0 = p0 * TAW
dr0 = 35.0
litres = dr0 * AREA; minutes = math.ceil(litres / FLOW)
out["today"] = dict(day=day0, eto=eto0, kc=round(k0, 2), etc=round(etc0, 1), p=round(p0, 2), pct=round(p0 * 100),
                    taw=round(TAW, 1), raw=round(raw0, 1), dr=dr0, rain=rain0, water=dr0 >= raw0,
                    skip=rain0 >= etc0, litres=litres, minutes=minutes)

# ---- the farmer logs 1500 L instead of 1750 L -----------------------------------
logged_l = 1500.0
applied_mm = logged_l / AREA
dr_after = max(0.0, dr0 - applied_mm)
out["logged"] = dict(litres=logged_l, mm=applied_mm, dr_after=dr_after)

# ---- rolling outlook, forecast A (dry week) and forecast B (rain arrives) ------
A = [("Fri", 5.9, 0), ("Sat", 6.1, 0), ("Sun", 5.6, 0), ("Mon", 5.2, 0), ("Tue", 5.5, 0), ("Wed", 5.8, 0)]
B = [("Fri", 5.9, 0), ("Sat", 2.4, 22), ("Sun", 3.6, 4), ("Mon", 5.0, 0), ("Tue", 5.5, 0), ("Wed", 5.8, 0)]
for name, f in (("forecastA", A), ("forecastB", B)):
    rows, first = project(dr_after, day0, f)
    out[name] = dict(rows=rows, next_watering=first)
print(json.dumps(out, indent=1))
