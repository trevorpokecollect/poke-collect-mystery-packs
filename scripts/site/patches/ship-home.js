        // SITE: the card sinks into an open box (hidden behind its front), the flaps close and tape on,
        // a truck rolls in, the box hops onto it and it drives away.
        const k = st / STEP;
        const drop = smooth(.04, .3, k), flap = smooth(.34, .48, k), arrive = smooth(.46, .6, k), load = smooth(.5, .64, k), drive = smooth(.7, 1, k);
        const by = floor - 30 * u, top = -44 * u;
        const away = drive * W * .6;
        const tx = mix(ox + W * .35, ox, arrive) + away; // backs in from the right, clear of Latch
        const bx = ox + away, lift = -40 * u * load - Math.sin(load * Math.PI) * 30 * u;
        if (arrive > 0) {
          g.save(); g.translate(tx, by); g.globalAlpha = smooth(0, .3, arrive);
          g.fillStyle = '#e8eef2'; g.beginPath(); g.roundRect(-62 * u, -46 * u, 124 * u, 50 * u, 8 * u); g.fill();
          g.fillStyle = '#0b1416'; [[-38, 8], [38, 8]].forEach(([x, y]) => { g.beginPath(); g.arc(x * u, y * u, 11 * u, 0, TAU); g.fill(); });
          g.fillStyle = '#00e6e1'; g.fillRect(-62 * u, -14 * u, 124 * u, 5 * u);
          g.restore();
        }
        if (flap < .2) {
          // Inside of the open box, then the card, clipped at the box opening so it never shows through the front.
          g.fillStyle = '#7a5a30'; g.fillRect(bx - 34 * u, by + top + lift - 4 * u, 68 * u, 8 * u);
          g.save(); g.beginPath(); g.rect(bx - 200 * u, -H, 400 * u, H + by + top + lift); g.clip();
          card(g, art.cards['latch-slowking-014.webp'], bx, mix(oy - 70 * u, by + 2 * u, drop), 80 * u, 0, {});
          g.restore();
        }
        g.save(); g.translate(bx, by + lift);
        g.fillStyle = '#c99a5b'; g.fillRect(-34 * u, top, 68 * u, 48 * u);
        g.fillStyle = '#b5874a'; g.fillRect(-34 * u, top, 68 * u, 4 * u);
        g.save(); g.translate(-34 * u, top); g.rotate(-Math.PI * .85 * (1 - flap)); g.fillRect(0, -3 * u, 34 * u, 6 * u); g.restore();
        g.save(); g.translate(34 * u, top); g.rotate(Math.PI * .85 * (1 - flap)); g.fillRect(-34 * u, -3 * u, 34 * u, 6 * u); g.restore();
        if (flap >= 1) { g.fillStyle = '#00e6e1'; const tape = smooth(.48, .54, k); g.fillRect(-4 * u, top - 2 * u, 8 * u, 50 * u * tape); }
        g.restore();
        if (drive > 0) for (let i = 0; i < 4; i++) { g.strokeStyle = 'rgba(255,255,255,' + ((.3 - i * .06) * smooth(0, .15, drive)) + ')'; g.lineWidth = 2; g.beginPath(); g.moveTo(tx - 70 * u - i * 18 * u, by - 20 * u + i * 8 * u); g.lineTo(tx - 100 * u - i * 18 * u, by - 20 * u + i * 8 * u); g.stroke(); }
      }
