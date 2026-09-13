"""Service de compression PDF — Ghostscript derrière une API HTTP minimale.

POST /compress?preset=printer   corps = PDF brut   →   PDF compressé
GET  /health

Presets : printer (300 dpi, défaut), ebook (150 dpi), screen (72 dpi).
Sur un rapport illustré de 11,5 Mo, /printer descend à ~2,2 Mo sans perte visible.

Un PDF déjà léger traverse le service sans être touché : la compression est
lossy, et un rapport de 2 Mo n'a rien à y gagner. Voir SEUIL_COMPRESSION.
"""
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PRESETS = {"printer", "ebook", "screen", "prepress", "default"}
TAILLE_MAX = 200 * 1024 * 1024

# En deçà de ce poids, le PDF est rendu intact. La limite d'envoi est à 20 Mo :
# un rapport de 2 Mo n'a rien à gagner à être rééchantillonné, et tout à perdre.
SEUIL_COMPRESSION = int(os.environ.get("SEUIL_COMPRESSION_MO", "6")) * 1024 * 1024

# Ghostscript recopie les profils ICC de Chromium en flux VIDES : les visionneuses
# strictes — dont CoreGraphics, donc Aperçu et Mail sur Mac — refusent alors de
# dessiner l'image et laissent un cadre blanc. Poppler, lui, passe outre, d'où un
# défaut longtemps invisible en test. Convertir en sRGB supprime ces profils
# cassés ; le gain de compression est inchangé (499 Ko contre 502 Ko à l'essai).
COULEUR = ["-dColorConversionStrategy=/sRGB"]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):          # journal concis
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def _envoyer(self, code, corps, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self._envoyer(200, b'{"status":"up"}')
        else:
            self._envoyer(404, b'{"error":"route inconnue"}')

    def do_POST(self):
        route = urlparse(self.path)
        if route.path != "/compress":
            return self._envoyer(404, b'{"error":"route inconnue"}')

        taille = int(self.headers.get("Content-Length") or 0)
        if taille <= 0 or taille > TAILLE_MAX:
            return self._envoyer(400, b'{"error":"corps absent ou trop volumineux"}')

        preset = (parse_qs(route.query).get("preset") or ["printer"])[0]
        if preset not in PRESETS:
            preset = "printer"

        source = self.rfile.read(taille)
        if not source.startswith(b"%PDF"):
            return self._envoyer(400, b'{"error":"le corps n\'est pas un PDF"}')

        if len(source) <= SEUIL_COMPRESSION:
            self.log_message("intact : %d octets, sous le seuil", len(source))
            return self._envoyer(200, source, "application/pdf")

        with tempfile.TemporaryDirectory() as tmp:
            entree = os.path.join(tmp, "in.pdf")
            sortie = os.path.join(tmp, "out.pdf")
            with open(entree, "wb") as f:
                f.write(source)
            try:
                subprocess.run(
                    ["gs", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
                     f"-dPDFSETTINGS=/{preset}", "-dNOPAUSE", "-dQUIET", "-dBATCH",
                     "-dDetectDuplicateImages=true", "-dCompressFonts=true",
                     *COULEUR,
                     f"-sOutputFile={sortie}", entree],
                    check=True, timeout=300,
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                )
            except subprocess.TimeoutExpired:
                return self._envoyer(504, b'{"error":"ghostscript a depasse le delai"}')
            except subprocess.CalledProcessError:
                # Compression impossible : on rend le PDF d'origine plutot que d'echouer.
                self.log_message("ghostscript a echoue, PDF original renvoye")
                return self._envoyer(200, source, "application/pdf")

            with open(sortie, "rb") as f:
                resultat = f.read()

        # Un resultat plus lourd que l'original n'a pas d'interet.
        if len(resultat) >= len(source):
            resultat = source
        self.log_message("compress %s : %d -> %d octets", preset, len(source), len(resultat))
        self._envoyer(200, resultat, "application/pdf")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 3001), Handler).serve_forever()
