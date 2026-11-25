import os, re
K = "https://cdn.klaviyomail.com/company/VxYnct/images/images_cb-mail-"
H = "font-family:'Outfit','Cardbit Outfit','Trebuchet MS',Arial,sans-serif;font-weight:800;"
B = "font-family:'Atkinson Hyperlegible Next','Atkinson Hyperlegible',Verdana,Arial,sans-serif;"
OUT = os.path.dirname(os.path.abspath(__file__)) + "/"

def head(title, pre, pill=None):
    return f"""<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@800&family=Atkinson+Hyperlegible+Next:wght@400;700&display=swap" rel="stylesheet">
<style>
html,body{{margin:0!important;padding:0!important;background:#0b1114}}
table{{border-spacing:0;border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt}}
img{{border:0;outline:none;display:block;height:auto}}
a{{color:#00e6e1}}
@media(max-width:520px){{
 .pad{{padding-left:20px!important;padding-right:20px!important}}
 .h1{{font-size:32px!important;line-height:36px!important}}
 .h2{{font-size:22px!important;line-height:27px!important}}
 .stack{{display:block!important;width:100%!important;box-sizing:border-box}}
 .stack-gap{{display:block!important;height:10px!important;width:100%!important}}
 .btn,.btn a{{display:block!important;text-align:center!important}}
}}
</style>
</head>
<body style="margin:0;padding:0;background:#0b1114;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0b1114;">{pre}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" bgcolor="#0b1114" style="background:#0b1114;">
<tr><td align="center" style="padding:24px 12px 40px;">
<table role="presentation" width="600" style="width:100%;max-width:600px;">
<tr><td class="pad" style="padding:6px 28px 18px;">
 <table role="presentation" width="100%"><tr>
  <td align="left"><a href="https://cardbit.com/"><img src="{K}logo71bed.png" width="132" alt="cardbit" style="width:132px;"></a></td>
  <td align="right"><a href="https://cardbit.com/" style="display:inline-block;padding:7px 14px;border:1px solid #2c3a3d;border-radius:999px;background:#101619;color:#00e6e1;{H}font-size:13px;text-decoration:none;">{pill or 'Visit Cardbit'}</a></td>
 </tr></table>
</td></tr>
"""

FOOT = f"""<tr><td class="pad" align="center" style="padding:30px 28px 0;">
 <div style="{H}font-size:15px;color:#f6faf9;margin-bottom:12px;">Find Cardbit Online</div>
 <table role="presentation"><tr>
  <td style="padding:0 6px;"><a href="https://www.instagram.com/cardbitshop/"><img src="{K}instagram9de1.png" width="24" alt="Instagram" style="width:24px;"></a></td>
  <td style="padding:0 6px;"><a href="https://www.facebook.com/profile.php?id=61596993114628"><img src="{K}facebook9566.png" width="24" alt="Facebook" style="width:24px;"></a></td>
 </tr></table>
 <table role="presentation" style="margin-top:22px;"><tr>
  <td style="background:#101619;border:1px solid #2c3a3d;border-radius:14px;padding:12px 16px;">
   <table role="presentation"><tr>
    <td valign="middle" style="padding-right:10px;"><img src="{K}whatnot9a49d.png" width="24" alt="" style="width:24px;"></td>
    <td valign="middle" style="{B}font-size:14px;color:#b6c4c5;">New To Whatnot? <a href="https://www.whatnot.com/invite/pokecollectcards" style="{H}color:#ffb65c;text-decoration:none;">Get $25 Credit on Whatnot</a></td>
   </tr></table>
  </td>
 </tr></table>
 <p style="margin:8px 0 0;{B}font-size:11px;line-height:16px;color:#6f8082;">For eligible new Whatnot accounts. Poke-Collect may earn a reward when you use this invite.</p>
 <p style="margin:22px 0 0;{B}font-size:12px;line-height:19px;color:#8fa0a2;">Cardbit LLC &middot; {{{{ organization.full_address }}}}<br><a href="mailto:hello@cardbit.com" style="color:#b6c4c5;">hello@cardbit.com</a> &middot; <a href="{{% manage_preferences_link %}}" style="color:#b6c4c5;">Email Preferences</a> &middot; <a href="{{% unsubscribe_link %}}" style="color:#b6c4c5;">Unsubscribe</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"""

def card(inner): return f"""<tr><td style="background:#161e21;border:1px solid #2c3a3d;border-radius:22px;">
 <table role="presentation" width="100%">
{inner} </table>
</td></tr>
<tr><td style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr>
"""
def row(inner, pad="0 32px 0"): return f'  <tr><td class="pad" style="padding:{pad};">{inner}</td></tr>\n'
def hero(src, alt, href="https://cardbit.com/"):
    img = src if src.startswith("{%") else f'<img src="{K}{src}" width="600" alt="{alt}" style="width:100%;max-width:600px;border-radius:22px 22px 0 0;">'
    return f'  <tr><td style="border-radius:22px 22px 0 0;"><a href="{href}">{img}</a></td></tr>\n'
def eyebrow(t, gold=False):
    c, bg = ("#ffb65c", "#2a2213") if gold else ("#00e6e1", "#0f2a2b")
    return row(f'<span style="display:inline-block;padding:6px 12px;border-radius:999px;background:{bg};color:{c};{H}font-size:13px;letter-spacing:.3px;">{t}</span>', "28px 32px 0")
def h1(t): return row(f'<h1 class="h1" style="margin:14px 0 12px;{H}font-size:40px;line-height:44px;letter-spacing:-1px;color:#f6faf9;">{t}</h1>', "0 32px 0")
def h2(t, top=26): return row(f'<h2 class="h2" style="margin:0 0 6px;{H}font-size:26px;line-height:30px;color:#f6faf9;">{t}</h2>', f"{top}px 32px 0")
def p(t, size=17, color="#d4e0df", pad="0 32px 6px"): return row(f'<p style="margin:0;{B}font-size:{size}px;line-height:{int(size*1.6)}px;color:{color};">{t}</p>', pad)
def small(t): return row(f'<p style="margin:0;{B}font-size:13px;line-height:19px;color:#8fa0a2;">{t}</p>', "12px 32px 0")
def _pbtn(t,u): return f'<td class="btn stack" style="border-radius:14px;background:#00e6e1;"><a href="{u}" style="display:inline-block;padding:15px 24px;{H}font-size:16px;color:#062022;text-decoration:none;border-radius:14px;">{t}</a></td>'
def buttons(primary=None, secondary=None, pad="18px 32px 28px"):
    cells = []
    if primary:
        if len(primary) == 3:
            c, (t1, u1), (t2, u2) = primary
            cells.append(f"{{% if {c} %}}{_pbtn(t1,u1)}{{% else %}}{_pbtn(t2,u2)}{{% endif %}}")
        else:
            cells.append(_pbtn(*primary))
    if secondary:
        if cells: cells.append('<td class="stack-gap" style="width:10px;font-size:0;">&nbsp;</td>')
        cells.append(f'<td class="btn stack" style="border-radius:14px;border:1px solid #00e6e1;"><a href="{secondary[1]}" style="display:inline-block;padding:14px 22px;{H}font-size:15px;color:#00e6e1;text-decoration:none;border-radius:14px;">{secondary[0]}</a></td>')
    return row(f'<table role="presentation"><tr>{"".join(cells)}</tr></table>', pad)
def tile(big, title, text, color="#00e6e1"):
    bigh = f'<div style="{H}font-size:26px;line-height:30px;color:{color};">{big}</div>' if big else ''
    return f'<td class="stack" width="49%" valign="top" style="background:#101619;border:1px solid #2c3a3d;border-radius:16px;padding:16px 18px;">{bigh}<div style="{H}font-size:16px;line-height:21px;color:#f6faf9;margin-top:2px;">{title}</div><div style="{B}font-size:14px;line-height:20px;color:#b6c4c5;margin-top:4px;">{text}</div></td>'
def tiles(a, b_, pad="14px 32px 4px"):
    return row(f'<table role="presentation" width="100%"><tr>{a}<td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>{b_}</tr></table>', pad)
def steps(items):
    out = ""
    for i, (t, d) in enumerate(items, 1):
        out += f'<tr><td valign="top" width="44" style="padding:0 0 14px;"><div style="width:32px;height:32px;line-height:32px;text-align:center;border-radius:10px;background:#00e6e1;color:#062022;{H}font-size:16px;">{i}</div></td><td valign="top" style="padding:2px 0 14px;"><div style="{H}font-size:16px;line-height:21px;color:#f6faf9;">{t}</div><div style="{B}font-size:14px;line-height:20px;color:#b6c4c5;margin-top:2px;">{d}</div></td></tr>'
    return row(f'<table role="presentation" width="100%">{out}</table>', "14px 32px 10px")
def details(rows):
    out = ""
    for cond, k, v in rows:
        r = f'<tr><td valign="top" width="36%" style="padding:11px 12px 11px 0;border-bottom:1px solid #2c3a3d;{B}font-weight:700;font-size:14px;line-height:20px;color:#b6c4c5;">{k}</td><td valign="top" style="padding:11px 0;border-bottom:1px solid #2c3a3d;{H}font-size:15px;line-height:20px;color:#f6faf9;">{v}</td></tr>'
        out += (f'{{% if {cond} %}}{r}{{% endif %}}' if cond else r)
    return row(f'<table role="presentation" width="100%">{out}</table>', "10px 32px 4px")
def item_image(cond_var, alt):
    return row(f'{{% if {cond_var} %}}<img src="{{{{ {cond_var}|escape }}}}" width="220" alt="{alt}" style="width:220px;max-width:100%;border-radius:14px;margin:6px 0 4px;">{{% endif %}}', "12px 32px 0")
def shelf(gif="shelfed540.gif"):
    return card(h2("Meet The Five Editions") + p("Compare the pack artwork and see what each edition contains.", 16, "#b6c4c5") +
        row(f'<a href="https://cardbit.com/packs"><img src="{K}{gif}" width="536" alt="Mystery, Booster, Gold, Japanese and Wildcard Edition packs" style="width:100%;max-width:536px;border-radius:14px;"></a>', "10px 32px 0") +
        buttons(None, ("Browse Pack Editions", "https://cardbit.com/packs")))
def cond_btn(cond, t1, u1, t2, u2):
    return (cond, (t1, u1), (t2, u2))

T = {}
T["F01"] = (("Your 1,000 Founding Cardbits Are Reserved", "Founding Collector: make your first top-up at launch to unlock your bonus Cardbits."),
  card(hero("welcomed7eb3.jpg", "Latch holds out three black and turquoise Cardbits tokens bearing the Cardbits emblem.") + eyebrow("&#9733; Founding Collector", True) +
  h1('Your <span style="color:#00e6e1;">1,000 Cardbits</span> Are Reserved') +
  p("Thanks for joining the Cardbit waitlist. Here&rsquo;s how your Founding bonus unlocks at launch:") +
  tiles(tile("400", "Email Bonus", "Create your account with this email and make your first top-up, any amount."), tile("+600", "Text Alerts Bonus", "Add your mobile number and confirm it by text.", "#ffb65c")) +
  buttons(("See How Cardbit Works", "https://cardbit.com/help"), pad="18px 32px 0") +
  small("One bonus per person, email and phone number. It replaces the regular signup rewards and has no cash value.") + row("", "0 0 28px")) + shelf())
T["W02"] = (("Your 200 Cardbits Are In", "Your signup credit is in your balance."),
  card(hero("welcomed7eb3.jpg", "Latch holds out three black and turquoise Cardbits tokens bearing the Cardbits emblem.") + eyebrow("Welcome Reward") +
  h1('You&rsquo;ve Got <span style="color:#00e6e1;">200 Cardbits</span>') +
  p("Welcome to Cardbit. Your signup credit is in your balance. Confirm a mobile number on the Welcome Rewards page for 300 more. Pick a pack, open it online, and choose which physical cards to keep in your vault or ship home.") +
  buttons(("View My Cardbits", "https://cardbit.com/cardbits"), ("How It Works", "https://cardbit.com/help"))) + shelf())
T["W03"] = (("Welcome To The Cardbit Pack Counter", "Meet Latch, your pack counter host."),
  card(hero("shop1c39.jpg", "Latch raises the pack counter shutter while holding an acrylic display tray.") + eyebrow("Welcome To Cardbit") +
  h1("Meet Latch, Your Pack Counter Host") +
  p("Latch has a spot for you at the counter. Pick an edition, open it online, and the physical cards you reveal go into your vault. You decide which ones to ship home.") +
  buttons(("Explore The Packs", "https://cardbit.com/packs"))) +
  card(h2("Make Your First Pick") + buttons(None, ("Browse The Card Shop", "https://cardbit.com/shop"))))
T["W04"] = (("Where Your Cards Go After You Open A Pack", "Open Online And Choose When To Ship."),
  card(hero("vault6bb58.jpg", "At the vault, Latch grips a rigid toploader by its edges and files a Pikachu ex card.") + eyebrow("A Guide To My Vault") +
  h1("From Pack To Vault To Home") +
  p("The reveal is online. The card is physical. My Vault keeps track of the cards you own while you decide which ones you want in hand.") +
  buttons(("See How Cardbit Works", "https://cardbit.com/help"))) +
  card(h2("Follow A Card") + steps([("Open Your Pack", "After the reveal, the physical card appears in My Vault."), ("Build A Shipment", "Select the cards you want to receive together."), ("Review And Request", "Check the destination and shipping charge before you submit.")]) + row("", "0 0 14px")))
T["W05"] = (("Which Pack Would You Open First?", "Compare The Five Cardbit Editions."),
  card(hero("restock-boosterf244f.jpg", "Latch places a sealed Cardbit Booster Edition pack on the shelf.") + eyebrow("At The Pack Counter") +
  h1("Pick Your First Edition") +
  p("Do you like a five-card opening, or would you rather turn over a single card? Start with the format you enjoy, then check what&rsquo;s available on the shelf.") +
  buttons(("Compare Pack Editions", "https://cardbit.com/packs"))) +
  card(h2("Two Ways To Open") + tiles(tile("5", "Five Cards Per Pack", "Booster Edition reveals five physical cards."), tile("1", "One Card Per Pack", "Mystery, Gold, Japanese, and Wildcard each reveal one.", "#ffb65c"), "14px 32px 28px")) + shelf())
T["R01"] = (("Another Look At {{ event.item_name|default:'Your Requested Item' }}", "See The Details And Current Availability."),
  card(hero("basket41ead.jpg", "Latch grips the handle of a shopping basket at the Cardbit counter.") + eyebrow("Recently Viewed") +
  h1("Still Thinking About This One?") +
  p("You stopped to look at {{ event.item_name|default:'the listing'|escape }}. Here&rsquo;s the listing again so you can check its details and decide whether it belongs in your collection.") +
  buttons(cond_btn("event.item_url", "View The Listing", "{{ event.item_url|escape }}", "Visit Cardbit", "https://cardbit.com/"))) +
  card(h2("The Listing You Viewed") + item_image("event.item_image_url", "{{ event.item_name|default:'Requested listing'|escape }}") +
  details([("event.item_name", "Item", "{{ event.item_name|default:'the listing'|escape }}"), (None, "On The Listing", "See the current price and availability.")]) + row("", "0 0 24px")))
T["R02"] = (("Your Pick Is Still Waiting", "Add Cardbits To Finish What You Started."),
  card(hero("basket998af.jpg", "Latch grips the handle of a shopping basket at the Cardbit counter.") + eyebrow("Almost Yours") +
  h1("Top Up To Grab It") +
  p("You tried to get {% if event.item_name %}{{ event.item_name|escape }}{% else %}something on Cardbit{% endif %}, but your balance was a little short. Add Cardbits and it&rsquo;s one tap away, while it&rsquo;s still available.") +
  buttons(cond_btn("event.cart_url", "Add Cardbits", "{{ event.cart_url|escape }}", "Get Help With This Request", "mailto:hello@cardbit.com"))) +
  card(h2("Before You Top Up") + tiles(tile("", "Pick Your Amount", "Bigger top-ups include bonus Cardbits."), tile("", "Purchased Cardbits Never Expire", "Use them on packs, singles or shipping whenever you like."), "14px 32px 28px")))
T["R03"] = (("Pick Up Your Cardbit Checkout", "Your Cardbits Top-Up Is Waiting."),
  card(hero("basketae748.jpg", "Latch grips the handle of a shopping basket at the Cardbit counter.") + eyebrow("Your Checkout") +
  h1("Right Where You Left Off") +
  p("You started a Cardbits top-up{% if event.amount_display %} for {{ event.amount_display|escape }}{% endif %}. Pick it back up to review the amount, then finish when you&rsquo;re ready.") +
  buttons(cond_btn("event.checkout_url", "Return To Checkout", "{{ event.checkout_url|escape }}", "Get Help With This Request", "mailto:hello@cardbit.com"))) +
  card(h2("At Checkout") + tiles(tile("", "Amount And Bonus", "See your Cardbits, any bonus and the total before you pay."), tile("", "Payment Details", "Enter payment information only in the secure checkout."), "14px 32px 28px")))
T["R04"] = (("Did Something Get In The Way At Checkout?", "Reply To Cardbit If You Need A Hand."),
  card(hero("support72fe1.jpg", "Latch inspects the seam of a real shipping carton at the packing bench.") + eyebrow("Checkout Help") +
  h1("Need A Hand Finishing Up?") +
  p("If a payment screen or an item in your checkout looked wrong, reply and tell us what you saw. If you&rsquo;re ready to continue, your checkout link is below.") +
  buttons(cond_btn("event.checkout_url", "Review My Checkout", "{{ event.checkout_url|escape }}", "Get Help With This Request", "mailto:hello@cardbit.com"))) +
  card(h2("Ask The Cardbit Team") + tiles(tile("", "Reach A Person", "Reply to this email with a description of what happened."), tile("", "Keep Payment Details Private", "Leave card numbers and sign-in codes out of your reply.")) + buttons(None, ("Email Cardbit", "mailto:hello@cardbit.com"))))
ed = ["mystery", "booster", "gold", "japanese", "wildcard"]
heroes = {"mystery": "restockb7bde.jpg", "booster": "restock-booster64b2e.jpg", "gold": "restock-gold4de4b.jpg", "japanese": "restock-japanese1a0d7.jpg", "wildcard": "restock-wildcardb8150.jpg"}
wraps = {"mystery": "pack-mystery56c7c.jpg", "booster": "pack-boosterd3b73.jpg", "gold": "pack-gold7c3ac.jpg", "japanese": "pack-japanese6af40.jpg", "wildcard": "pack-wildcard921ee.jpg"}
def chain(fn, default):
    s = ""
    for i, e in enumerate(ed):
        s += ("{% if" if i == 0 else "{% elif") + f" event.edition_key == '{e}' %}}" + fn(e)
    return s + "{% else %}" + default + "{% endif %}"
def heroimg(e): return f'<img src="{K}{heroes[e]}" width="600" alt="Latch sets a sealed {e.capitalize()} Edition pack into the display tray." style="width:100%;max-width:600px;border-radius:22px 22px 0 0;">'
def wrapimg(e): return f'<img src="{K}{wraps[e]}" width="120" alt="{e.capitalize()} Edition approved wrapper" style="width:120px;border-radius:10px;">'
anykey = " or ".join(f"event.edition_key == '{e}'" for e in ed)
desc = "{% if event.edition_key == 'booster' %}Five Physical Cards Per Pack{% elif " + " or ".join(f"event.edition_key == '{e}'" for e in ed if e != "booster") + " %}One Physical Card Per Pack{% else %}Pack Details{% endif %}"
T["R05"] = (("{{ event.edition_name|default:'Your Pack Edition' }} Is Back On The Shelf", "The Pack Edition You Asked About Is Available Again."),
  card(hero(chain(heroimg, heroimg("mystery")), "") + eyebrow("Your Restock Alert") +
  h1("Back On The Pack Shelf") +
  p("You asked us to let you know when this edition returned. Latch has restocked the shelf. Check the edition page for current availability.") +
  row(f'<table role="presentation" width="100%" style="background:#101619;border:1px solid #2c3a3d;border-radius:16px;"><tr>{{% if {anykey} %}}<td width="136" valign="middle" style="padding:14px 0 14px 14px;">{chain(wrapimg, "")}</td>{{% endif %}}<td valign="middle" style="padding:14px 18px;"><div style="{H}font-size:20px;line-height:24px;color:#f6faf9;">{{{{ event.edition_name|default:\'Your Pack Edition\' }}}}</div><div style="{B}font-size:14px;line-height:20px;color:#b6c4c5;margin-top:4px;">{desc}</div></td></tr></table>', "14px 32px 0") +
  buttons(cond_btn("event.item_url", "View This Edition", "{{ event.item_url }}", "Browse Pack Editions", "https://cardbit.com/packs"), ("See All Packs", "https://cardbit.com/packs"))))
T["R06"] = (("{{ event.item_name|default:'Your Requested Item' }} Is Available Again", "A Match For The Exact Single You Requested."),
  card(hero("opening47704.jpg", "Latch opens a hinged collector case on a felt work mat.") + eyebrow("Your Single-Card Alert") +
  h1("We Found Your Match") +
  p("A copy of {{ event.item_name|default:'the listing'|escape }} matches the single you asked us to watch. Check the listing for photos, its current price, and whether it&rsquo;s still available.") +
  buttons(cond_btn("event.item_url", "View This Single", "{{ event.item_url|escape }}", "Browse The Card Shop", "https://cardbit.com/shop"))) +
  card(h2("Your Requested Printing") + item_image("event.item_image_url", "{{ event.item_name|default:'Requested listing'|escape }}") +
  details([("event.item_name", "Card", "{{ event.item_name|default:'the listing'|escape }}"), ("event.printing_display", "Printing", "{{ event.printing_display|escape }}"), ("event.language_display", "Language", "{{ event.language_display|escape }}"), ("event.finish_display", "Finish", "{{ event.finish_display|escape }}"), ("event.condition_display", "Condition", "{{ event.condition_display|escape }}")]) + row("", "0 0 24px")))

names = {"F01":"WWTh3N","W02":"S2TPji","W03":"XCaYHS","W04":"WnJ9wY","W05":"WDdaBw","R01":"Yqzi2K","R02":"V6MN8F","R03":"WKgEY3","R04":"VqBPim","R05":"XRQvyx","R06":"RhfKYb"}
for k, ((title, pre), body) in T.items():
    html = head(title, pre, "&#9679; Launching Soon" if k=="F01" else None) + body + FOOT
    open(f"{OUT}{k}-{names[k]}.html", "w").write(html)
    print(k, len(html))
