#!/usr/bin/env python3
"""Writes compositions/c01..c14 for the v4 showcase. Scene-local times (seconds) follow the
narration in assets/vo/cues.json read at about 140 words a minute; every on-screen sentence
and number is taken from a real capture, AgroFlow's own code, or its engine output
(capture/engine/*.json). Run: python3 build-scenes.py && python3 build-index.py"""
import json, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
DUR = {s["scene"]: s["dur"] for s in json.load(open("assets/vo/scenes.json"))}
R = "capture/raw/"

JS_HELPERS = """
  const tl = gsap.timeline({ paused: true });
  const E = "power3.out";
  const IN = (s, t, d = 0.5) => tl.fromTo(s, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: d, ease: E }, t);
  const INX = (s, t, d = 0.5) => tl.fromTo(s, { opacity: 0, x: -22 }, { opacity: 1, x: 0, duration: d, ease: E }, t);
  const OUT = (s, t, d = 0.4) => tl.to(s, { opacity: 0, duration: d, ease: "power2.in" }, t);
  const SHOW = (s, t, d = 0.35) => tl.fromTo(s, { opacity: 0 }, { opacity: 1, duration: d, ease: "power1.out" }, t);
  const HL = (s, t, d) => { tl.fromTo(s, { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 0.35, ease: E }, t); tl.to(s, { opacity: 0, duration: 0.3 }, t + d); };
  const TAP = (s, t) => tl.fromTo(s, { opacity: 0.95, scale: 0.4 }, { opacity: 0, scale: 1.6, duration: 0.7, ease: "power2.out", immediateRender: false }, t);
"""

def comp(n, style, body, script):
    cid = f"c{n:02d}"
    end = round(DUR[n] - 0.45, 2)
    return f"""<!doctype html>
<html><head><meta charset="UTF-8" /></head>
<body>
<template>
<style>
  #{cid}-root {{ position: absolute; inset: 0; }}
{style}
</style>
<div id="{cid}-root" data-composition-id="{cid}" data-width="1920" data-height="1080">
  <div id="{cid}-in" class="layer">
{body}
  </div>
</div>
<script>
(() => {{{JS_HELPERS}{script}
  OUT("#{cid}-in", {end});
  window.__timelines["{cid}"] = tl;
}})();
</script>
</template>
</body></html>
"""

def phone(pid, left, top, inner):
    return f'<div id="{pid}" class="phone" style="left:{left}px;top:{top}px"><div class="pscreen"><div class="pcam">\n{inner}\n</div></div></div>'

def browser(bid, left, top, url, inner, scale=1.0):
    st = f"left:{left}px;top:{top}px" + (f";transform:scale({scale});transform-origin:0 0" if scale != 1 else "")
    return f'<div id="{bid}" class="browser" style="{st}"><div class="bbar"><i></i><i></i><i></i><b>{url}</b></div><div class="bscreen"><div class="bcam">\n{inner}\n</div></div></div>'

def imgs(prefix, files):
    return "\n".join(f'<img id="{prefix}{i}" src="{R}{f}" alt="" />' for i, f in enumerate(files))

def hl(hid, l, t, w, h):
    return f'<div class="hl" id="{hid}" style="left:{l}px;top:{t}px;width:{w}px;height:{h}px"></div>'

def spot(sid, l, t, w, h):
    return f'<div class="spot" id="{sid}" style="left:{l}px;top:{t}px;width:{w}px;height:{h}px"></div>'

def cap(cid, k, t, s=""):
    return f'<div class="cap" id="{cid}"><div class="k">{k}</div><div class="t">{t}</div>' + (f'<div class="s">{s}</div>' if s else "") + "</div>"

def persona(pid, letter, name, role, left, top):
    return f'<div class="persona" id="{pid}" style="left:{left}px;top:{top}px"><b>{letter}</b>{name} <span>· {role} (persona)</span></div>'

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def tg(tid, title, bubbles):
    """bubbles: list of (kind, html) - kind 'bot', 'me' or 'btn'."""
    out = []
    for kind, html in bubbles:
        if kind == "btn":
            out.append(f'<div class="tgbtn">{html}</div>')
        else:
            out.append(f'<div class="bub{" me" if kind == "me" else ""}">{html}</div>')
    return (f'<div class="tg" id="{tid}"><div class="top"><i></i><div><b>{title}</b><small>bot</small></div></div>'
            f'<div class="msgs">{"".join(out)}</div><div class="mock">Mock-up · demo values</div></div>')

files = {}

# ---------- 1. The problem (Leruo) -------------------------------------------------------------
files["c01-problem"] = comp(1, """
  #c01-title { position: absolute; left: 0; right: 0; top: 330px; text-align: center; }
  #c01-title img { width: 120px; height: 120px; border-radius: 28px; }
  #c01-title h1 { margin-top: 22px; font-weight: 700; font-size: 84px; letter-spacing: -.02em; color: #184d35; }
  #c01-title p { margin-top: 10px; font-weight: 500; font-size: 30px; color: #4b5a4d; }
  .c01-c { position: absolute; top: 380px; width: 540px; padding: 34px 36px; }
  .c01-c .h { font-weight: 700; font-size: 18px; letter-spacing: .16em; text-transform: uppercase; }
  .c01-c .m { margin-top: 14px; font-weight: 700; font-size: 40px; line-height: 1.15; color: #253126; }
  #c01-bar { position: absolute; left: 96px; top: 760px; width: 1728px; padding: 30px 36px; display: flex; align-items: center; gap: 28px; }
  #c01-bar img { width: 72px; height: 72px; border-radius: 18px; }
  #c01-bar .m { font-weight: 700; font-size: 38px; color: #184d35; }
  #c01-bar .chips { margin-left: auto; display: flex; gap: 12px; }
""", f"""
    <div id="c01-title"><img src="assets/brand/agroflow-icon-512.png" alt="" /><h1>AgroFlow</h1><p>From enquiry to irrigation · INF3003W Team 2</p></div>
    <div id="c01-b" class="layer">
      {cap("c01-cap", "The problem", "On many small farms, watering is guesswork.")}
      <div class="card c01-c" id="c01-k1" style="left:96px"><div class="h" style="color:#9a6214">Too much</div><div class="m">Wastes water and electricity</div></div>
      <div class="card c01-c" id="c01-k2" style="left:690px"><div class="h" style="color:#b9473e">Too little</div><div class="m">Stresses the crop</div></div>
      <div class="card" id="c01-bar"><img src="assets/brand/agroflow-icon-512.png" alt="" /><div class="m">AgroFlow helps decide when to irrigate, and how much.</div>
        <div class="chips"><span class="chip soft">Rules-based</span><span class="chip forest">FAO-56</span></div></div>
    </div>""", """
  IN("#c01-title", 0.2, 0.7);
  OUT("#c01-title", 2.2);
  tl.set("#c01-b", { opacity: 1 }, 0);
  INX("#c01-cap", 2.6);
  IN("#c01-k1", 5.6); IN("#c01-k2", 8.2);
  IN("#c01-bar", 10.4, 0.6);
""")

# ---------- 2. The enquiry (Olwethu) -----------------------------------------------------------
files["c02-enquiry"] = comp(2, """
  #c02-field { position: absolute; left: 96px; top: 400px; width: 600px; padding: 26px 28px; }
  #c02-field .h { font-weight: 700; font-size: 16px; letter-spacing: .16em; text-transform: uppercase; color: #184d35; }
  #c02-plot { margin-top: 16px; display: flex; height: 170px; border-radius: 14px; overflow: hidden; border: 3px solid #4f8f62; }
  #c02-plot div { flex: 1; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 26px; color: #fff; background: #4f8f62; }
  #c02-plot div + div { border-left: 3px dashed #e3f1ea; background: #3f7d52; }
  #c02-field .sm { margin-top: 14px; font-weight: 500; font-size: 21px; color: #4b5a4d; }
  #c02-steps { position: absolute; left: 96px; top: 690px; width: 600px; }
  .c02-s { margin-bottom: 14px; font-weight: 600; font-size: 24px; color: #253126; display: flex; gap: 14px; align-items: center; }
  .c02-s b { width: 34px; height: 34px; border-radius: 50%; background: #184d35; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; flex: none; }
""", f"""
    {cap("c02-cap", "The enquiry", "Meet Thabo.")}
    {persona("c02-p", "T", "Thabo", "farmer", 96, 222)}
    <div class="card" id="c02-field"><div class="h">Tomato · near Mafikeng</div>
      <div id="c02-plot"><div>Zone 1</div><div>Zone 2</div></div>
      <div class="sm">One field, split into two irrigation zones.</div></div>
    <div id="c02-steps">
      <div class="c02-s" id="c02-s1"><b>1</b>Asks for a call back on the website</div>
      <div class="c02-s" id="c02-s2"><b>2</b>A wrong phone number is caught at once</div>
      <div class="c02-s" id="c02-s3"><b>3</b>“A representative will call you within 2 working days.”</div>
    </div>
    {browser("c02-br", 760, 180, "AgroFlow website", imgs("c02-i", ["web-hero.png", "web-enquiry-top.png", "web-enquiry-error.png", "web-enquiry-thanks.png"]) + hl("c02-h1", 140, 810, 510, 36) + hl("c02-h2", 140, 776, 470, 34), 0.72)}
""", """
  INX("#c02-cap", 0.3);
  tl.fromTo("#c02-p", { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5, ease: E }, 0.7);
  IN("#c02-field", 2.4);
  IN("#c02-br", 0.6, 0.6);
  SHOW("#c02-i1", 8.6); IN("#c02-s1", 8.6);
  SHOW("#c02-i2", 12.9); IN("#c02-s2", 12.9); HL("#c02-h1", 13.3, 3.0);
  SHOW("#c02-i3", 16.4); IN("#c02-s3", 16.4); HL("#c02-h2", 16.7, 1.6);
""")

# ---------- 3. The call-back (Olwethu) ---------------------------------------------------------
files["c03-callback"] = comp(3, """
  #c03-a { position: absolute; inset: 0; }
""", f"""
    <div id="c03-a" class="layer">
      {cap("c03-cap", "The call-back", "Naledi, our second persona,<br/>is a field officer.", "Admins with Telegram linked get a plain notice for each new enquiry.")}
      {persona("c03-p", "N", "Naledi", "field officer", 96, 400)}
      {phone("c03-ph", 1180, 91, tg("c03-tg", "AgroFlow (demo bot)", [("bot", esc("New enquiry: Thabo (demo), Mafikeng, tomato, call in the morning") + '<span class="t">11:44</span>')]))}
    </div>
    {browser("c03-br", 200, 120, "AgroFlow admin console · Requests › Enquiries", imgs("c03-i", ["a-enq-list.png", "a-enq-claimed.png", "a-enq-logcall.png", "a-enq-wants.png"]) + hl("c03-h1", 300, 336, 1172, 50) + hl("c03-h2", 1060, 136, 200, 40) + hl("c03-h3", 960, 342, 300, 40))}
""", """
  INX("#c03-cap", 0.3);
  tl.fromTo("#c03-p", { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5, ease: E }, 0.8);
  IN("#c03-ph", 0.6, 0.6);
  tl.fromTo("#c03-tg .bub", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.45, ease: E }, 3.9);
  OUT("#c03-a", 7.0);
  IN("#c03-br", 7.3, 0.5);
  HL("#c03-h1", 8.6, 4.2);
  SHOW("#c03-i1", 10.6);
  SHOW("#c03-i2", 13.3); HL("#c03-h2", 13.6, 1.8);
  SHOW("#c03-i3", 15.6); HL("#c03-h3", 15.9, 2.0);
""")

# ---------- 4. Onboarding (Philisile) ----------------------------------------------------------
files["c04-onboarding"] = comp(4, "", f"""
    {browser("c04-br", 200, 120, "AgroFlow admin console · Set up a farmer", imgs("c04-i", ["a-onb-step1.png", "a-onb-step1-filled.png", "a-onb-step2.png", "a-enq-done.png", "a-page-activity.png"]) + hl("c04-h1", 1084, 760, 400, 92) + hl("c04-h2", 1070, 342, 200, 40) + hl("c04-h3", 300, 398, 1180, 80))}
""", """
  IN("#c04-br", 0.2, 0.5);
  HL("#c04-h1", 1.2, 2.2);
  SHOW("#c04-i1", 3.6);
  SHOW("#c04-i2", 6.5);
  SHOW("#c04-i3", 11.6); HL("#c04-h2", 11.9, 2.9);
  SHOW("#c04-i4", 15.0); HL("#c04-h3", 15.3, 3.2);
""")

# ---------- 5. Handover, Telegram, first sign-in (Philisile) -----------------------------------
welcome = esc("""Welcome to AgroFlow, Thabo (demo).

Your account is ready.

Farm: Thabo's Farm (demo)
Location: Mafikeng, North West

Sign in with:
Email: thabo@demo.invalid
Temporary password: """) + '<span class="blur">DEMO-ONLY-0000</span>' + esc("""

Download the AgroFlow app here:
https://demo.invalid/agroflow.apk

You will be asked to choose your own password the first time you sign in.
Please do that as soon as you can - the temporary password above stays in this chat.""")
files["c05-handover"] = comp(5, """
  #c05-b { position: absolute; inset: 0; }
  #c05-steps { position: absolute; left: 96px; top: 300px; width: 900px; }
  .c05-s { margin-bottom: 26px; font-weight: 600; font-size: 30px; color: #253126; display: flex; gap: 16px; align-items: center; }
  .c05-s b { width: 40px; height: 40px; border-radius: 50%; background: #184d35; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 20px; flex: none; }
  #c05-tg .bub { font-size: 12.6px; }
""", f"""
    {browser("c05-br", 200, 120, "AgroFlow admin console · Hand over", imgs("c05-a", ["a-onb-handover.png"]) + hl("c05-h0", 296, 366, 272, 268))}
    <div id="c05-b" class="layer">
      {cap("c05-cap", "Hand-over", "Sign-in details arrive in Telegram.")}
      <div id="c05-steps">
        <div class="c05-s" id="c05-s1"><b>1</b>Thabo scans the QR code</div>
        <div class="c05-s" id="c05-s2"><b>2</b>Presses Start in the AgroFlow bot</div>
        <div class="c05-s" id="c05-s3"><b>3</b>Gets his email, a temporary password and the app link</div>
        <div class="c05-s" id="c05-s4"><b>4</b>Chooses his own password at first sign-in</div>
      </div>
      {phone("c05-ph", 1300, 91, tg("c05-tg", "AgroFlow (demo bot)", [("me", "/start"), ("bot", welcome + '<span class="t">12:41</span>')]) + imgs("c05-m", ["m-login-filled.png", "m-pw-change.png", "m-pw-done.png"]) + spot("c05-sp", 14, 240, 376, 100))}
    </div>
""", """
  IN("#c05-br", 0.2, 0.5); HL("#c05-h0", 0.9, 2.6);
  OUT("#c05-br", 3.7);
  tl.fromTo("#c05-b", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 3.9);
  INX("#c05-cap", 3.9); INX("#c05-s1", 4.1); INX("#c05-s2", 5.6); INX("#c05-s3", 8.0); INX("#c05-s4", 13.8);
  tl.fromTo("#c05-tg .bub.me", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 5.6);
  tl.fromTo("#c05-tg .bub:not(.me)", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: E }, 7.0);
  SHOW("#c05-m0", 13.8); SHOW("#c05-m1", 15.6); HL("#c05-sp", 16.0, 2.4); SHOW("#c05-m2", 18.6);
""")

# ---------- 6. The field kit (Leruo) -----------------------------------------------------------
files["c06-kit"] = comp(6, """
  #c06-hw { position: absolute; left: 820px; top: 110px; width: 1004px; height: 860px; border-radius: 18px; overflow: hidden; border: 1px solid #c9d3cb; box-shadow: 0 40px 90px rgba(24,77,53,.22); }
  #c06-hw img { position: absolute; left: 0; bottom: 0; width: 1004px; height: 1138px; object-fit: cover; transform-origin: 50% 100%; }
  #c06-list { position: absolute; left: 96px; top: 300px; width: 660px; }
  .c06-l { margin-bottom: 16px; padding: 18px 22px; font-weight: 700; font-size: 26px; color: #253126; }
  .c06-l small { display: block; margin-top: 4px; font-weight: 500; font-size: 18px; color: #637064; }
  #c06-b, #c06-c { position: absolute; inset: 0; }
  .wm { position: absolute; inset: 0; background: #f4f6f4; font-family: "Inter", sans-serif; padding: 70px 22px 0; }
  .wm h3 { font-weight: 700; font-size: 22px; color: #1b1f1c; }
  .wm .sub { margin-top: 4px; font-size: 14px; color: #637064; }
  .wm label { display: block; margin-top: 18px; font-weight: 600; font-size: 14px; color: #253126; }
  .wm .in { margin-top: 6px; padding: 12px; border: 1px solid #c9d3cb; border-radius: 8px; background: #fff; font-size: 16px; color: #1b1f1c; }
  .wm .btn { margin-top: 24px; padding: 13px; border-radius: 8px; background: #168f99; color: #fff; text-align: center; font-weight: 700; font-size: 16px; }
  #c06-flow { position: absolute; left: 96px; top: 330px; width: 1000px; }
  .c06-f { display: flex; align-items: center; gap: 16px; margin-bottom: 22px; font-weight: 600; font-size: 27px; color: #253126; }
  .c06-f b { width: 40px; height: 40px; border-radius: 50%; background: #184d35; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 20px; flex: none; }
  #c06-ok { position: absolute; left: 96px; top: 760px; }
""", f"""
    <div id="c06-a" class="layer">
      {cap("c06-cap", "The field kit", "What goes in the field.")}
      <div id="c06-list">
        <div class="card c06-l" id="c06-l1">ESP32 board<small>reads the sensors, switches the pump</small></div>
        <div class="card c06-l" id="c06-l2">Soil Moisture Sensor<small>how wet the soil is</small></div>
        <div class="card c06-l" id="c06-l3">Temperature &amp; humidity sensor<small>conditions at the zone</small></div>
        <div class="card c06-l" id="c06-l4">Relay for the pump<small>on and off, on command</small></div>
      </div>
      <div id="c06-hw"><img id="c06-h0" src="{R}web-hw-closed.png" alt="" /><img id="c06-h1" src="{R}web-hw-open.png" alt="" /></div>
    </div>
    <div id="c06-b" class="layer">
      {browser("c06-br", 200, 120, "AgroFlow admin console · Kits › Register a kit", imgs("c06-i", ["a-kit-wizard-1.png", "a-kit-wizard-3.png", "a-kit-wizard-5.png", "a-kit-code.png"]) + hl("c06-hk", 506, 236, 500, 380))}
    </div>
    <div id="c06-c" class="layer">
      {cap("c06-cap2", "On site", "The kit links itself to the zone.")}
      <div id="c06-flow">
        <div class="c06-f" id="c06-f1"><b>1</b>The kit opens its own setup Wi-Fi: AgroFlow-Setup-XXXX</div>
        <div class="c06-f" id="c06-f2"><b>2</b>The installer enters the farm Wi-Fi and the code, once</div>
        <div class="c06-f" id="c06-f3"><b>3</b>The kit claims its place: Thabo's Zone 1</div>
      </div>
      <div id="c06-ok" class="chip forest" style="font-size:22px">Kit linked to Zone 1</div>
      {phone("c06-ph", 1300, 91, '''<div class="wm"><h3>AgroFlow-Setup-XXXX</h3><div class="sub">Kit setup page (illustration)</div>
        <label>SSID</label><div class="in">FarmWiFi (demo)</div>
        <label>Password</label><div class="in">••••••••</div>
        <label>Enrollment Code (from admin)</label><div class="in" id="c06-code">DEMO-0000</div>
        <div class="btn">Save</div></div>''')}
    </div>
""", """
  gsap.set(["#c06-b", "#c06-c"], { opacity: 0 });
  INX("#c06-cap", 0.3); IN("#c06-hw", 0.4, 0.6);
  tl.fromTo("#c06-hw img", { scale: 1.0 }, { scale: 1.08, duration: 9.4, ease: "none" }, 0);
  SHOW("#c06-h1", 2.0, 0.6);
  INX("#c06-l1", 2.0); INX("#c06-l2", 3.9); INX("#c06-l3", 5.6); INX("#c06-l4", 7.8);
  OUT("#c06-a", 9.2);
  tl.to("#c06-b", { opacity: 1, duration: 0.4 }, 9.5);
  SHOW("#c06-i1", 11.0); SHOW("#c06-i2", 12.4); SHOW("#c06-i3", 13.4); HL("#c06-hk", 13.7, 1.6);
  OUT("#c06-b", 15.6);
  tl.to("#c06-c", { opacity: 1, duration: 0.4 }, 16.0);
  INX("#c06-cap2", 16.0); INX("#c06-f1", 16.4); INX("#c06-f2", 19.0); INX("#c06-f3", 22.0);
  IN("#c06-ph", 16.2, 0.6);
  tl.fromTo("#c06-code", { backgroundColor: "#ffffff" }, { backgroundColor: "#d9f2f3", duration: 0.4 }, 20.0);
  IN("#c06-ok", 23.2);
""")

# ---------- 7. Zone setup in the app (Lubaelihle) -----------------------------------------------
files["c07-setup"] = comp(7, """
  #c07-list { position: absolute; left: 96px; top: 300px; width: 760px; padding: 26px 30px; }
  .c07-r { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid #e4e7e4; font-weight: 600; font-size: 26px; color: #253126; }
  .c07-r:last-child { border-bottom: 0; }
  .c07-r span { font-weight: 700; font-size: 17px; letter-spacing: .1em; text-transform: uppercase; padding: 6px 12px; border-radius: 999px; }
  .todo { background: #fbecd2; color: #6f4510; }
  .done { background: #e3f1ea; color: #184d35; }
  .c07-r small { display: block; font-weight: 500; font-size: 18px; color: #637064; margin-top: 2px; }
  .c07-stack { position: relative; width: 150px; height: 34px; }
  .c07-stack span { position: absolute; right: 0; top: 0; }
  #c07-conf { position: absolute; left: 96px; top: 860px; display: flex; gap: 16px; align-items: center; font-weight: 600; font-size: 24px; color: #4b5a4d; }
  #c07-cm, #c07-ch { position: absolute; left: 260px; top: -6px; }
""", f"""
    {cap("c07-cap", "Zone setup in the app", "Thabo finishes each zone.")}
    <div class="card" id="c07-list">
      <div class="c07-r">Planting date<span class="done">Done</span></div>
      <div class="c07-r">Soil<span class="done">Done</span></div>
      <div class="c07-r">Size<span class="done">Done</span></div>
      <div class="c07-r"><div>Flow rate<small>500 mL bottle in 2 s = about 15 litres a minute</small></div><div class="c07-stack" data-layout-allow-overlap><span class="todo" id="c07-t1">To do</span><span class="done" id="c07-d1">Done</span></div></div>
      <div class="c07-r"><div>Soil sensor wet/dry setup<small>one wet and one dry reading, on different days</small></div><div class="c07-stack" data-layout-allow-overlap><span class="todo" id="c07-t2">To do</span><span class="done" id="c07-d2">Done</span></div></div>
    </div>
    <div id="c07-conf">Advice confidence:<span class="chip warn" id="c07-cm">Medium</span><span class="chip forest" id="c07-ch">High</span></div>
    {phone("c07-ph", 1300, 91, imgs("c07-m", ["m-setup-home.png", "m-setup-top.png", "m-setup-flow.png", "m-setup-flow-saved.png", "m-cal-sheet.png", "m-cal-wet.png", "m-cal-dry.png", "m-setup-done.png"]) + spot("c07-s0", 20, 708, 140, 52) + spot("c07-s1", 12, 140, 140, 28) + spot("c07-s2", 12, 540, 382, 220) + spot("c07-s3", 0, 620, 404, 60) + spot("c07-s4", 12, 140, 128, 28) + '<div class="tap" id="c07-t0" style="left:88px;top:734px"></div>')}
""", """
  INX("#c07-cap", 0.3); IN("#c07-ph", 0.3, 0.6); IN("#c07-list", 1.0); IN("#c07-conf", 1.6);
  gsap.set("#c07-ch", { opacity: 0 });
  HL("#c07-s0", 0.9, 1.0); TAP("#c07-t0", 1.6);
  SHOW("#c07-m1", 2.2); HL("#c07-s1", 2.5, 1.4);
  SHOW("#c07-m2", 3.9); HL("#c07-s2", 4.4, 3.8);
  SHOW("#c07-m3", 8.5); SHOW("#c07-d1", 8.6); OUT("#c07-t1", 8.5, 0.2);
  SHOW("#c07-m4", 10.8); HL("#c07-s3", 11.4, 1.4);
  SHOW("#c07-m5", 13.0); SHOW("#c07-m6", 15.5); SHOW("#c07-d2", 15.8); OUT("#c07-t2", 15.7, 0.2);
  SHOW("#c07-m7", 18.1); HL("#c07-s4", 18.5, 3.4);
  tl.to("#c07-cm", { opacity: 0, duration: 0.3 }, 18.1); SHOW("#c07-ch", 18.3);
""")

# ---------- 8. Daily use (Lubaelihle) -----------------------------------------------------------
A = json.load(open("capture/engine/scenario-A-dry.json"))[0]
facts = {f["label"]: f["value"] for f in A["why"]["facts"]}
files["c08-daily"] = comp(8, """
  #c08-act { position: absolute; left: 96px; top: 290px; width: 1050px; padding: 26px 30px; }
  #c08-act .h { font-weight: 700; font-size: 16px; letter-spacing: .16em; text-transform: uppercase; color: #184d35; }
  #c08-act .m { margin-top: 10px; font-weight: 700; font-size: 38px; color: #0f6b73; }
  #c08-act .sm { margin-top: 10px; font-weight: 500; font-size: 20px; color: #4b5a4d; }
  #c08-grid { position: absolute; left: 96px; top: 520px; width: 1050px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .c08-v { padding: 16px 18px; }
  .c08-v .l { font-weight: 700; font-size: 14px; letter-spacing: .12em; text-transform: uppercase; color: #4b5a4d; }
  .c08-v .n { margin-top: 6px; font-weight: 700; font-size: 25px; color: #184d35; }
  .c08-v .src { margin-top: 4px; font-weight: 500; font-size: 15px; color: #637064; }
  #c08-rule { position: absolute; left: 96px; top: 820px; width: 1050px; padding: 16px 20px; font-weight: 600; font-size: 21px; color: #253126; line-height: 1.4; }
""", f"""
    {cap("c08-cap", "Daily use", "One action per zone.")}
    <div class="card" id="c08-act"><div class="h">Zone 1 · today</div><div class="m">{esc(A["today"])}</div>
      <div class="sm">{esc(A["confidence"])}</div></div>
    <div id="c08-grid">
      <div class="card c08-v"><div class="l">Weather: crop use today</div><div class="n">{facts["Water your crop will use today"]}</div><div class="src">weather app + FAO crop guide</div></div>
      <div class="card c08-v"><div class="l">Crop stage</div><div class="n">{facts["Crop stage"]}</div><div class="src">planting date</div></div>
      <div class="card c08-v"><div class="l">Water left in the soil</div><div class="n">{facts["How dry the soil is now"]}</div><div class="src">soil sensor + weather</div></div>
      <div class="card c08-v"><div class="l">Watering point</div><div class="n">{facts["Watering point"]}</div><div class="src">FAO crop water guide</div></div>
      <div class="card c08-v"><div class="l">Rain expected today</div><div class="n">{facts["Rain expected today"]}</div><div class="src">weather app</div></div>
      <div class="card c08-v"><div class="l">How much</div><div class="n">{facts["How much"].replace("about ", "≈ ", 1)}</div><div class="src">20 m² zone · 15 L/min</div></div>
    </div>
    <div class="card" id="c08-rule">{esc(A["why"]["rule"])}</div>
    {phone("c08-ph", 1300, 91, imgs("c08-m", ["m-home.png", "m-why-top.png", "m-why-facts.png", "m-week-A-71.png"]) + spot("c08-s0", 16, 538, 372, 60) + spot("c08-s1", 16, 610, 236, 32))}
""", """
  INX("#c08-cap", 0.3); IN("#c08-ph", 0.3, 0.6);
  IN("#c08-act", 3.9); HL("#c08-s0", 4.1, 4.4);
  HL("#c08-s1", 8.8, 1.0);
  SHOW("#c08-m1", 9.9);
  tl.fromTo("#c08-grid > div", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: E, stagger: 0.55 }, 10.6);
  SHOW("#c08-m2", 13.4);
  IN("#c08-rule", 15.6);
  SHOW("#c08-m3", 18.0);
""")

# ---------- 9. Execution (Leruo) ----------------------------------------------------------------
files["c09-run"] = comp(9, """
  #c09-flow { position: absolute; left: 96px; top: 300px; width: 1100px; display: flex; flex-wrap: wrap; gap: 14px 0; align-items: center; }
  .c09-n { padding: 18px 22px; font-weight: 700; font-size: 25px; color: #253126; }
  .c09-n small { display: block; margin-top: 2px; font-weight: 500; font-size: 16px; color: #637064; }
  .c09-a { width: 46px; text-align: center; font-weight: 700; font-size: 30px; color: #168f99; }
  #c09-back { position: absolute; left: 96px; top: 520px; font-weight: 600; font-size: 22px; color: #4b5a4d; }
  #c09-safe { position: absolute; left: 124px; top: 820px; width: 760px; padding: 22px 26px; display: flex; gap: 22px; align-items: center; }
  #c09-safe .big { font-weight: 700; font-size: 54px; color: #b9473e; }
  #c09-safe .m { font-weight: 600; font-size: 24px; color: #253126; line-height: 1.35; }
  #c09-exp { position: absolute; left: 96px; top: 300px; width: 1100px; height: 690px; border-radius: 18px; overflow: hidden; border: 1px solid #c9d3cb; box-shadow: 0 30px 70px rgba(24,77,53,.2); }
  #c09-exp video { position: absolute; left: 0; top: -64px; width: 1100px; height: 1056px; }
""", f"""
    {cap("c09-cap", "Execution", "AgroFlow recommends; Thabo decides.")}
    <div id="c09-flow">
      <div class="card c09-n" id="c09-n1">App<small>Start Manual Run · 5 min</small></div><div class="c09-a" id="c09-a1">→</div>
      <div class="card c09-n" id="c09-n2">MQTT<small>command to the kit</small></div><div class="c09-a" id="c09-a2">→</div>
      <div class="card c09-n" id="c09-n3">ESP32 kit<small>Zone 1</small></div><div class="c09-a" id="c09-a3">→</div>
      <div class="card c09-n" id="c09-n4">Relay + pump<small>on</small></div>
    </div>
    <div id="c09-back">↩ The kit reports the run back, and it shows in History.</div>
    <div class="card" id="c09-safe"><div class="big">5 min</div><div class="m">Safety limit in the kit's firmware:<br/>no single run lasts longer, ever.</div></div>
    <div id="c09-exp"><video id="c09-v" class="clip" src="{R}web-experience-field-slow.mp4" muted playsinline data-start="13.4" data-duration="10.52" data-hf-media-start-basis="local"></video></div>
    {phone("c09-ph", 1300, 91, imgs("c09-m", ["m-run-control.png", "m-run-90.png", "m-run-5.png", "m-run-sent.png", "m-history.png"]) + '''<div class="dlg" id="c09-d1"><div class="box"><h4>Invalid Duration</h4><p>Enter a duration between 1 and 60 minutes.</p><div class="btns">OK</div></div></div>
      <div class="dlg" id="c09-d2"><div class="box"><h4>Start Manual Irrigation?</h4><p>Run irrigation for 5 minutes?</p><div class="btns"><span>CANCEL</span><span>START</span></div></div></div>''')}
""", """
  INX("#c09-cap", 0.3); IN("#c09-ph", 0.3, 0.6);
  SHOW("#c09-m1", 1.4); SHOW("#c09-d1", 1.9, 0.25); OUT("#c09-d1", 3.4, 0.25);
  SHOW("#c09-m2", 3.6); SHOW("#c09-d2", 4.1, 0.25); OUT("#c09-d2", 5.4, 0.25);
  SHOW("#c09-m3", 5.6);
  ["#c09-n1", "#c09-a1", "#c09-n2", "#c09-a2", "#c09-n3", "#c09-a3", "#c09-n4"].forEach((s, i) => INX(s, 5.2 + i * 0.8, 0.4));
  IN("#c09-back", 11.2);
  SHOW("#c09-m4", 11.2);
  OUT(["#c09-flow", "#c09-back"], 13.0);
  IN("#c09-exp", 13.4, 0.5);
  tl.fromTo("#c09-safe", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: E }, 13.8);
  tl.to("#c09-safe", { opacity: 0, duration: 0.3 }, 20.0);
  OUT("#c09-exp", 23.3, 0.5);
""")

# ---------- 10. The weather changes (Leruo) ------------------------------------------------------
C4 = json.load(open("capture/engine/scenario-C-rain-4mm-today.json"))[0]["today"]
C12 = json.load(open("capture/engine/scenario-C-rain-12mm-today.json"))[0]["today"]
alert = esc("""Heavy rain expected

Farm: Thabo's Farm (demo)
When: tomorrow
Expected rainfall: 24 mm

AgroFlow does not pause automatic watering for rain yet, so zones on
automatic will still water on their own soil moisture readings.

If you do not want that, switch those zones to manual in the app
before then. Check your drainage and anything that could wash away.

Why: The weather forecast for Thabo's Farm (demo) shows heavy rain on Sunday 11 Oct.""")
files["c10-weather"] = comp(10, """
  #c10-ex { position: absolute; left: 96px; top: 300px; width: 1100px; }
  .c10-e { margin-bottom: 18px; padding: 20px 24px; }
  .c10-e .h { font-weight: 700; font-size: 16px; letter-spacing: .14em; text-transform: uppercase; color: #4b5a4d; }
  .c10-e .m { margin-top: 8px; font-weight: 700; font-size: 30px; color: #0f6b73; }
  .c10-e .r { margin-top: 6px; font-weight: 600; font-size: 20px; color: #184d35; }
  #c10-note { font-weight: 600; font-size: 17px; color: #637064; letter-spacing: .04em; }
  #c10-ab { position: absolute; left: 96px; top: 300px; width: 1100px; display: flex; gap: 20px; }
  .c10-c { flex: 1; padding: 22px 24px; }
  .c10-c .h { font-weight: 700; font-size: 16px; letter-spacing: .14em; text-transform: uppercase; color: #4b5a4d; }
  .c10-c .m { margin-top: 10px; font-weight: 700; font-size: 28px; color: #253126; line-height: 1.25; }
  #c10-tgw .bub { font-size: 12.4px; }
""", f"""
    {cap("c10-cap", "The weather changes", "24 mm of rain, tomorrow.")}
    <div id="c10-ab">
      <div class="card c10-c" id="c10-c1"><div class="h">Zone 2 · Monday · before</div><div class="m">Irrigation likely at about 38.9 mm.</div></div>
      <div class="card c10-c" id="c10-c2"><div class="h">Zone 2 · Monday · after the update</div><div class="m">No irrigation currently expected.</div></div>
    </div>
    <div id="c10-ex">
      <div class="card c10-e" id="c10-e1"><div class="h">If rain only helps · 4 mm today</div><div class="m">“{esc(C4)}”</div><div class="r">Water less</div></div>
      <div class="card c10-e" id="c10-e2"><div class="h">If rain covers the need · 12 mm today</div><div class="m">“{esc(C12)}”</div><div class="r">Wait</div></div>
      <div id="c10-note">AgroFlow engine output for Zone 1 under other forecasts · demo inputs</div>
    </div>
    {phone("c10-ph", 1300, 91, imgs("c10-m", ["m-week-A-72.png", "m-week-B-72.png"]) + spot("c10-s0", 12, 520, 380, 66) + spot("c10-s1", 12, 520, 380, 66) + tg("c10-tgw", "AgroFlow (demo bot)", [("bot", alert + '<span class="t">07:02</span>'), ("btn", "Why am I seeing this?")]))}
""", """
  INX("#c10-cap", 0.3); IN("#c10-ph", 0.3, 0.6);
  gsap.set("#c10-tgw", { opacity: 0 });
  HL("#c10-s0", 1.2, 2.9); IN("#c10-c1", 1.4);
  SHOW("#c10-m1", 4.4); HL("#c10-s1", 4.8, 5.2); IN("#c10-c2", 5.6);
  OUT("#c10-ab", 10.1);
  IN("#c10-e1", 10.4); IN("#c10-e2", 13.4); IN("#c10-note", 14.2);
  SHOW("#c10-tgw", 17.7, 0.4);
""")

# ---------- 11. Reports (Olwethu) -------------------------------------------------------------
files["c11-reports"] = comp(11, """
  #c11-pdf { position: absolute; left: 96px; top: 240px; width: 600px; height: 760px; overflow: hidden; border-radius: 10px; box-shadow: 0 30px 70px rgba(24,77,53,.2); border: 1px solid #c9d3cb; background: #fff; }
  #c11-pdf img { width: 600px; display: block; }
  #c11-a { position: absolute; inset: 0; }
""", f"""
    <div id="c11-a" class="layer">
      {cap("c11-cap", "Reports", "What to do next comes first.")}
      <div id="c11-pdf"><img src="{R}thabo-report-p1-1.png" alt="" />{hl("c11-h0", 28, 118, 544, 238)}</div>
      {phone("c11-ph", 1300, 91, imgs("c11-m", ["m-reports.png", "m-reports-ready.png"]) + spot("c11-s0", 12, 720, 380, 100))}
    </div>
    {browser("c11-br", 200, 120, "AgroFlow admin console · Reports", imgs("c11-i", ["a-page-reports.png", "a-reports-auto.png"]) + hl("c11-h1", 296, 304, 214, 46) + hl("c11-h2", 860, 330, 632, 36))}
""", """
  tl.set("#c11-cap", { left: 760, top: 240, width: 480 }, 0);
  INX("#c11-cap", 0.3); IN("#c11-pdf", 0.4, 0.6); HL("#c11-h0", 1.2, 2.6);
  IN("#c11-ph", 0.6, 0.6);
  SHOW("#c11-m1", 4.6); HL("#c11-s0", 5.0, 3.6);
  OUT("#c11-a", 9.6);
  IN("#c11-br", 9.9, 0.5); HL("#c11-h1", 10.6, 2.6);
  SHOW("#c11-i1", 13.6); HL("#c11-h2", 14.0, 3.0);
""")

# ---------- 12. Naledi's admin view (Olwethu) --------------------------------------------------
files["c12-admin"] = comp(12, "", f"""
    {browser("c12-br", 200, 120, "AgroFlow admin console", imgs("c12-i", ["a-dashboard-after.png", "a-page-activity.png"]) + hl("c12-h1", 284, 196, 396, 104) + hl("c12-h2", 686, 196, 396, 104) + hl("c12-h3", 1088, 196, 396, 104) + hl("c12-h4", 300, 398, 1180, 170))}
""", """
  IN("#c12-br", 0.2, 0.5);
  HL("#c12-h1", 4.0, 3.9); HL("#c12-h2", 5.4, 2.5); HL("#c12-h3", 6.6, 1.3);
  SHOW("#c12-i1", 8.2); HL("#c12-h4", 8.6, 5.6);
""")

# ---------- 13. Testing and validation (Leruo) ---------------------------------------------------
files["c13-testing"] = comp(13, """
  #c13-val { position: absolute; left: 96px; top: 280px; width: 1728px; display: flex; gap: 20px; }
  .c13-v { flex: 1; padding: 20px 24px; }
  .c13-v .h { font-weight: 700; font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: #4b5a4d; }
  .c13-v .m { margin-top: 10px; font-weight: 600; font-size: 22px; color: #b9473e; }
  .c13-v .s { margin-top: 6px; font-weight: 500; font-size: 17px; color: #637064; }
  #c13-res { position: absolute; left: 96px; top: 480px; width: 1728px; display: flex; gap: 20px; }
  .c13-r { flex: 1; padding: 22px 26px; }
  .c13-r .h { font-weight: 700; font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: #4b5a4d; }
  .c13-r .n { margin-top: 8px; font-weight: 700; font-size: 50px; color: #184d35; }
  .c13-r .s { margin-top: 4px; font-weight: 500; font-size: 18px; color: #637064; }
  #c13-fail { position: absolute; left: 96px; top: 720px; width: 1728px; padding: 20px 26px; }
  #c13-fail .h { font-weight: 700; font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: #8c2f28; }
  #c13-fail li { margin: 10px 0 0 22px; font-weight: 500; font-size: 18px; color: #253126; }
  #c13-fail code { font-family: "JetBrains Mono", monospace; font-size: 16px; }
""", """
    <div class="cap" id="c13-cap"><div class="k">Testing and validation</div><div class="t">We tested as we built.</div></div>
    <div id="c13-val">
      <div class="card c13-v" id="c13-v1"><div class="h">Website enquiry form</div><div class="m">Please give a South African phone number, for example 082 123 4567.</div><div class="s">shown for “082 12”</div></div>
      <div class="card c13-v" id="c13-v2"><div class="h">App · Start Manual Run</div><div class="m">Invalid Duration: Enter a duration between 1 and 60 minutes.</div><div class="s">shown for 90 minutes</div></div>
      <div class="card c13-v" id="c13-v3"><div class="h">App · first sign-in</div><div class="m">Your new password must contain at least 8 characters.</div><div class="s">shown for a 5-character password</div></div>
    </div>
    <div id="c13-res">
      <div class="card c13-r" id="c13-r1"><div class="h">Mobile app · Jest</div><div class="n">64 / 64</div><div class="s">11 suites, all passed</div></div>
      <div class="card c13-r" id="c13-r2"><div class="h">Backend · xUnit</div><div class="n">1,299 / 1,301</div><div class="s">2 failed</div></div>
      <div class="card c13-r" id="c13-r3"><div class="h">Admin console · Playwright</div><div class="n">111 / 112</div><div class="s">1 failed</div></div>
    </div>
    <div class="card" id="c13-fail"><div class="h">The three failures, as reported (10 Oct 2026)</div><ul>
      <li>Backend: <code>EdgeCaseTests.Every_crop_list_is_the_same_and_the_engine_knows_every_one</code></li>
      <li>Backend: <code>EdgeCaseTests.Numbers_in_charts_workbooks_and_advice_never_take_the_machine_s_decimal_comma(culture: "en-ZA")</code></li>
      <li>Admin: <code>hardware-showcase.spec.ts</code> · the test's “AgroFlow” heading locator matches 4 elements (strict mode)</li></ul></div>
""", """
  INX("#c13-cap", 0.3);
  IN("#c13-v1", 2.6); IN("#c13-v2", 5.2); IN("#c13-v3", 7.0);
  IN("#c13-r1", 9.0); IN("#c13-r2", 11.6); IN("#c13-r3", 13.4);
  IN("#c13-fail", 16.3);
""")

# ---------- 14. Close (all four) -------------------------------------------------------------
cues14 = {c["id"]: round(c["at"] - (json.load(open("assets/vo/scenes.json"))[13]["start"]), 2) for c in json.load(open("assets/vo/cues.json")) if c["scene"] == 14}
files["c14-close"] = comp(14, """
  #c14-wrap { position: absolute; left: 0; right: 0; top: 200px; text-align: center; }
  #c14-wrap img { width: 110px; height: 110px; border-radius: 26px; }
  .c14-l { margin-top: 26px; font-weight: 700; font-size: 58px; letter-spacing: -.015em; color: #184d35; }
  .c14-l2 { margin-top: 14px; font-weight: 600; font-size: 34px; color: #4b5a4d; }
  #c14-team { margin-top: 44px; display: flex; justify-content: center; gap: 18px; }
  .c14-n { padding: 18px 22px; min-width: 300px; }
  .c14-n b { display: block; font-weight: 700; font-size: 25px; color: #253126; }
  .c14-n span { display: block; margin-top: 4px; font-weight: 500; font-size: 17px; color: #637064; }
  #c14-ty { margin-top: 40px; font-weight: 700; font-size: 40px; color: #0f6b73; }
""", """
    <div id="c14-wrap">
      <img id="c14-logo" src="assets/brand/agroflow-icon-512.png" alt="" />
      <div class="c14-l" id="c14-a">AgroFlow recommends. The farmer decides.</div>
      <div class="c14-l2" id="c14-b">Every number traces back to its source.</div>
      <div class="c14-l2" id="c14-c">Built by Team 2 · INF3003W</div>
      <div id="c14-team">
        <div class="card c14-n"><b>Lubaelihle Msuku</b></div>
        <div class="card c14-n"><b>Leruo Matlhatsi</b></div>
        <div class="card c14-n"><b>Philisile Tyobeka</b></div>
        <div class="card c14-n"><b>Olwethu Nkabinde</b></div>
      </div>
      <div id="c14-ty">Thank you.</div>
    </div>
""", f"""
  IN("#c14-logo", 0.1);
  IN("#c14-a", {cues14["s14a_luba"]});
  IN("#c14-b", {cues14["s14b_leruo"]});
  IN("#c14-c", {cues14["s14c_philisile"]});
  tl.fromTo("#c14-team > div", {{ opacity: 0, y: 12 }}, {{ opacity: 1, y: 0, duration: 0.4, ease: E, stagger: 0.25 }}, {cues14["s14c_philisile"] + 0.6});
  IN("#c14-ty", {cues14["s14d_olwethu"]});
""")

os.makedirs("compositions", exist_ok=True)
for name, html in files.items():
    open(f"compositions/{name}.html", "w").write(html)
print("wrote", len(files), "compositions")
